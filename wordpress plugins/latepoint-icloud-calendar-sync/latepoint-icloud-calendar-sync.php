<?php
/**
 * Plugin Name: LatePoint iCloud Calendar Sync (Two-Way)
 * Description: Free two-way Apple iCloud Calendar sync for LatePoint over CalDAV. Pushes LatePoint bookings into an iCloud calendar, and blocks LatePoint availability using that calendar's busy times. Companion plugin, LatePoint must be active.
 * Version: 1.0.0
 * Author: Liam Bartsch
 * License: GPL-2.0-or-later
 * Requires PHP: 7.4
 *
 * Companion to LatePoint, not a fork. It only uses LatePoint's public
 * action/filter hooks (verified against LatePoint 5.6.11):
 *   - latepoint_booking_created / _updated / _change_status / _will_be_deleted  (push out)
 *   - latepoint_get_booked_periods                                             (block in)
 *
 * Unlike the Google sibling plugin, iCloud has no OAuth and no free/busy API,
 * so this talks raw CalDAV against caldav.icloud.com using an Apple ID plus an
 * app-specific password, and computes busy times by reading events in the
 * requested window (server-side expanded for recurrence). See readme.txt.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'LPICS_VERSION', '1.0.0' );
define( 'LPICS_FILE', __FILE__ );
define( 'LPICS_DIR', plugin_dir_path( __FILE__ ) );
define( 'LPICS_SETTINGS_SLUG', 'lpics-settings' );

// Booking meta key we store the created iCloud event href (its CalDAV URL)
// under. Namespaced so this plugin, the Google sibling, and LatePoint's own
// paid addon can never fight over the same record.
define( 'LPICS_EVENT_META_KEY', 'lpics_event_href' );

require_once LPICS_DIR . 'includes/class-lpics-caldav-client.php';
require_once LPICS_DIR . 'includes/class-lpics-settings.php';
require_once LPICS_DIR . 'includes/class-lpics-sync.php';

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

	/** Absolute CalDAV URL of the chosen calendar collection. */
	public static function calendar_url() {
		return trim( (string) self::get( 'calendar_url', '' ) );
	}

	/** Which LatePoint agent this connected iCloud account represents. 0 = all/any. */
	public static function agent_id() {
		return (int) self::get( 'agent_id', 0 );
	}
}

/**
 * Boot after all plugins are loaded, so we can verify LatePoint is present
 * before wiring anything up.
 */
add_action( 'plugins_loaded', 'lpics_bootstrap', 20 );
function lpics_bootstrap() {
	$latepoint_active = defined( 'LATEPOINT_TABLE_BOOKINGS' ) || class_exists( 'OsBookingModel' );

	// Settings page always loads (so the admin can see the "LatePoint required" notice).
	new LPICS_Settings();

	if ( ! $latepoint_active ) {
		add_action( 'admin_notices', function () {
			if ( ! current_user_can( 'manage_options' ) ) {
				return;
			}
			echo '<div class="notice notice-error"><p><strong>LatePoint iCloud Calendar Sync:</strong> LatePoint is not active. This companion plugin needs LatePoint installed and activated to do anything.</p></div>';
		} );
		return;
	}

	// Wire up the sync hooks only when LatePoint is really there.
	new LPICS_Sync();
}
