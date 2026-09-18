<?php
/**
 * Thin CalDAV client for Apple iCloud, using only wp_remote_* (no Composer /
 * Sabre dependency to ship). It covers exactly what the sync layer needs:
 *
 *   - Discovery: Apple ID + app-specific password -> the account's calendars.
 *   - insert_event / update_event / delete_event: PUT / PUT / DELETE an .ics.
 *   - free_busy: a calendar-query REPORT with server-side recurrence expansion,
 *     whose returned VEVENTs are parsed into busy time ranges (iCloud has no
 *     clean free/busy API like Google's).
 *
 * Every public method fails soft: on any error it returns false / '' / [] and
 * logs, so an iCloud outage can never throw into LatePoint's booking flow.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class LPICS_CalDAV_Client {

	/** iCloud's CalDAV bootstrap host. Discovery redirects us to a pXX shard. */
	const BOOTSTRAP = 'https://caldav.icloud.com';

	/* =====================================================================
	 * Credentials + low-level HTTP
	 * =================================================================== */

	private static function auth_header() {
		$user = LPICS_Options::get( 'apple_id' );
		$pass = LPICS_Options::get( 'app_password' );
		if ( ! $user || ! $pass ) {
			return '';
		}
		// Apple shows app-specific passwords with dashes; they are entered as-is,
		// but users often paste with stray spaces. Strip spaces only.
		$pass = str_replace( ' ', '', $pass );
		return 'Basic ' . base64_encode( $user . ':' . $pass );
	}

	/**
	 * One CalDAV request that manually follows redirects (WP's HTTP API will not
	 * reliably re-send a PROPFIND/REPORT body across a 30x, and iCloud redirects
	 * the bootstrap host to a shard). Returns:
	 *   [ 'code' => int, 'body' => string, 'final_url' => string ] or WP_Error.
	 *
	 * @param string      $method PROPFIND|REPORT|PUT|DELETE|GET
	 * @param string      $url
	 * @param array       $headers
	 * @param string      $body
	 * @param string|null $depth  Depth header, or null to omit
	 */
	private static function request( $method, $url, $headers = array(), $body = '', $depth = null ) {
		$auth = self::auth_header();
		if ( ! $auth ) {
			return new WP_Error( 'lpics_no_credentials', 'Apple ID or app-specific password is missing.' );
		}

		$current = $url;
		$last    = null;

		for ( $hop = 0; $hop < 5; $hop++ ) {
			$args = array(
				'method'      => $method,
				'timeout'     => 25,
				'redirection' => 0, // we follow manually to preserve method + body
				'headers'     => array_merge(
					array( 'Authorization' => $auth ),
					$headers
				),
			);
			if ( null !== $depth ) {
				$args['headers']['Depth'] = (string) $depth;
			}
			if ( '' !== $body ) {
				$args['body'] = $body;
			}

			$response = wp_remote_request( $current, $args );
			if ( is_wp_error( $response ) ) {
				return $response;
			}

			$code = (int) wp_remote_retrieve_response_code( $response );
			if ( in_array( $code, array( 301, 302, 303, 307, 308 ), true ) ) {
				$location = wp_remote_retrieve_header( $response, 'location' );
				if ( ! $location ) {
					// Redirect with no target, give up and return what we have.
					return array(
						'code'      => $code,
						'body'      => wp_remote_retrieve_body( $response ),
						'final_url' => $current,
					);
				}
				$current = self::resolve_url( $current, $location );
				$last    = $current;
				continue;
			}

			return array(
				'code'      => $code,
				'body'      => wp_remote_retrieve_body( $response ),
				'final_url' => $last ? $last : $current,
			);
		}

		return new WP_Error( 'lpics_too_many_redirects', 'Too many redirects talking to iCloud.' );
	}

	/** Resolve a possibly-relative href against a base URL. */
	private static function resolve_url( $base, $href ) {
		$href = trim( $href );
		if ( '' === $href ) {
			return $base;
		}
		if ( preg_match( '#^https?://#i', $href ) ) {
			return $href;
		}
		$parts  = wp_parse_url( $base );
		$scheme = isset( $parts['scheme'] ) ? $parts['scheme'] : 'https';
		$host   = isset( $parts['host'] ) ? $parts['host'] : '';
		$port   = isset( $parts['port'] ) ? ':' . $parts['port'] : '';
		$origin = $scheme . '://' . $host . $port;

		if ( isset( $href[0] ) && '/' === $href[0] ) {
			return $origin . $href;
		}
		// Relative to the base path's directory.
		$path = isset( $parts['path'] ) ? $parts['path'] : '/';
		$dir  = rtrim( substr( $path, 0, strrpos( $path, '/' ) + 1 ), '' );
		return $origin . $dir . $href;
	}

	/* =====================================================================
	 * Discovery
	 * =================================================================== */

	/**
	 * Validate credentials and list the account's writable calendars.
	 * Returns [ 'ok' => bool, 'error' => string, 'calendars' => [ ['url','label'], ... ] ].
	 * On success it also caches the discovered list into options.
	 */
	public static function test_connection() {
		$principal = self::discover_principal();
		if ( is_wp_error( $principal ) ) {
			return array( 'ok' => false, 'error' => $principal->get_error_message(), 'calendars' => array() );
		}

		$home = self::discover_calendar_home( $principal );
		if ( is_wp_error( $home ) ) {
			return array( 'ok' => false, 'error' => $home->get_error_message(), 'calendars' => array() );
		}

		$calendars = self::list_calendars( $home );
		if ( is_wp_error( $calendars ) ) {
			return array( 'ok' => false, 'error' => $calendars->get_error_message(), 'calendars' => array() );
		}
		if ( empty( $calendars ) ) {
			return array( 'ok' => false, 'error' => 'Connected, but no writable calendars were found on this account.', 'calendars' => array() );
		}

		LPICS_Options::set( 'calendar_home', $home );
		LPICS_Options::set( 'calendars', $calendars );
		LPICS_Options::delete( 'last_auth_error' );

		return array( 'ok' => true, 'error' => '', 'calendars' => $calendars );
	}

	/** PROPFIND for current-user-principal. Returns absolute principal URL or WP_Error. */
	private static function discover_principal() {
		$body = '<?xml version="1.0" encoding="utf-8"?>'
			. '<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>';

		$res = self::request( 'PROPFIND', self::BOOTSTRAP . '/', array(
			'Content-Type' => 'application/xml; charset=utf-8',
		), $body, '0' );

		if ( is_wp_error( $res ) ) {
			return $res;
		}
		if ( 401 === $res['code'] ) {
			return new WP_Error( 'lpics_auth', 'iCloud rejected the Apple ID or app-specific password (401). Generate a fresh app-specific password at appleid.apple.com and try again.' );
		}
		if ( $res['code'] < 200 || $res['code'] >= 300 ) {
			return new WP_Error( 'lpics_principal', 'Could not read the iCloud account principal (HTTP ' . $res['code'] . ').' );
		}

		$href = self::first_href_in( $res['body'], 'DAV:', 'current-user-principal' );
		if ( ! $href ) {
			return new WP_Error( 'lpics_principal', 'iCloud did not return an account principal.' );
		}
		return self::resolve_url( $res['final_url'], $href );
	}

	/** PROPFIND the principal for calendar-home-set. Returns absolute home URL or WP_Error. */
	private static function discover_calendar_home( $principal_url ) {
		$body = '<?xml version="1.0" encoding="utf-8"?>'
			. '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">'
			. '<d:prop><c:calendar-home-set/></d:prop></d:propfind>';

		$res = self::request( 'PROPFIND', $principal_url, array(
			'Content-Type' => 'application/xml; charset=utf-8',
		), $body, '0' );

		if ( is_wp_error( $res ) ) {
			return $res;
		}
		if ( $res['code'] < 200 || $res['code'] >= 300 ) {
			return new WP_Error( 'lpics_home', 'Could not read the iCloud calendar home (HTTP ' . $res['code'] . ').' );
		}

		$href = self::first_href_in( $res['body'], 'urn:ietf:params:xml:ns:caldav', 'calendar-home-set' );
		if ( ! $href ) {
			return new WP_Error( 'lpics_home', 'iCloud did not return a calendar home.' );
		}
		return self::resolve_url( $res['final_url'], $href );
	}

	/**
	 * PROPFIND Depth:1 the calendar home and return writable VEVENT calendars as
	 * [ ['url' => absolute, 'label' => displayname], ... ].
	 */
	private static function list_calendars( $home_url ) {
		$body = '<?xml version="1.0" encoding="utf-8"?>'
			. '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">'
			. '<d:prop>'
			. '<d:displayname/>'
			. '<d:resourcetype/>'
			. '<c:supported-calendar-component-set/>'
			. '</d:prop></d:propfind>';

		$res = self::request( 'PROPFIND', $home_url, array(
			'Content-Type' => 'application/xml; charset=utf-8',
		), $body, '1' );

		if ( is_wp_error( $res ) ) {
			return $res;
		}
		if ( $res['code'] < 200 || $res['code'] >= 300 ) {
			return new WP_Error( 'lpics_list', 'Could not list iCloud calendars (HTTP ' . $res['code'] . ').' );
		}

		$dom = self::load_xml( $res['body'] );
		if ( ! $dom ) {
			return new WP_Error( 'lpics_list', 'iCloud returned an unreadable calendar list.' );
		}

		$calendars = array();
		$responses = $dom->getElementsByTagNameNS( 'DAV:', 'response' );
		foreach ( $responses as $response ) {
			$href_node = self::child_ns( $response, 'DAV:', 'href' );
			if ( ! $href_node ) {
				continue;
			}
			$href = trim( $href_node->textContent );
			if ( '' === $href ) {
				continue;
			}

			// Must be a calendar collection.
			$is_calendar = false;
			foreach ( $response->getElementsByTagNameNS( 'urn:ietf:params:xml:ns:caldav', 'calendar' ) as $unused ) {
				$is_calendar = true;
				break;
			}
			if ( ! $is_calendar ) {
				continue;
			}

			// Must support VEVENT (skip reminders / contacts-style collections).
			$supports_vevent = false;
			$has_comp_list   = false;
			foreach ( $response->getElementsByTagNameNS( 'urn:ietf:params:xml:ns:caldav', 'comp' ) as $comp ) {
				$has_comp_list = true;
				if ( 'VEVENT' === strtoupper( (string) $comp->getAttribute( 'name' ) ) ) {
					$supports_vevent = true;
					break;
				}
			}
			// If iCloud omitted the component set for this node, do not exclude it.
			if ( $has_comp_list && ! $supports_vevent ) {
				continue;
			}

			$label_node = self::descendant_ns( $response, 'DAV:', 'displayname' );
			$label      = $label_node ? trim( $label_node->textContent ) : '';
			$url        = self::resolve_url( $res['final_url'], $href );

			// Skip the calendar-home root itself (href equal to the home path).
			if ( untrailingslashit( $url ) === untrailingslashit( $home_url ) ) {
				continue;
			}

			$calendars[] = array(
				'url'   => $url,
				'label' => '' !== $label ? $label : $url,
			);
		}

		return $calendars;
	}

	/* =====================================================================
	 * Event write: insert / update / delete
	 * =================================================================== */

	/**
	 * Create an event. $event = [summary, description, start (DateTime),
	 * end (DateTime), booking_id]. Returns the new event's absolute href, or ''.
	 */
	public static function insert_event( array $event ) {
		$calendar = LPICS_Options::calendar_url();
		if ( ! $calendar ) {
			return '';
		}
		$uid = self::new_uid( $event );
		$url = untrailingslashit( $calendar ) . '/' . $uid . '.ics';
		// New event => attach the "new booking" alarm if the owner enabled it.
		$ics = self::build_ics( $uid, $event, LPICS_Options::notify_on_create_enabled() );

		$res = self::request( 'PUT', $url, array(
			'Content-Type' => 'text/calendar; charset=utf-8',
			'If-None-Match' => '*', // create-only; do not clobber an existing href
		), $ics );

		if ( is_wp_error( $res ) ) {
			self::log( 'insert_event failed: ' . $res->get_error_message() );
			return '';
		}
		if ( $res['code'] >= 200 && $res['code'] < 300 ) {
			return $url;
		}
		self::log( 'insert_event unexpected HTTP ' . $res['code'] . ' for ' . $url );
		return '';
	}

	/**
	 * Diagnostic: write a real test event into the target calendar using the exact
	 * same path as a booking sync, and report a human-readable result. Leaves the
	 * event in place so the admin can confirm it shows up in Apple Calendar, then
	 * delete it. Returns [ 'ok' => bool, 'error' => string, 'when' => string, 'href' => string ].
	 */
	public static function probe_write() {
		$calendar = LPICS_Options::calendar_url();
		if ( ! $calendar ) {
			return array( 'ok' => false, 'error' => 'No target calendar is selected.' );
		}

		$tz    = function_exists( 'wp_timezone' ) ? wp_timezone() : new DateTimeZone( 'UTC' );
		$start = new DateTime( 'now', $tz );
		$start->setTime( (int) $start->format( 'H' ), 0, 0 );
		$start->modify( '+1 hour' );
		$end = ( clone $start )->modify( '+30 minutes' );

		$event = array(
			'summary'     => 'LatePoint iCloud Sync - test event',
			'description' => 'Created by the "Send test event" button on the plugin settings page. Safe to delete.',
			'start'       => $start,
			'end'         => $end,
			'booking_id'  => 0,
		);

		$uid = self::new_uid( $event );
		$url = untrailingslashit( $calendar ) . '/' . $uid . '.ics';
		// Mirror a real new booking: include the creation alarm when enabled, so
		// this button also verifies the "new booking" notification works.
		$ics = self::build_ics( $uid, $event, LPICS_Options::notify_on_create_enabled() );

		$res = self::request( 'PUT', $url, array(
			'Content-Type'  => 'text/calendar; charset=utf-8',
			'If-None-Match' => '*',
		), $ics );

		if ( is_wp_error( $res ) ) {
			return array( 'ok' => false, 'error' => $res->get_error_message() );
		}
		if ( $res['code'] >= 200 && $res['code'] < 300 ) {
			return array(
				'ok'   => true,
				'href' => $url,
				'when' => $start->format( 'D, M j Y, H:i' ) . ' (' . $tz->getName() . ')',
			);
		}
		$body = trim( wp_strip_all_tags( (string) $res['body'] ) );
		return array(
			'ok'    => false,
			'error' => 'iCloud returned HTTP ' . $res['code'] . ' when writing the event.'
				. ( '' !== $body ? ' Response: ' . substr( $body, 0, 300 ) : '' ),
		);
	}

	/** Update an event at its stored href. Returns true on success, false if gone. */
	public static function update_event( $href, array $event ) {
		if ( ! $href ) {
			return false;
		}
		$uid = self::uid_from_href( $href );
		$ics = self::build_ics( $uid, $event );

		$res = self::request( 'PUT', $href, array(
			'Content-Type' => 'text/calendar; charset=utf-8',
		), $ics );

		if ( is_wp_error( $res ) ) {
			self::log( 'update_event failed: ' . $res->get_error_message() );
			return false;
		}
		if ( $res['code'] >= 200 && $res['code'] < 300 ) {
			return true;
		}
		// 404/410 => the event was deleted on iCloud; caller recreates it.
		return false;
	}

	/** Delete an event by href. Returns true if gone (deleted or already absent). */
	public static function delete_event( $href ) {
		if ( ! $href ) {
			return false;
		}
		$res = self::request( 'DELETE', $href );
		if ( is_wp_error( $res ) ) {
			self::log( 'delete_event failed: ' . $res->get_error_message() );
			return false;
		}
		$code = $res['code'];
		return ( $code >= 200 && $code < 300 ) || 404 === $code || 410 === $code;
	}

	/* =====================================================================
	 * Read busy times (Direction IN)
	 * =================================================================== */

	/**
	 * Report busy ranges for the target calendar between two RFC3339 timestamps.
	 * Returns [ ['start' => RFC3339, 'end' => RFC3339], ... ] or [] on failure.
	 *
	 * iCloud has no free/busy API, so we run a calendar-query REPORT with a
	 * time-range filter and server-side <expand>, then parse the returned
	 * (already recurrence-expanded) VEVENTs into busy ranges.
	 */
	public static function free_busy( $time_min_rfc3339, $time_max_rfc3339, $timezone_name ) {
		$calendar = LPICS_Options::calendar_url();
		if ( ! $calendar ) {
			return array();
		}

		try {
			$min = new DateTime( $time_min_rfc3339 );
			$max = new DateTime( $time_max_rfc3339 );
		} catch ( Exception $e ) {
			return array();
		}
		$min->setTimezone( new DateTimeZone( 'UTC' ) );
		$max->setTimezone( new DateTimeZone( 'UTC' ) );
		$start_utc = $min->format( 'Ymd\THis\Z' );
		$end_utc   = $max->format( 'Ymd\THis\Z' );

		$body = '<?xml version="1.0" encoding="utf-8"?>'
			. '<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">'
			. '<d:prop><c:calendar-data><c:expand start="' . $start_utc . '" end="' . $end_utc . '"/></c:calendar-data></d:prop>'
			. '<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">'
			. '<c:time-range start="' . $start_utc . '" end="' . $end_utc . '"/>'
			. '</c:comp-filter></c:comp-filter></c:filter>'
			. '</c:calendar-query>';

		$res = self::request( 'REPORT', $calendar, array(
			'Content-Type' => 'application/xml; charset=utf-8',
		), $body, '1' );

		if ( is_wp_error( $res ) ) {
			self::log( 'free_busy REPORT failed: ' . $res->get_error_message() );
			if ( 'lpics_no_credentials' === $res->get_error_code() ) {
				LPICS_Options::set( 'last_auth_error', 'iCloud credentials are missing or were cleared. Please reconnect.' );
			}
			return array();
		}
		if ( 401 === $res['code'] ) {
			LPICS_Options::set( 'last_auth_error', 'iCloud rejected the saved connection (401). Please reconnect with a fresh app-specific password.' );
			return array();
		}
		if ( $res['code'] < 200 || $res['code'] >= 300 ) {
			self::log( 'free_busy REPORT unexpected HTTP ' . $res['code'] );
			return array();
		}

		$dom = self::load_xml( $res['body'] );
		if ( ! $dom ) {
			return array();
		}

		$business_tz = self::safe_tz( $timezone_name );
		$busy        = array();
		$data_nodes  = $dom->getElementsByTagNameNS( 'urn:ietf:params:xml:ns:caldav', 'calendar-data' );
		$processed   = 0;
		foreach ( $data_nodes as $node ) {
			$ics = $node->textContent;
			if ( '' === trim( $ics ) ) {
				continue;
			}
			foreach ( self::parse_ics_busy( $ics, $business_tz ) as $range ) {
				$busy[] = $range;
				if ( ++$processed > 5000 ) {
					break 2; // safety cap against a pathological calendar
				}
			}
		}

		return $busy;
	}

	/* =====================================================================
	 * ICS build + parse
	 * =================================================================== */

	private static function new_uid( array $event ) {
		$booking = isset( $event['booking_id'] ) ? (int) $event['booking_id'] : 0;
		// wp_generate_uuid4 keeps it unique even for two events on the same booking.
		$rand = function_exists( 'wp_generate_uuid4' ) ? wp_generate_uuid4() : md5( uniqid( (string) $booking, true ) );
		return 'lpics-' . $booking . '-' . $rand;
	}

	private static function uid_from_href( $href ) {
		$base = basename( wp_parse_url( $href, PHP_URL_PATH ) );
		return preg_replace( '/\.ics$/i', '', $base );
	}

	/**
	 * Build a VCALENDAR/VEVENT in UTC. Emitting UTC (Z) times avoids shipping a
	 * VTIMEZONE component while staying unambiguous on all Apple devices.
	 *
	 * When $include_creation_alarm is true, a VALARM with an absolute trigger a
	 * short time from now is attached, so the account owner's Apple devices ping
	 * shortly after the event lands (a "new booking came in" alert). This is only
	 * meant for freshly-created events, not updates, so we don't re-ping on every
	 * status change.
	 */
	private static function build_ics( $uid, array $event, $include_creation_alarm = false ) {
		$utc = new DateTimeZone( 'UTC' );

		$start = clone $event['start'];
		$end   = clone $event['end'];
		$start->setTimezone( $utc );
		$end->setTimezone( $utc );

		$now         = gmdate( 'Ymd\THis\Z' );
		$summary     = self::ics_escape( isset( $event['summary'] ) ? $event['summary'] : 'Appointment' );
		$description = self::ics_escape( isset( $event['description'] ) ? $event['description'] : '' );
		$booking_id  = isset( $event['booking_id'] ) ? (int) $event['booking_id'] : 0;

		$lines   = array();
		$lines[] = 'BEGIN:VCALENDAR';
		$lines[] = 'VERSION:2.0';
		$lines[] = 'PRODID:-//LatePoint iCloud Calendar Sync//EN';
		$lines[] = 'CALSCALE:GREGORIAN';
		$lines[] = 'BEGIN:VEVENT';
		$lines[] = 'UID:' . $uid;
		$lines[] = 'DTSTAMP:' . $now;
		$lines[] = 'DTSTART:' . $start->format( 'Ymd\THis\Z' );
		$lines[] = 'DTEND:' . $end->format( 'Ymd\THis\Z' );
		$lines[] = 'SUMMARY:' . $summary;
		if ( '' !== $description ) {
			$lines[] = 'DESCRIPTION:' . $description;
		}
		$lines[] = 'X-LPICS-BOOKING-ID:' . $booking_id;

		if ( $include_creation_alarm ) {
			// Absolute trigger a short way into the future (default 2 min), timed
			// from when the ICS is actually built/sent, so it is still in the
			// future when the device receives it and therefore reliably fires.
			$offset = (int) apply_filters( 'lpics_creation_alarm_offset_seconds', 2 * MINUTE_IN_SECONDS );
			if ( $offset < 0 ) {
				$offset = 0;
			}
			$trigger    = gmdate( 'Ymd\THis\Z', time() + $offset );
			$alarm_text = '' !== $summary ? $summary : 'New booking'; // $summary is already ICS-escaped above
			$lines[]    = 'BEGIN:VALARM';
			$lines[]    = 'ACTION:DISPLAY';
			$lines[]    = 'DESCRIPTION:' . $alarm_text;
			$lines[]    = 'TRIGGER;VALUE=DATE-TIME:' . $trigger;
			$lines[]    = 'END:VALARM';
		}

		$lines[] = 'END:VEVENT';
		$lines[] = 'END:VCALENDAR';

		$folded = array_map( array( __CLASS__, 'ics_fold' ), $lines );
		return implode( "\r\n", $folded ) . "\r\n";
	}

	/** RFC 5545 TEXT escaping. */
	private static function ics_escape( $value ) {
		$value = (string) $value;
		$value = str_replace( '\\', '\\\\', $value );
		$value = str_replace( array( "\r\n", "\r", "\n" ), '\\n', $value );
		$value = str_replace( ';', '\\;', $value );
		$value = str_replace( ',', '\\,', $value );
		return $value;
	}

	/** RFC 5545 line folding at 75 octets. */
	private static function ics_fold( $line ) {
		if ( strlen( $line ) <= 75 ) {
			return $line;
		}
		$out   = '';
		$chunk = 75;
		$out   = substr( $line, 0, $chunk );
		$rest  = substr( $line, $chunk );
		while ( strlen( $rest ) > 0 ) {
			$out .= "\r\n " . substr( $rest, 0, $chunk - 1 );
			$rest = substr( $rest, $chunk - 1 );
		}
		return $out;
	}

	/**
	 * Parse an (expanded) VCALENDAR string into busy ranges. Skips cancelled,
	 * transparent (free), and all-day events. All-day blocking can be enabled
	 * via the lpics_block_all_day filter.
	 *
	 * @return array<int, array{start:string,end:string}> RFC3339 UTC ranges.
	 */
	private static function parse_ics_busy( $ics, DateTimeZone $business_tz ) {
		$unfolded = preg_replace( "/\r\n[ \t]/", '', $ics );
		$unfolded = preg_replace( "/\n[ \t]/", '', $unfolded );
		$lines    = preg_split( "/\r\n|\n|\r/", $unfolded );

		$block_all_day = (bool) apply_filters( 'lpics_block_all_day', false );
		$out           = array();

		$in_event = false;
		$cur      = array();
		foreach ( $lines as $line ) {
			if ( 'BEGIN:VEVENT' === $line ) {
				$in_event = true;
				$cur      = array();
				continue;
			}
			if ( 'END:VEVENT' === $line ) {
				$in_event = false;
				$range    = self::event_to_busy( $cur, $business_tz, $block_all_day );
				if ( $range ) {
					$out[] = $range;
				}
				continue;
			}
			if ( ! $in_event ) {
				continue;
			}

			$colon = strpos( $line, ':' );
			if ( false === $colon ) {
				continue;
			}
			$name_part = substr( $line, 0, $colon );
			$value     = substr( $line, $colon + 1 );

			$params = array();
			$name   = $name_part;
			if ( false !== strpos( $name_part, ';' ) ) {
				$segments = explode( ';', $name_part );
				$name     = array_shift( $segments );
				foreach ( $segments as $seg ) {
					$eq = strpos( $seg, '=' );
					if ( false !== $eq ) {
						$params[ strtoupper( substr( $seg, 0, $eq ) ) ] = trim( substr( $seg, $eq + 1 ), '"' );
					}
				}
			}
			$name = strtoupper( $name );

			switch ( $name ) {
				case 'DTSTART':
					$cur['dtstart']        = $value;
					$cur['dtstart_params'] = $params;
					break;
				case 'DTEND':
					$cur['dtend']        = $value;
					$cur['dtend_params'] = $params;
					break;
				case 'DURATION':
					$cur['duration'] = $value;
					break;
				case 'STATUS':
					$cur['status'] = strtoupper( trim( $value ) );
					break;
				case 'TRANSP':
					$cur['transp'] = strtoupper( trim( $value ) );
					break;
			}
		}

		return $out;
	}

	/** Turn one parsed VEVENT's fields into a UTC busy range, or null to skip. */
	private static function event_to_busy( array $cur, DateTimeZone $business_tz, $block_all_day ) {
		if ( empty( $cur['dtstart'] ) ) {
			return null;
		}
		if ( isset( $cur['status'] ) && 'CANCELLED' === $cur['status'] ) {
			return null;
		}
		if ( isset( $cur['transp'] ) && 'TRANSPARENT' === $cur['transp'] ) {
			return null; // marked "free", does not occupy time
		}

		$start_params = isset( $cur['dtstart_params'] ) ? $cur['dtstart_params'] : array();
		$is_all_day   = ( isset( $start_params['VALUE'] ) && 'DATE' === strtoupper( $start_params['VALUE'] ) )
			|| preg_match( '/^\d{8}$/', $cur['dtstart'] );

		if ( $is_all_day && ! $block_all_day ) {
			return null; // birthdays / holidays should not block bookings by default
		}

		$start = self::parse_dt( $cur['dtstart'], $start_params, $business_tz );
		if ( ! $start ) {
			return null;
		}

		$end = null;
		if ( ! empty( $cur['dtend'] ) ) {
			$end = self::parse_dt( $cur['dtend'], isset( $cur['dtend_params'] ) ? $cur['dtend_params'] : array(), $business_tz );
		} elseif ( ! empty( $cur['duration'] ) ) {
			$end = self::apply_duration( $start, $cur['duration'] );
		} elseif ( $is_all_day ) {
			$end = ( clone $start )->modify( '+1 day' );
		}
		if ( ! $end || $end <= $start ) {
			return null;
		}

		return array(
			'start' => $start->format( DateTime::RFC3339 ),
			'end'   => $end->format( DateTime::RFC3339 ),
		);
	}

	/**
	 * Parse an iCalendar date/date-time value into a UTC DateTime.
	 * Handles: YYYYMMDD (all-day), ...Z (UTC), TZID param, and floating
	 * (interpreted in the business timezone).
	 */
	private static function parse_dt( $value, array $params, DateTimeZone $business_tz ) {
		$value = trim( $value );

		try {
			// All-day date.
			if ( preg_match( '/^\d{8}$/', $value ) ) {
				$dt = DateTime::createFromFormat( 'Ymd', $value, $business_tz );
				if ( ! $dt ) {
					return null;
				}
				$dt->setTime( 0, 0, 0 );
			} elseif ( preg_match( '/Z$/', $value ) ) {
				$dt = new DateTime( $value, new DateTimeZone( 'UTC' ) );
			} elseif ( isset( $params['TZID'] ) ) {
				$tz = self::safe_tz( $params['TZID'], $business_tz );
				$dt = DateTime::createFromFormat( 'Ymd\THis', $value, $tz );
				if ( ! $dt ) {
					$dt = new DateTime( $value, $tz );
				}
			} else {
				// Floating time, interpret in the business timezone.
				$dt = DateTime::createFromFormat( 'Ymd\THis', $value, $business_tz );
				if ( ! $dt ) {
					$dt = new DateTime( $value, $business_tz );
				}
			}
		} catch ( Exception $e ) {
			return null;
		}

		if ( ! $dt ) {
			return null;
		}
		$dt->setTimezone( new DateTimeZone( 'UTC' ) );
		return $dt;
	}

	private static function apply_duration( DateTime $start, $duration ) {
		$duration = trim( $duration );
		$negative = ( isset( $duration[0] ) && '-' === $duration[0] );
		$duration = ltrim( $duration, '+-' );
		try {
			$interval = new DateInterval( $duration );
		} catch ( Exception $e ) {
			return null;
		}
		$end = clone $start;
		if ( $negative ) {
			$end->sub( $interval );
		} else {
			$end->add( $interval );
		}
		return $end;
	}

	private static function safe_tz( $name, DateTimeZone $fallback = null ) {
		if ( null === $fallback ) {
			$fallback = new DateTimeZone( 'UTC' );
		}
		if ( ! $name ) {
			return $fallback;
		}
		try {
			return new DateTimeZone( $name );
		} catch ( Exception $e ) {
			return $fallback;
		}
	}

	/* =====================================================================
	 * XML helpers
	 * =================================================================== */

	private static function load_xml( $body ) {
		if ( '' === trim( (string) $body ) ) {
			return null;
		}
		$prev = libxml_use_internal_errors( true );
		$dom  = new DOMDocument();
		$ok   = $dom->loadXML( $body );
		libxml_clear_errors();
		libxml_use_internal_errors( $prev );
		return $ok ? $dom : null;
	}

	/** First <href> found inside the first element (ns:local) in a multistatus body. */
	private static function first_href_in( $body, $ns, $local ) {
		$dom = self::load_xml( $body );
		if ( ! $dom ) {
			return '';
		}
		$nodes = $dom->getElementsByTagNameNS( $ns, $local );
		foreach ( $nodes as $node ) {
			$href = self::descendant_ns( $node, 'DAV:', 'href' );
			if ( $href ) {
				return trim( $href->textContent );
			}
		}
		return '';
	}

	private static function child_ns( DOMNode $parent, $ns, $local ) {
		foreach ( $parent->childNodes as $child ) {
			if ( XML_ELEMENT_NODE === $child->nodeType && $child->namespaceURI === $ns && $child->localName === $local ) {
				return $child;
			}
		}
		return null;
	}

	private static function descendant_ns( DOMElement $parent, $ns, $local ) {
		$nodes = $parent->getElementsByTagNameNS( $ns, $local );
		return $nodes->length ? $nodes->item( 0 ) : null;
	}

	public static function log( $message ) {
		if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
			error_log( '[LPICS] ' . $message );
		}
	}
}
