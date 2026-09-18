<?php
/**
 * The actual two-way sync, wired onto LatePoint's public hooks.
 *
 * Direction OUT (LatePoint -> iCloud):
 *   latepoint_booking_created / _updated / _change_status / _will_be_deleted
 *   create / update / delete an iCloud event mirroring the booking.
 *
 * Direction IN (iCloud -> LatePoint):
 *   latepoint_get_booked_periods
 *   inject the connected calendar's busy blocks as LatePoint BookedPeriod
 *   objects so those times stop being offered as bookable slots.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class LPICS_Sync {

	/** WP-Cron hook that performs the actual iCloud write, off the booking request. */
	const CRON_HOOK = 'lpics_process_booking_sync';

	/** Per-request cache of busy lookups, keyed by "from|to". */
	private $busy_request_cache = array();

	public function __construct() {
		// --- Direction OUT ---
		// The booking hooks below only *schedule* the sync; the network call to
		// iCloud happens later on self::CRON_HOOK, so a slow or failing CalDAV
		// request can never block (or break) LatePoint's booking-save request.
		if ( LPICS_Options::sync_out_enabled() ) {
			add_action( 'latepoint_booking_created', array( $this, 'on_booking_created' ), 20, 1 );
			add_action( 'latepoint_booking_updated', array( $this, 'on_booking_updated' ), 20, 2 );
			add_action( 'latepoint_booking_change_status', array( $this, 'on_booking_updated' ), 20, 2 );
			add_action( 'latepoint_booking_will_be_deleted', array( $this, 'on_booking_will_be_deleted' ), 20, 1 );
		}

		// Background worker. Registered unconditionally so any already-queued
		// event still resolves even if sync-out was toggled off in the meantime.
		add_action( self::CRON_HOOK, array( $this, 'process_scheduled_sync' ), 10, 3 );

		// --- Direction IN ---
		if ( LPICS_Options::block_busy_enabled() ) {
			add_filter( 'latepoint_get_booked_periods', array( $this, 'inject_icloud_busy_periods' ), 20, 2 );
		}
	}

	/* =====================================================================
	 * Scheduling: keep the network call off the booking request
	 * =================================================================== */

	/**
	 * Queue a background sync. Every booking hook funnels through here so the
	 * LatePoint request returns immediately. Wrapped so nothing that happens in
	 * a booking hook can ever bubble an exception back into LatePoint.
	 */
	private function schedule( $op, $booking_id, $href = '' ) {
		try {
			$booking_id = (int) $booking_id;
			if ( ! $booking_id ) {
				return;
			}
			$args = array( $op, $booking_id, (string) $href );
			if ( ! wp_next_scheduled( self::CRON_HOOK, $args ) ) {
				wp_schedule_single_event( time(), self::CRON_HOOK, $args );
			}
			// Nudge WP-Cron so it runs within moments, via a non-blocking loopback
			// request (returns instantly, does not delay this response).
			if ( function_exists( 'spawn_cron' ) ) {
				spawn_cron();
			}
			LPICS_CalDAV_Client::log( 'scheduled ' . $op . ' for booking #' . $booking_id . '.' );
		} catch ( \Throwable $e ) {
			LPICS_CalDAV_Client::log( 'schedule(' . $op . ') error: ' . $e->getMessage() );
		}
	}

	/**
	 * WP-Cron worker: run the real iCloud write now that we are off the booking
	 * request. Never throws; a failure just gets logged.
	 */
	public function process_scheduled_sync( $op, $booking_id, $href = '' ) {
		try {
			if ( 'delete' === $op ) {
				if ( $href ) {
					LPICS_CalDAV_Client::delete_event( $href );
				}
				return;
			}
			$booking = $this->load_booking( (int) $booking_id );
			if ( ! $booking ) {
				LPICS_CalDAV_Client::log( 'scheduled upsert: booking #' . (int) $booking_id . ' no longer loadable.' );
				return;
			}
			$this->upsert_event_for_booking( $booking );
		} catch ( \Throwable $e ) {
			LPICS_CalDAV_Client::log( 'process_scheduled_sync error: ' . $e->getMessage() );
		}
	}

	/** Read our stored event href off a booking, tolerating LatePoint API differences. */
	private function get_booking_href( $booking ) {
		if ( is_object( $booking ) && method_exists( $booking, 'get_meta_by_key' ) ) {
			return (string) $booking->get_meta_by_key( LPICS_EVENT_META_KEY, '' );
		}
		return '';
	}

	/** Store (or clear) our event href on a booking, tolerating LatePoint API differences. */
	private function set_booking_href( $booking, $href ) {
		if ( is_object( $booking ) && method_exists( $booking, 'save_meta_by_key' ) ) {
			$booking->save_meta_by_key( LPICS_EVENT_META_KEY, $href );
		}
	}

	/* =====================================================================
	 * Shared helpers
	 * =================================================================== */

	/** WP/business timezone that LatePoint stores booking times in. */
	private function timezone() {
		$name = 'UTC';
		if ( class_exists( 'OsTimeHelper' ) && method_exists( 'OsTimeHelper', 'get_wp_timezone_name' ) ) {
			$name = OsTimeHelper::get_wp_timezone_name();
		} else {
			$name = wp_timezone_string();
		}
		try {
			return new DateTimeZone( $name );
		} catch ( Exception $e ) {
			return new DateTimeZone( 'UTC' );
		}
	}

	private function timezone_name() {
		return $this->timezone()->getName();
	}

	/**
	 * Build a DateTime from a LatePoint date ('Y-m-d') + minutes-from-midnight.
	 * LatePoint stores start_time/end_time as integer minutes since 00:00.
	 */
	private function datetime_from( $date, $minutes ) {
		$dt = DateTime::createFromFormat( 'Y-m-d H:i:s', $date . ' 00:00:00', $this->timezone() );
		if ( ! $dt ) {
			return null;
		}
		$dt->modify( '+' . (int) $minutes . ' minutes' );
		return $dt;
	}

	/** Does this booking belong to the agent whose iCloud account we synced? */
	private function agent_matches( $agent_id ) {
		$configured = LPICS_Options::agent_id();
		if ( ! $configured ) {
			return true; // 0 = apply to all agents (fine for single-agent sites)
		}
		return (int) $agent_id === $configured;
	}

	/**
	 * A booking status that occupies real time (should have a calendar event).
	 * Cancelled / no-show do not, so their event gets removed.
	 */
	private function status_occupies_time( $status ) {
		$freeing = array();
		if ( defined( 'LATEPOINT_BOOKING_STATUS_CANCELLED' ) ) {
			$freeing[] = LATEPOINT_BOOKING_STATUS_CANCELLED;
		} else {
			$freeing[] = 'cancelled';
		}
		if ( defined( 'LATEPOINT_BOOKING_STATUS_NO_SHOW' ) ) {
			$freeing[] = LATEPOINT_BOOKING_STATUS_NO_SHOW;
		} else {
			$freeing[] = 'no_show';
		}
		return ! in_array( $status, $freeing, true );
	}

	/* =====================================================================
	 * Direction OUT: LatePoint booking -> iCloud event
	 * =================================================================== */

	public function on_booking_created( $booking ) {
		if ( is_object( $booking ) && ! empty( $booking->id ) ) {
			$this->schedule( 'upsert', (int) $booking->id );
		}
	}

	public function on_booking_updated( $booking, $old_booking = null ) {
		if ( is_object( $booking ) && ! empty( $booking->id ) ) {
			$this->schedule( 'upsert', (int) $booking->id );
		}
	}

	public function on_booking_will_be_deleted( $booking_id ) {
		// The href must be read now, before the booking (and its meta) is gone.
		try {
			$booking = $this->load_booking( (int) $booking_id );
			if ( ! $booking ) {
				return;
			}
			$href = $this->get_booking_href( $booking );
			if ( $href ) {
				$this->set_booking_href( $booking, '' );
				$this->schedule( 'delete', (int) $booking_id, $href );
			}
		} catch ( \Throwable $e ) {
			LPICS_CalDAV_Client::log( 'on_booking_will_be_deleted error: ' . $e->getMessage() );
		}
	}

	private function load_booking( $booking_id ) {
		if ( ! class_exists( 'OsBookingModel' ) || ! $booking_id ) {
			return null;
		}
		$booking = new OsBookingModel();
		$loaded  = $booking->load_by_id( (int) $booking_id );
		return ( $loaded && ! empty( $booking->id ) ) ? $booking : null;
	}

	/**
	 * Create/update/delete the iCloud event to match the current booking state.
	 * Never throws, a CalDAV failure just leaves the mapping as-is.
	 */
	private function upsert_event_for_booking( $booking ) {
		if ( ! LPICS_Options::is_connected() ) {
			LPICS_CalDAV_Client::log( 'upsert skipped: not connected (need Apple ID + password + target calendar).' );
			return;
		}
		if ( empty( $booking ) || empty( $booking->id ) ) {
			LPICS_CalDAV_Client::log( 'upsert skipped: booking object was empty or had no id.' );
			return;
		}
		LPICS_CalDAV_Client::log( 'upsert fired for booking #' . $booking->id
			. ' (agent_id=' . ( isset( $booking->agent_id ) ? $booking->agent_id : 'n/a' )
			. ', status=' . ( isset( $booking->status ) ? $booking->status : 'n/a' )
			. ', start_date=' . ( isset( $booking->start_date ) ? $booking->start_date : 'n/a' )
			. ', start_time=' . ( isset( $booking->start_time ) ? $booking->start_time : 'n/a' ) . ').' );
		if ( ! $this->agent_matches( isset( $booking->agent_id ) ? $booking->agent_id : 0 ) ) {
			LPICS_CalDAV_Client::log( 'upsert skipped: booking agent_id does not match the configured agent ('
				. LPICS_Options::agent_id() . ').' );
			return;
		}

		$existing_href = $this->get_booking_href( $booking );

		// If the booking no longer occupies time (cancelled/no-show), remove any event.
		if ( isset( $booking->status ) && ! $this->status_occupies_time( $booking->status ) ) {
			if ( $existing_href ) {
				LPICS_CalDAV_Client::delete_event( $existing_href );
				$this->set_booking_href( $booking, '' );
			}
			return;
		}

		$start = $this->datetime_from( $booking->start_date, $booking->start_time );
		$end   = $this->datetime_from(
			! empty( $booking->end_date ) ? $booking->end_date : $booking->start_date,
			$booking->end_time
		);
		if ( ! $start || ! $end || $end <= $start ) {
			LPICS_CalDAV_Client::log( 'upsert skipped for booking #' . $booking->id
				. ': could not build a valid start/end time from start_date/start_time/end_time.' );
			return;
		}

		$event = array(
			'summary'     => $this->event_summary( $booking ),
			'description' => $this->event_description( $booking ),
			'start'       => $start,
			'end'         => $end,
			'booking_id'  => (int) $booking->id,
		);

		if ( $existing_href ) {
			$ok = LPICS_CalDAV_Client::update_event( $existing_href, $event );
			if ( ! $ok ) {
				// Event vanished on iCloud, recreate it.
				$new_href = LPICS_CalDAV_Client::insert_event( $event );
				$this->set_booking_href( $booking, $new_href ? $new_href : '' );
			}
		} else {
			$new_href = LPICS_CalDAV_Client::insert_event( $event );
			if ( $new_href ) {
				$this->set_booking_href( $booking, $new_href );
				LPICS_CalDAV_Client::log( 'inserted iCloud event for booking #' . $booking->id . ' at ' . $new_href );
			} else {
				LPICS_CalDAV_Client::log( 'insert_event returned empty for booking #' . $booking->id
					. ' (see the HTTP error logged above).' );
			}
		}
	}

	private function event_summary( $booking ) {
		$service_name = '';
		if ( method_exists( $booking, 'get_service_name_for_summary' ) ) {
			$service_name = (string) $booking->get_service_name_for_summary();
		}
		$customer_name = $this->customer_name( $booking );

		$parts = array_filter( array( $service_name, $customer_name ) );
		$title = $parts ? implode( ' - ', $parts ) : 'Appointment';

		/**
		 * Filter the iCloud Calendar event title for a LatePoint booking.
		 *
		 * @param string $title
		 * @param object $booking
		 */
		return apply_filters( 'lpics_event_summary', $title, $booking );
	}

	private function event_description( $booking ) {
		$lines         = array();
		$customer_name = $this->customer_name( $booking );
		if ( $customer_name ) {
			$lines[] = 'Client: ' . $customer_name;
		}
		$lines[] = 'Booked via LatePoint (#' . $booking->id . ')';
		return apply_filters( 'lpics_event_description', implode( "\n", $lines ), $booking );
	}

	private function customer_name( $booking ) {
		try {
			$customer = isset( $booking->customer ) ? $booking->customer : null;
			if ( $customer && method_exists( $customer, 'get_full_name' ) ) {
				return trim( (string) $customer->get_full_name() );
			}
			if ( $customer && isset( $customer->first_name ) ) {
				return trim( $customer->first_name . ' ' . ( $customer->last_name ?? '' ) );
			}
		} catch ( Exception $e ) {
			// Relationship not loadable, skip the name rather than fail the sync.
		}
		return '';
	}

	/* =====================================================================
	 * Direction IN: iCloud busy -> LatePoint blocked slots
	 * =================================================================== */

	/**
	 * @param \LatePoint\Misc\BookedPeriod[] $booked_periods
	 * @param \LatePoint\Misc\Filter         $filter
	 * @return \LatePoint\Misc\BookedPeriod[]
	 */
	public function inject_icloud_busy_periods( $booked_periods, $filter ) {
		if ( ! LPICS_Options::is_connected() ) {
			return $booked_periods;
		}
		if ( ! class_exists( '\LatePoint\Misc\BookedPeriod' ) ) {
			return $booked_periods;
		}
		if ( empty( $filter ) || empty( $filter->date_from ) ) {
			return $booked_periods;
		}

		// Only block for the agent this iCloud account represents. When LatePoint
		// asks about a different agent, leave their availability untouched.
		$filter_agent = isset( $filter->agent_id ) ? $filter->agent_id : 0;
		if ( is_array( $filter_agent ) ) {
			// "any agent" style query, skip only if our agent isn't in the set.
			$configured = LPICS_Options::agent_id();
			if ( $configured && ! in_array( $configured, array_map( 'intval', $filter_agent ), true ) ) {
				return $booked_periods;
			}
		} elseif ( ! $this->agent_matches( $filter_agent ) ) {
			return $booked_periods;
		}

		$date_from = $filter->date_from;
		$date_to   = ! empty( $filter->date_to ) ? $filter->date_to : $filter->date_from;

		$busy = $this->get_busy_periods( $date_from, $date_to );
		if ( empty( $busy ) ) {
			return $booked_periods;
		}

		$block_agent_id = LPICS_Options::agent_id(); // may be 0
		foreach ( $busy as $segment ) {
			$booked_periods[] = new \LatePoint\Misc\BookedPeriod( array(
				'start_date'      => $segment['date'],
				'end_date'        => $segment['date'],
				'start_time'      => $segment['start_min'],
				'end_time'        => $segment['end_min'],
				'agent_id'        => $block_agent_id,
				// service_id 0 never matches a real service id, so LatePoint's
				// overlap check treats any overlap as "blocked" (verified in
				// OsBookingHelper::is_timeframe_in_booked_periods).
				'service_id'      => 0,
				'location_id'     => 0,
				'total_attendees' => 9999,
			) );
		}

		return $booked_periods;
	}

	/**
	 * Fetch iCloud busy blocks for a date range, split into per-day segments of
	 * minutes-from-midnight. Cached in a transient (and per request) because
	 * LatePoint calls the availability path very frequently.
	 *
	 * @return array<int, array{date:string,start_min:int,end_min:int}>
	 */
	private function get_busy_periods( $date_from, $date_to ) {
		$cache_key = $date_from . '|' . $date_to;
		if ( isset( $this->busy_request_cache[ $cache_key ] ) ) {
			return $this->busy_request_cache[ $cache_key ];
		}

		$transient_key = 'lpics_busy_' . md5( $cache_key . '|' . LPICS_Options::calendar_url() );
		$cached        = get_transient( $transient_key );
		if ( is_array( $cached ) ) {
			$this->busy_request_cache[ $cache_key ] = $cached;
			return $cached;
		}

		$tz  = $this->timezone();
		$min = DateTime::createFromFormat( 'Y-m-d H:i:s', $date_from . ' 00:00:00', $tz );
		$max = DateTime::createFromFormat( 'Y-m-d H:i:s', $date_to . ' 23:59:59', $tz );
		if ( ! $min || ! $max ) {
			return array();
		}

		$raw_busy = LPICS_CalDAV_Client::free_busy(
			$min->format( DateTime::RFC3339 ),
			$max->format( DateTime::RFC3339 ),
			$tz->getName()
		);

		$segments = array();
		foreach ( $raw_busy as $block ) {
			if ( empty( $block['start'] ) || empty( $block['end'] ) ) {
				continue;
			}
			try {
				$start = new DateTime( $block['start'] );
				$end   = new DateTime( $block['end'] );
			} catch ( Exception $e ) {
				continue;
			}
			// Normalize to the business timezone before splitting into day minutes.
			$start->setTimezone( $tz );
			$end->setTimezone( $tz );
			$segments = array_merge( $segments, $this->split_busy_to_daily( $start, $end ) );
		}

		// Cache length: short, so calendar edits show up within minutes without
		// hammering iCloud on every slot render.
		$ttl = (int) apply_filters( 'lpics_busy_cache_seconds', 10 * MINUTE_IN_SECONDS );
		set_transient( $transient_key, $segments, $ttl );
		$this->busy_request_cache[ $cache_key ] = $segments;

		return $segments;
	}

	/**
	 * Split a busy interval (possibly spanning midnight/multiple days) into
	 * per-day {date, start_min, end_min} segments.
	 */
	private function split_busy_to_daily( DateTime $start, DateTime $end ) {
		$segments = array();
		$cursor   = clone $start;

		// Hard cap the loop so a malformed multi-year event can't spin forever.
		$guard = 0;
		while ( $cursor < $end && $guard < 400 ) {
			$guard++;
			$date      = $cursor->format( 'Y-m-d' );
			$start_min = (int) $cursor->format( 'G' ) * 60 + (int) $cursor->format( 'i' );

			$next_midnight = ( clone $cursor )->setTime( 0, 0, 0 )->modify( '+1 day' );

			if ( $end <= $next_midnight ) {
				$end_min = (int) $end->format( 'G' ) * 60 + (int) $end->format( 'i' );
				if ( 0 === $end_min && $end->format( 'Y-m-d' ) !== $date ) {
					$end_min = 1440; // ended exactly at next midnight
				}
			} else {
				$end_min = 1440;
			}

			if ( $end_min > $start_min ) {
				$segments[] = array(
					'date'      => $date,
					'start_min' => $start_min,
					'end_min'   => $end_min,
				);
			}

			$cursor = $next_midnight;
		}

		return $segments;
	}
}
