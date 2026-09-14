<?php
/**
 * Thin Google Calendar API client: OAuth token management + the three calls we
 * need (freeBusy, events insert/patch/delete). Uses only wp_remote_* so there
 * are no external Composer/Guzzle dependencies to ship.
 *
 * Every public method is written to fail soft: on any error it returns
 * false/[] and logs, so a Google outage can never throw into LatePoint's
 * booking flow.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class LPGCS_Google_Client {

	const AUTH_ENDPOINT  = 'https://accounts.google.com/o/oauth2/v2/auth';
	const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
	const API_BASE       = 'https://www.googleapis.com/calendar/v3';

	// Least-privilege scopes: read busy times + manage events we create.
	const SCOPES = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/userinfo.email';

	/** Redirect URI must be registered verbatim in the Google Cloud OAuth client. */
	public static function redirect_uri() {
		// Must match where the settings page actually lives (add_options_page =>
		// options-general.php), so the OAuth callback lands on the page that
		// reads ?code=.
		return admin_url( 'options-general.php?page=' . LPGCS_SETTINGS_SLUG );
	}

	/** Build the consent screen URL the admin gets sent to when connecting. */
	public static function build_auth_url() {
		$client_id = LPGCS_Options::get( 'client_id' );
		if ( ! $client_id ) {
			return '';
		}
		$args = array(
			'client_id'              => $client_id,
			'redirect_uri'           => self::redirect_uri(),
			'response_type'          => 'code',
			'scope'                  => self::SCOPES,
			'access_type'            => 'offline', // needed to receive a refresh_token
			'prompt'                 => 'consent', // force refresh_token even on re-auth
			'include_granted_scopes' => 'true',
		);
		return self::AUTH_ENDPOINT . '?' . http_build_query( $args );
	}

	/**
	 * Exchange the one-time ?code= for tokens and persist the refresh token.
	 * Returns true on success, or a string error message on failure.
	 */
	public static function exchange_code_for_tokens( $code ) {
		$response = wp_remote_post( self::TOKEN_ENDPOINT, array(
			'timeout' => 20,
			'body'    => array(
				'code'          => $code,
				'client_id'     => LPGCS_Options::get( 'client_id' ),
				'client_secret' => LPGCS_Options::get( 'client_secret' ),
				'redirect_uri'  => self::redirect_uri(),
				'grant_type'    => 'authorization_code',
			),
		) );

		if ( is_wp_error( $response ) ) {
			return $response->get_error_message();
		}

		$body = json_decode( wp_remote_retrieve_body( $response ), true );
		if ( empty( $body['access_token'] ) ) {
			return isset( $body['error_description'] ) ? $body['error_description'] : 'Token exchange failed (no access token returned).';
		}

		if ( ! empty( $body['refresh_token'] ) ) {
			LPGCS_Options::set( 'refresh_token', $body['refresh_token'] );
		}
		self::cache_access_token( $body['access_token'], isset( $body['expires_in'] ) ? (int) $body['expires_in'] : 3600 );

		// Best-effort: record which Google account was connected, for display.
		$email = self::fetch_connected_email( $body['access_token'] );
		if ( $email ) {
			LPGCS_Options::set( 'connected_email', $email );
		}

		return true;
	}

	/** Forget all tokens (Disconnect button). */
	public static function disconnect() {
		LPGCS_Options::delete( 'refresh_token' );
		LPGCS_Options::delete( 'connected_email' );
		delete_transient( 'lpgcs_access_token' );
	}

	private static function cache_access_token( $token, $expires_in ) {
		// Refresh a minute early to avoid edge-of-expiry 401s.
		set_transient( 'lpgcs_access_token', $token, max( 60, $expires_in - 60 ) );
	}

	/**
	 * Return a valid access token, refreshing via the stored refresh_token when
	 * the cached one has expired. Returns '' if we can't get one.
	 */
	public static function get_access_token() {
		$cached = get_transient( 'lpgcs_access_token' );
		if ( $cached ) {
			return $cached;
		}

		$refresh_token = LPGCS_Options::get( 'refresh_token' );
		if ( ! $refresh_token ) {
			return '';
		}

		$response = wp_remote_post( self::TOKEN_ENDPOINT, array(
			'timeout' => 20,
			'body'    => array(
				'client_id'     => LPGCS_Options::get( 'client_id' ),
				'client_secret' => LPGCS_Options::get( 'client_secret' ),
				'refresh_token' => $refresh_token,
				'grant_type'    => 'refresh_token',
			),
		) );

		if ( is_wp_error( $response ) ) {
			self::log( 'Token refresh failed: ' . $response->get_error_message() );
			return '';
		}

		$body = json_decode( wp_remote_retrieve_body( $response ), true );
		if ( empty( $body['access_token'] ) ) {
			// A revoked/expired refresh token shows up here, surface it so the
			// admin knows to reconnect instead of silently never syncing.
			self::log( 'Token refresh returned no access token: ' . wp_remote_retrieve_body( $response ) );
			if ( isset( $body['error'] ) && 'invalid_grant' === $body['error'] ) {
				LPGCS_Options::set( 'last_auth_error', 'Google rejected the saved connection (invalid_grant). Please reconnect.' );
			}
			return '';
		}

		LPGCS_Options::delete( 'last_auth_error' );
		self::cache_access_token( $body['access_token'], isset( $body['expires_in'] ) ? (int) $body['expires_in'] : 3600 );
		return $body['access_token'];
	}

	private static function fetch_connected_email( $access_token ) {
		$response = wp_remote_get( 'https://www.googleapis.com/oauth2/v2/userinfo', array(
			'timeout' => 15,
			'headers' => array( 'Authorization' => 'Bearer ' . $access_token ),
		) );
		if ( is_wp_error( $response ) ) {
			return '';
		}
		$body = json_decode( wp_remote_retrieve_body( $response ), true );
		return isset( $body['email'] ) ? sanitize_email( $body['email'] ) : '';
	}

	/* ---------------------------------------------------------------------
	 * Calendar API calls
	 * ------------------------------------------------------------------- */

	/**
	 * Query free/busy for a calendar between two RFC3339 timestamps.
	 * Returns an array of ['start' => RFC3339, 'end' => RFC3339] busy blocks,
	 * or [] on any failure.
	 */
	public static function free_busy( $time_min_rfc3339, $time_max_rfc3339, $timezone_name ) {
		$token = self::get_access_token();
		if ( ! $token ) {
			return array();
		}

		$calendar_id = LPGCS_Options::calendar_id();
		$response    = wp_remote_post( self::API_BASE . '/freeBusy', array(
			'timeout' => 20,
			'headers' => array(
				'Authorization' => 'Bearer ' . $token,
				'Content-Type'  => 'application/json',
			),
			'body'    => wp_json_encode( array(
				'timeMin'  => $time_min_rfc3339,
				'timeMax'  => $time_max_rfc3339,
				'timeZone' => $timezone_name,
				'items'    => array( array( 'id' => $calendar_id ) ),
			) ),
		) );

		if ( is_wp_error( $response ) ) {
			self::log( 'freeBusy failed: ' . $response->get_error_message() );
			return array();
		}

		$body = json_decode( wp_remote_retrieve_body( $response ), true );
		if ( isset( $body['calendars'][ $calendar_id ]['busy'] ) && is_array( $body['calendars'][ $calendar_id ]['busy'] ) ) {
			return $body['calendars'][ $calendar_id ]['busy'];
		}

		// Some setups key the response by the resolved calendar address rather
		// than the literal 'primary' alias, so fall back to the first calendar.
		if ( isset( $body['calendars'] ) && is_array( $body['calendars'] ) ) {
			$first = reset( $body['calendars'] );
			if ( isset( $first['busy'] ) && is_array( $first['busy'] ) ) {
				return $first['busy'];
			}
		}

		return array();
	}

	/** Create an event. Returns the new event id, or '' on failure. */
	public static function insert_event( array $event ) {
		$token = self::get_access_token();
		if ( ! $token ) {
			return '';
		}
		$calendar_id = rawurlencode( LPGCS_Options::calendar_id() );
		$response    = wp_remote_post( self::API_BASE . '/calendars/' . $calendar_id . '/events', array(
			'timeout' => 20,
			'headers' => array(
				'Authorization' => 'Bearer ' . $token,
				'Content-Type'  => 'application/json',
			),
			'body'    => wp_json_encode( $event ),
		) );
		if ( is_wp_error( $response ) ) {
			self::log( 'insert_event failed: ' . $response->get_error_message() );
			return '';
		}
		$body = json_decode( wp_remote_retrieve_body( $response ), true );
		return isset( $body['id'] ) ? $body['id'] : '';
	}

	/** Update an existing event by id. Returns true on success. */
	public static function update_event( $event_id, array $event ) {
		$token = self::get_access_token();
		if ( ! $token || ! $event_id ) {
			return false;
		}
		$calendar_id = rawurlencode( LPGCS_Options::calendar_id() );
		$response    = wp_remote_request( self::API_BASE . '/calendars/' . $calendar_id . '/events/' . rawurlencode( $event_id ), array(
			'method'  => 'PATCH',
			'timeout' => 20,
			'headers' => array(
				'Authorization' => 'Bearer ' . $token,
				'Content-Type'  => 'application/json',
			),
			'body'    => wp_json_encode( $event ),
		) );
		if ( is_wp_error( $response ) ) {
			self::log( 'update_event failed: ' . $response->get_error_message() );
			return false;
		}
		$code = wp_remote_retrieve_response_code( $response );
		// 404/410 => the event was deleted in Google already; caller treats as "gone".
		return $code >= 200 && $code < 300;
	}

	/** Delete an event by id. Returns true if gone (deleted or already absent). */
	public static function delete_event( $event_id ) {
		$token = self::get_access_token();
		if ( ! $token || ! $event_id ) {
			return false;
		}
		$calendar_id = rawurlencode( LPGCS_Options::calendar_id() );
		$response    = wp_remote_request( self::API_BASE . '/calendars/' . $calendar_id . '/events/' . rawurlencode( $event_id ), array(
			'method'  => 'DELETE',
			'timeout' => 20,
			'headers' => array( 'Authorization' => 'Bearer ' . $token ),
		) );
		if ( is_wp_error( $response ) ) {
			self::log( 'delete_event failed: ' . $response->get_error_message() );
			return false;
		}
		$code = wp_remote_retrieve_response_code( $response );
		return ( $code >= 200 && $code < 300 ) || 404 === $code || 410 === $code;
	}

	public static function log( $message ) {
		if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
			error_log( '[LPGCS] ' . $message );
		}
	}
}
