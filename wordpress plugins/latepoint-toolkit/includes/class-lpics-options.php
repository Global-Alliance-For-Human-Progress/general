<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Central place for reading plugin options with sane defaults, so every class
 * reads them the same way.
 */
class LPICS_Options {

	public static function get( $key, $default = '' ) {
		return get_option( 'lpics_' . $key, $default );
	}

	public static function set( $key, $value ) {
		return update_option( 'lpics_' . $key, $value );
	}

	public static function delete( $key ) {
		return delete_option( 'lpics_' . $key );
	}

	/** Connected once we have credentials plus a chosen target calendar URL. */
	public static function is_connected() {
		return (bool) self::get( 'apple_id', '' )
			&& (bool) self::get( 'app_password', '' )
			&& (bool) self::get( 'calendar_url', '' );
	}

	public static function sync_out_enabled() {
		return self::get( 'sync_out', '1' ) === '1';
	}

	public static function block_busy_enabled() {
		return self::get( 'block_busy', '1' ) === '1';
	}

	/** Attach a "new booking" alarm to freshly-created events so the owner is alerted. */
	public static function notify_on_create_enabled() {
		return self::get( 'notify_on_create', '1' ) === '1';
	}

	/** Absolute CalDAV URL of the chosen calendar collection. */
	public static function calendar_url() {
		return trim( (string) self::get( 'calendar_url', '' ) );
	}

	/** Which LatePoint agent this connected iCloud account represents. 0 = all/any. */
	public static function agent_id() {
		return (int) self::get( 'agent_id', 0 );
	}
}
