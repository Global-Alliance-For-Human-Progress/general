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
	'lpics_last_auth_error',
);
foreach ( $options as $option ) {
	delete_option( $option );
}

global $wpdb;
$wpdb->query( "DELETE FROM {$wpdb->options} WHERE option_name LIKE '\_transient\_lpics\_busy\_%'" );
$wpdb->query( "DELETE FROM {$wpdb->options} WHERE option_name LIKE '\_transient\_timeout\_lpics\_busy\_%'" );
