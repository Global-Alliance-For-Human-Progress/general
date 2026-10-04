<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Boot after all plugins are loaded, so we can verify LatePoint is present
 * before wiring anything up.
 */
add_action( 'plugins_loaded', 'lpics_bootstrap', 20 );
function lpics_bootstrap() {
	$latepoint_active = defined( 'LATEPOINT_TABLE_BOOKINGS' ) || class_exists( 'OsBookingModel' );

	// Make sure the voucher tables exist after plugin updates too (activation does not run on update).
	LPSP_Vouchers::maybe_upgrade();

	// Settings pages always load (so the admin can see the "LatePoint required" notice).
	new LPICS_Settings();
	new LPSP_Settings();

	if ( ! $latepoint_active ) {
		add_action( 'admin_notices', function () {
			if ( ! current_user_can( 'manage_options' ) ) {
				return;
			}
			echo '<div class="notice notice-error"><p><strong>LatePoint Toolkit:</strong> LatePoint is not active. This companion plugin needs LatePoint installed and activated to do anything.</p></div>';
		} );
		return;
	}

	// Wire up the sync hooks only when LatePoint is really there.
	new LPICS_Sync();
	new LPSP_Methods();
}
