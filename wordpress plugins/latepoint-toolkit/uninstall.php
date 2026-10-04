<?php
/**
 * Runs when the plugin is deleted (not just deactivated). Removes our options
 * and cached busy-time transients. Booking meta (the stored iCloud event hrefs)
 * is intentionally left in place: it is harmless, and keeping it avoids
 * orphaning events if the plugin is reinstalled.
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

$options = array(
	'lpics_apple_id',
	'lpics_app_password',
	'lpics_calendar_url',
	'lpics_calendar_label',
	'lpics_calendar_home',
	'lpics_calendars',
	'lpics_agent_id',
	'lpics_sync_out',
	'lpics_block_busy',
	'lpics_notify_on_create',
	'lpics_ntfy_topic',
	'lpics_ntfy_server',
	'lpics_last_auth_error',
);
foreach ( $options as $option ) {
	delete_option( $option );
}

// Swiss payments module options. The voucher tables (wp_lpsp_vouchers,
// wp_lpsp_redemptions) are kept on purpose: they hold customer balances and
// should not vanish with a plugin delete. Drop them by hand if really wanted.
$payment_keys = array(
	'qr_enabled', 'qr_label', 'qr_iban', 'qr_name', 'qr_street', 'qr_building', 'qr_zip', 'qr_city',
	'qr_country', 'qr_currency', 'qr_message_prefix', 'twint_enabled', 'twint_label', 'twint_phone',
	'twint_qr_url', 'twint_instructions', 'voucher_enabled', 'voucher_label', 'send_email', 'db_version',
);
foreach ( $payment_keys as $key ) {
	delete_option( 'lpsp_' . $key );
}

global $wpdb;
$wpdb->query( "DELETE FROM {$wpdb->options} WHERE option_name LIKE '\_transient\_lpics\_busy\_%'" );
$wpdb->query( "DELETE FROM {$wpdb->options} WHERE option_name LIKE '\_transient\_timeout\_lpics\_busy\_%'" );
