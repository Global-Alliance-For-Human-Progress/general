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
		// 1.4.2: off by default, and switched off once on existing installs, because
		// a booking's own iCloud event made its slot unavailable to everyone else.
		if ( '1' !== self::get( 'block_busy_reset_142', '' ) ) {
			self::set( 'block_busy', '0' );
			self::set( 'block_busy_reset_142', '1' );
		}
		return self::get( 'block_busy', '0' ) === '1';
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

	/**
	 * Capacity list as typed, e.g. "20,10,3". One number applies to every service,
	 * several numbers apply to the services in order (oldest service first).
	 */
	public static function slot_capacity_raw() {
		return (string) self::get( 'slot_capacity', '' );
	}

	/** @return int[] parsed numbers, 0 = leave that service alone. */
	public static function slot_capacity_list() {
		$parts = preg_split( '/[\s,;]+/', self::slot_capacity_raw(), -1, PREG_SPLIT_NO_EMPTY );
		return array_map( function ( $n ) {
			return max( 0, min( 500, (int) $n ) );
		}, $parts );
	}

	/** LatePoint services in the order the capacity list applies to: [id => name]. */
	public static function services_in_order() {
		global $wpdb;
		if ( ! defined( 'LATEPOINT_TABLE_SERVICES' ) ) {
			return array();
		}
		$rows = $wpdb->get_results( 'SELECT id, name FROM ' . LATEPOINT_TABLE_SERVICES . ' ORDER BY id ASC' );
		$out  = array();
		foreach ( (array) $rows as $r ) {
			$out[ (int) $r->id ] = (string) $r->name;
		}
		return $out;
	}

	/**
	 * Write the chosen capacities into the LatePoint services. LatePoint core already
	 * enforces services.capacity_max when it checks a slot (OsBookingHelper::
	 * is_timeframe_in_booked_periods), but the free plugin has no field to edit it.
	 * A service we changed earlier and that is now off (0 or no value) goes back to 1.
	 */
	public static function apply_slot_capacity() {
		global $wpdb;
		if ( ! defined( 'LATEPOINT_TABLE_SERVICES' ) ) {
			return;
		}
		$list    = self::slot_capacity_list();
		$applied = (array) self::get( 'slot_capacity_applied', array() );
		$next    = array();
		$i       = 0;
		foreach ( array_keys( self::services_in_order() ) as $service_id ) {
			$cap = isset( $list[ $i ] ) ? $list[ $i ] : ( 1 === count( $list ) ? $list[0] : 0 );
			$i++;
			if ( $cap >= 2 ) {
				$wpdb->query( $wpdb->prepare( 'UPDATE ' . LATEPOINT_TABLE_SERVICES . ' SET capacity_min = 1, capacity_max = %d WHERE id = %d', $cap, $service_id ) );
				$next[ $service_id ] = $cap;
			} elseif ( ! empty( $applied[ $service_id ] ) ) {
				$wpdb->query( $wpdb->prepare( 'UPDATE ' . LATEPOINT_TABLE_SERVICES . ' SET capacity_min = 1, capacity_max = 1 WHERE id = %d', $service_id ) );
			}
		}
		self::set( 'slot_capacity_applied', $next );
	}
}
