<?php
/**
 * Direct push notifications via ntfy (https://ntfy.sh). Independent of iCloud
 * Calendar, so the owner is alerted the moment a booking is created regardless of
 * which Apple ID the calendar sync writes as. The public ntfy.sh server needs no
 * account or API key; the topic name is the only secret.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class LPICS_Ntfy {

	const DEFAULT_SERVER = 'https://ntfy.sh';

	public static function topic() {
		return trim( (string) LPICS_Options::get( 'ntfy_topic', '' ) );
	}

	public static function server() {
		$server = trim( (string) LPICS_Options::get( 'ntfy_server', '' ) );
		return untrailingslashit( '' !== $server ? $server : self::DEFAULT_SERVER );
	}

	public static function is_enabled() {
		return '' !== self::topic();
	}

	/**
	 * Publish one message. Returns [ 'ok' => bool, 'error' => string ].
	 * $blocking=false fires and forgets, so a slow ntfy server never delays a
	 * booking request; the test button uses blocking to report the real result.
	 */
	public static function send( $title, $message, $blocking = true ) {
		if ( ! self::is_enabled() ) {
			return array( 'ok' => false, 'error' => 'No ntfy topic is set.' );
		}

		// JSON publish to the server root keeps UTF-8 titles intact (HTTP headers would not).
		$res = wp_remote_post( self::server(), array(
			'timeout'  => 10,
			'blocking' => $blocking,
			'headers'  => array( 'Content-Type' => 'application/json' ),
			'body'     => wp_json_encode( array(
				'topic'    => self::topic(),
				'title'    => $title,
				'message'  => $message,
				'priority' => 4,
				'tags'     => array( 'calendar' ),
			) ),
		) );

		if ( is_wp_error( $res ) ) {
			return array( 'ok' => false, 'error' => $res->get_error_message() );
		}
		if ( ! $blocking ) {
			return array( 'ok' => true, 'error' => '' );
		}
		$code = (int) wp_remote_retrieve_response_code( $res );
		if ( $code >= 200 && $code < 300 ) {
			return array( 'ok' => true, 'error' => '' );
		}
		return array(
			'ok'    => false,
			'error' => 'ntfy returned HTTP ' . $code . ': ' . substr( trim( wp_strip_all_tags( wp_remote_retrieve_body( $res ) ) ), 0, 200 ),
		);
	}
}
