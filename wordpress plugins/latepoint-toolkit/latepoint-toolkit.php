<?php
/**
 * Plugin Name: LatePoint Toolkit (iCloud Sync, Swiss Payments)
 * Description: Free LatePoint add-ons. Two-way Apple iCloud Calendar sync over CalDAV with ntfy alerts, plus fee-free Swiss payment options: QR-bill bank transfer, manual TWINT and prepaid voucher codes. Companion plugin, LatePoint must be active.
 * Version: 1.2.1
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
 *
 * The Swiss payments module (includes/payments/) also only uses LatePoint's
 * public payment hooks (verified against LatePoint 5.7.3):
 *   - latepoint_payment_processors, latepoint_get_all_payment_times,
 *     latepoint_get_enabled_payment_times                (register methods)
 *   - latepoint_step_payment__pay_content                (voucher input)
 *   - latepoint_process_payment_for_order_intent         (redeem voucher)
 *   - latepoint_step_confirmation_head_info_after,
 *     latepoint_order_created                            (payment instructions)
 * QR-bill and TWINT are "pay later" methods (instructions after booking, the
 * owner records the payment in LatePoint). Vouchers are "pay now".
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

// If the old "LatePoint iCloud Calendar Sync" plugin (folder latepoint-icloud-calendar-sync)
// is still active it already defined everything below. Bail out with a notice instead of
// a fatal "cannot redeclare" error. Deactivate the old plugin (do NOT delete it first, its
// uninstall routine would erase the saved iCloud settings that this plugin reuses).
if ( defined( 'LPICS_VERSION' ) ) {
	add_action( 'admin_notices', function () {
		if ( current_user_can( 'manage_options' ) ) {
			echo '<div class="notice notice-error"><p><strong>LatePoint Toolkit:</strong> another copy of this plugin (the older "LatePoint iCloud Calendar Sync") is active. Deactivate that one, but do not delete it, then this plugin will take over with your existing settings.</p></div>';
		}
	} );
	return;
}

define( 'LPICS_VERSION', '1.2.1' );
define( 'LPICS_FILE', __FILE__ );
define( 'LPICS_DIR', plugin_dir_path( __FILE__ ) );
define( 'LPICS_SETTINGS_SLUG', 'lpics-settings' );

// Swiss payments module.
define( 'LPSP_VERSION', LPICS_VERSION );
define( 'LPSP_URL', plugin_dir_url( __FILE__ ) );
define( 'LPSP_SETTINGS_SLUG', 'lpsp-settings' );

// Booking meta key we store the created iCloud event href (its CalDAV URL)
// under. Namespaced so this plugin, the Google sibling, and LatePoint's own
// paid addon can never fight over the same record.
define( 'LPICS_EVENT_META_KEY', 'lpics_event_href' );

require_once LPICS_DIR . 'includes/class-lpics-caldav-client.php';
require_once LPICS_DIR . 'includes/class-lpics-ntfy.php';
require_once LPICS_DIR . 'includes/class-lpics-settings.php';
require_once LPICS_DIR . 'includes/class-lpics-sync.php';
require_once LPICS_DIR . 'includes/class-lpics-options.php';
require_once LPICS_DIR . 'includes/payments/class-lpsp-qrbill.php';
require_once LPICS_DIR . 'includes/payments/class-lpsp-options.php';
require_once LPICS_DIR . 'includes/payments/class-lpsp-vouchers.php';
require_once LPICS_DIR . 'includes/payments/class-lpsp-methods.php';
require_once LPICS_DIR . 'includes/payments/class-lpsp-settings.php';

register_activation_hook( __FILE__, array( 'LPSP_Vouchers', 'install' ) );

require_once LPICS_DIR . 'includes/bootstrap.php';
