<?php
/**
 * Runs when the plugin is deleted (not just deactivated). Removes our options
 * and cached busy-time transients. Booking meta (the stored Google event ids)
 * is intentionally left in place: it is harmless, and keeping it avoids
 * orphaning events if the plugin is reinstalled.
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

$options = array(
	'lpgcs_client_id',
	'lpgcs_client_secret',
	'lpgcs_refresh_token',
	'lpgcs_connected_email',
	'lpgcs_agent_id',
	'lpgcs_calendar_id',
	'lpgcs_sync_out',
	'lpgcs_block_busy',
	'lpgcs_last_auth_error',
);
foreach ( $options as $option ) {
	delete_option( $option );
}

delete_transient( 'lpgcs_access_token' );

global $wpdb;
$wpdb->query( "DELETE FROM {$wpdb->options} WHERE option_name LIKE '\_transient\_lpgcs\_busy\_%'" );
$wpdb->query( "DELETE FROM {$wpdb->options} WHERE option_name LIKE '\_transient\_timeout\_lpgcs\_busy\_%'" );
