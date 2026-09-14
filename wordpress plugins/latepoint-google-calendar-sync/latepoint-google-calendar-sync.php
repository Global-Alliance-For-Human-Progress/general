<?php
/**
 * Plugin Name: LatePoint Google Calendar Sync (Two-Way)
 * Description: Free two-way Google Calendar sync for LatePoint. Pushes LatePoint bookings into Google Calendar, and blocks LatePoint availability using your Google Calendar busy times. Companion plugin, LatePoint must be active.
 * Version: 1.0.0
 * Author: Liam Bartsch
 * License: GPL-2.0-or-later
 * Requires PHP: 7.4
 *
 * This is a companion to LatePoint, not a fork. It only uses LatePoint's public
 * action/filter hooks (verified against LatePoint 5.6.11):
 *   - latepoint_booking_created / _updated / _change_status / _will_be_deleted  (push out)
 *   - latepoint_get_booked_periods                                             (block in)
 * If LatePoint changes those hooks in a future release, sync stops silently,
 * see readme.txt "If sync stops working".
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'LPGCS_VERSION', '1.0.0' );
define( 'LPGCS_FILE', __FILE__ );
define( 'LPGCS_DIR', plugin_dir_path( __FILE__ ) );
define( 'LPGCS_SETTINGS_SLUG', 'lpgcs-settings' );

// The booking meta key we store the created Google event id under. Deliberately
// namespaced (not LatePoint's own 'google_calendar_event_id') so this plugin and
// the official paid addon can never fight over the same record.
define( 'LPGCS_EVENT_META_KEY', 'lpgcs_event_id' );

require_once LPGCS_DIR . 'includes/class-lpgcs-google-client.php';
require_once LPGCS_DIR . 'includes/class-lpgcs-settings.php';
require_once LPGCS_DIR . 'includes/class-lpgcs-sync.php';

/**
 * Central place for reading plugin options with sane defaults, so every class
 * reads them the same way.
 */
class LPGCS_Options {

	public static function get( $key, $default = '' ) {
		return get_option( 'lpgcs_' . $key, $default );
	}

	public static function set( $key, $value ) {
		return update_option( 'lpgcs_' . $key, $value );
	}

	public static function delete( $key ) {
		return delete_option( 'lpgcs_' . $key );
	}

	public static function is_connected() {
		return (bool) self::get( 'refresh_token', '' );
	}

	public static function sync_out_enabled() {
		return self::get( 'sync_out', '1' ) === '1';
	}

	public static function block_busy_enabled() {
		return self::get( 'block_busy', '1' ) === '1';
	}

	public static function calendar_id() {
		$cal = trim( (string) self::get( 'calendar_id', 'primary' ) );
		return $cal !== '' ? $cal : 'primary';
	}

	/** Which LatePoint agent this connected Google account represents. 0 = all/any. */
	public static function agent_id() {
		return (int) self::get( 'agent_id', 0 );
	}
}

/**
 * Boot the plugin after all plugins are loaded, so we can verify LatePoint is
 * present before wiring anything up.
 */
add_action( 'plugins_loaded', 'lpgcs_bootstrap', 20 );
function lpgcs_bootstrap() {
	$latepoint_active = defined( 'LATEPOINT_TABLE_BOOKINGS' ) || class_exists( 'OsBookingModel' );

	// Settings page always loads (so the admin can see the "LatePoint required" notice).
	new LPGCS_Settings();

	if ( ! $latepoint_active ) {
		add_action( 'admin_notices', function () {
			if ( ! current_user_can( 'manage_options' ) ) {
				return;
			}
			echo '<div class="notice notice-error"><p><strong>LatePoint Google Calendar Sync:</strong> LatePoint is not active. This companion plugin needs LatePoint installed and activated to do anything.</p></div>';
		} );
		return;
	}

	// Wire up the sync hooks only when LatePoint is really there.
	new LPGCS_Sync();
}
