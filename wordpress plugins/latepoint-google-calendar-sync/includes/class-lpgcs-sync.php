<?php
/**
 * The actual two-way sync, wired onto LatePoint's public hooks.
 *
 * Direction OUT (LatePoint -> Google):
 *   latepoint_booking_created / _updated / _change_status / _will_be_deleted
 *   create / update / delete a Google Calendar event mirroring the booking.
 *
 * Direction IN (Google -> LatePoint):
 *   latepoint_get_booked_periods
 *   inject the connected calendar's busy blocks as LatePoint BookedPeriod
 *   objects so those times stop being offered as bookable slots.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class LPGCS_Sync {

	/** Per-request cache of free/busy lookups, keyed by "from|to". */
	private $busy_request_cache = array();

	public function __construct() {
		// --- Direction OUT ---
		if ( LPGCS_Options::sync_out_enabled() ) {
			add_action( 'latepoint_booking_created', array( $this, 'on_booking_created' ), 20, 1 );
			add_action( 'latepoint_booking_updated', array( $this, 'on_booking_updated' ), 20, 2 );
			add_action( 'latepoint_booking_change_status', array( $this, 'on_booking_updated' ), 20, 2 );
			add_action( 'latepoint_booking_will_be_deleted', array( $this, 'on_booking_will_be_deleted' ), 20, 1 );
		}

		// --- Direction IN ---
		if ( LPGCS_Options::block_busy_enabled() ) {
			add_filter( 'latepoint_get_booked_periods', array( $this, 'inject_google_busy_periods' ), 20, 2 );
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

	/** Does this booking belong to the agent whose Google account we synced? */
	private function agent_matches( $agent_id ) {
		$configured = LPGCS_Options::agent_id();
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
	 * Direction OUT: LatePoint booking -> Google event
	 * =================================================================== */

	public function on_booking_created( $booking ) {
		$this->upsert_event_for_booking( $booking );
	}

	public function on_booking_updated( $booking, $old_booking = null ) {
		$this->upsert_event_for_booking( $booking );
	}

	public function on_booking_will_be_deleted( $booking_id ) {
		$booking = $this->load_booking( (int) $booking_id );
		if ( ! $booking ) {
			return;
		}
		$event_id = $booking->get_meta_by_key( LPGCS_EVENT_META_KEY, '' );
		if ( $event_id ) {
			LPGCS_Google_Client::delete_event( $event_id );
			$booking->save_meta_by_key( LPGCS_EVENT_META_KEY, '' );
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
	 * Create/update/delete the Google event to match the current booking state.
	 * Never throws, a Google failure just leaves the mapping as-is.
	 */
	private function upsert_event_for_booking( $booking ) {
		if ( ! LPGCS_Options::is_connected() || empty( $booking ) || empty( $booking->id ) ) {
			return;
		}
		if ( ! $this->agent_matches( isset( $booking->agent_id ) ? $booking->agent_id : 0 ) ) {
			return;
		}

		$existing_event_id = $booking->get_meta_by_key( LPGCS_EVENT_META_KEY, '' );

		// If the booking no longer occupies time (cancelled/no-show), remove any event.
		if ( isset( $booking->status ) && ! $this->status_occupies_time( $booking->status ) ) {
			if ( $existing_event_id ) {
				LPGCS_Google_Client::delete_event( $existing_event_id );
				$booking->save_meta_by_key( LPGCS_EVENT_META_KEY, '' );
			}
			return;
		}

		$start = $this->datetime_from( $booking->start_date, $booking->start_time );
		$end   = $this->datetime_from(
			! empty( $booking->end_date ) ? $booking->end_date : $booking->start_date,
			$booking->end_time
		);
		if ( ! $start || ! $end || $end <= $start ) {
			return;
		}

		$tz_name = $this->timezone_name();
		$event   = array(
			'summary'     => $this->event_summary( $booking ),
			'description' => $this->event_description( $booking ),
			'start'       => array( 'dateTime' => $start->format( 'Y-m-d\TH:i:s' ), 'timeZone' => $tz_name ),
			'end'         => array( 'dateTime' => $end->format( 'Y-m-d\TH:i:s' ), 'timeZone' => $tz_name ),
			// A stable, namespaced source tag so these are recognizable in Google.
			'extendedProperties' => array(
				'private' => array(
					'lpgcs_booking_id' => (string) $booking->id,
				),
			),
		);

		if ( $existing_event_id ) {
			$ok = LPGCS_Google_Client::update_event( $existing_event_id, $event );
			if ( ! $ok ) {
				// Event vanished in Google, recreate it.
				$new_id = LPGCS_Google_Client::insert_event( $event );
				$booking->save_meta_by_key( LPGCS_EVENT_META_KEY, $new_id ? $new_id : '' );
			}
		} else {
			$new_id = LPGCS_Google_Client::insert_event( $event );
			if ( $new_id ) {
				$booking->save_meta_by_key( LPGCS_EVENT_META_KEY, $new_id );
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
		 * Filter the Google Calendar event title for a LatePoint booking.
		 *
		 * @param string $title
		 * @param object $booking
		 */
		return apply_filters( 'lpgcs_event_summary', $title, $booking );
	}

	private function event_description( $booking ) {
		$lines = array();
		$customer_name = $this->customer_name( $booking );
		if ( $customer_name ) {
			$lines[] = 'Client: ' . $customer_name;
		}
		$lines[] = 'Booked via LatePoint (#' . $booking->id . ')';
		return apply_filters( 'lpgcs_event_description', implode( "\n", $lines ), $booking );
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
	 * Direction IN: Google busy -> LatePoint blocked slots
	 * =================================================================== */

	/**
	 * @param \LatePoint\Misc\BookedPeriod[] $booked_periods
	 * @param \LatePoint\Misc\Filter         $filter
	 * @return \LatePoint\Misc\BookedPeriod[]
	 */
	public function inject_google_busy_periods( $booked_periods, $filter ) {
		if ( ! LPGCS_Options::is_connected() ) {
			return $booked_periods;
		}
		if ( ! class_exists( '\LatePoint\Misc\BookedPeriod' ) ) {
			return $booked_periods;
		}
		if ( empty( $filter ) || empty( $filter->date_from ) ) {
			return $booked_periods;
		}

		// Only block for the agent this Google account represents. When LatePoint
		// asks about a different agent, leave their availability untouched.
		$filter_agent = isset( $filter->agent_id ) ? $filter->agent_id : 0;
		if ( is_array( $filter_agent ) ) {
			// "any agent" style query, skip only if our agent isn't in the set.
			$configured = LPGCS_Options::agent_id();
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

		$block_agent_id = LPGCS_Options::agent_id(); // may be 0
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
	 * Fetch Google busy blocks for a date range, split into per-day segments of
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

		$transient_key = 'lpgcs_busy_' . md5( $cache_key . '|' . LPGCS_Options::calendar_id() );
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

		$raw_busy = LPGCS_Google_Client::free_busy(
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
		// hammering the Google API on every slot render.
		$ttl = (int) apply_filters( 'lpgcs_busy_cache_seconds', 10 * MINUTE_IN_SECONDS );
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
