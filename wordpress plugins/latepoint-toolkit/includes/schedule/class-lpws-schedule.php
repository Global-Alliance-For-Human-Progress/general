<?php
/**
 * Week schedule widget: [lp_week_schedule]
 *
 * Shows the open LatePoint slots of the chosen services as a week view (one block per day,
 * one row per class with time, name and spots left, expandable details and a Book button).
 * The Book button uses LatePoint's own booking popup, preset to the service, date and time.
 * Uses only LatePoint's public helpers (verified against LatePoint 5.7.10).
 *
 * Attributes:
 *   service_ids  comma list of service ids to show (default: all active services)
 *   weeks        how many weeks to offer, 1 to 8 (default 4)
 *   show_spots   yes/no, show "N spots left" (default yes)
 *   button_text  caption of the Book button (default "Book")
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class LPWS_Schedule {

	private static $assets_printed = false;

	public function __construct() {
		add_shortcode( 'lp_week_schedule', array( $this, 'shortcode' ) );
	}

	public function shortcode( $atts ) {
		if ( ! class_exists( 'OsServiceModel' ) || ! class_exists( 'OsResourceHelper' ) ) {
			return current_user_can( 'manage_options' ) ? '<p>LatePoint Toolkit: LatePoint is not active.</p>' : '';
		}

		$atts = shortcode_atts(
			array(
				'service_ids' => '',
				'weeks'       => 4,
				'show_spots'  => 'yes',
				'button_text' => 'Book',
			),
			$atts,
			'lp_week_schedule'
		);

		$weeks      = max( 1, min( 8, (int) $atts['weeks'] ) );
		$show_spots = ( 'no' !== strtolower( (string) $atts['show_spots'] ) );

		$services = $this->get_services( (string) $atts['service_ids'] );
		if ( empty( $services ) ) {
			return '<p class="lpws-empty">No classes available.</p>';
		}

		$tz       = wp_timezone();
		$now      = new DateTimeImmutable( 'now', $tz );
		$today    = $now->format( 'Y-m-d' );
		$now_min  = (int) $now->format( 'G' ) * 60 + (int) $now->format( 'i' );
		$monday   = $now->modify( 'monday this week' )->setTime( 0, 0 );
		$last_day = $monday->modify( '+' . ( $weeks * 7 - 1 ) . ' days' );
		$by_day   = $this->collect_slots( $services, $monday, $last_day, $today, $now_min );

		ob_start();
		$this->print_assets_once();
		$uid = 'lpws-' . wp_unique_id();
		echo '<div class="lpws" id="' . esc_attr( $uid ) . '">';

		for ( $w = 0; $w < $weeks; $w++ ) {
			$start = $monday->modify( '+' . ( $w * 7 ) . ' days' );
			$end   = $start->modify( '+6 days' );
			if ( 0 === $w ) {
				$title = 'This week';
			} elseif ( 1 === $w ) {
				$title = 'Next week';
			} else {
				$title = 'Week ' . $start->format( 'W' );
			}
			if ( $start->format( 'n' ) !== $end->format( 'n' ) ) {
				$range = $start->format( 'j M' ) . ' - ' . $end->format( 'j M' );
			} else {
				$range = $start->format( 'j' ) . ' - ' . $end->format( 'j M' );
			}

			echo '<section class="lpws-week' . ( 0 === $w ? ' is-shown' : '' ) . '" data-week="' . (int) $w . '">';
			echo '<nav class="lpws-nav">';
			echo '<button type="button" class="lpws-step lpws-prev" data-dir="-1"' . ( 0 === $w ? ' hidden' : '' ) . '>&lsaquo; Previous week</button>';
			echo '<p class="lpws-title"><strong>' . esc_html( $title ) . '</strong><span>' . esc_html( $range ) . '</span></p>';
			echo '<button type="button" class="lpws-step lpws-next" data-dir="1"' . ( $w === $weeks - 1 ? ' hidden' : '' ) . '>Next week &rsaquo;</button>';
			echo '</nav><ol class="lpws-days">';

			for ( $d = 0; $d < 7; $d++ ) {
				$day   = $start->modify( '+' . $d . ' days' );
				$key   = $day->format( 'Y-m-d' );
				$slots = isset( $by_day[ $key ] ) ? $by_day[ $key ] : array();
				$cls   = 'lpws-day';
				if ( $key < $today ) {
					$cls .= ' is-past';
				} elseif ( $key === $today ) {
					$cls .= ' is-today';
				}
				echo '<li class="' . esc_attr( $cls ) . '">';
				echo '<p class="lpws-day-head"><span>' . esc_html( $day->format( 'D' ) ) . '</span><strong>' . esc_html( $day->format( 'j M' ) ) . '</strong></p>';
				if ( empty( $slots ) ) {
					echo '<p class="lpws-none">No classes</p>';
				} else {
					echo '<ul class="lpws-events">';
					foreach ( $slots as $slot ) {
						$this->print_slot( $slot, $key, $show_spots, (string) $atts['button_text'] );
					}
					echo '</ul>';
				}
				echo '</li>';
			}
			echo '</ol></section>';
		}
		echo '</div>';
		return ob_get_clean();
	}

	private function get_services( $ids_csv ) {
		$model = new OsServiceModel();
		$ids   = array_filter( array_map( 'absint', explode( ',', $ids_csv ) ) );
		if ( $ids ) {
			$model->where( array( 'id' => array_values( $ids ) ) );
		}
		$services = $model->should_be_active()->order_by( 'order_number asc' )->get_results_as_models();
		if ( ! is_array( $services ) ) {
			$services = $services ? array( $services ) : array();
		}
		return $services;
	}

	/**
	 * @return array date => list of slot arrays sorted by time
	 */
	private function collect_slots( array $services, DateTimeImmutable $from, DateTimeImmutable $to, $today, $now_min ) {
		$by_day = array();
		foreach ( $services as $service ) {
			$booking              = new OsBookingModel();
			$booking->service_id  = $service->id;
			$booking->agent_id    = LATEPOINT_ANY_AGENT;
			$booking->location_id = LATEPOINT_ANY_LOCATION;
			$booking->start_date  = $from->format( 'Y-m-d' );
			$booking->start_time  = 0;
			$booking->set_buffers();
			$booking->calculate_end_date_and_time();
			$request = \LatePoint\Misc\BookingRequest::create_from_booking_model( $booking );

			$resources = OsResourceHelper::get_resources_grouped_by_day(
				$request,
				new OsWpDateTime( $from->format( 'Y-m-d' ) ),
				new OsWpDateTime( $to->format( 'Y-m-d' ) )
			);

			$duration = (int) $request->duration;
			foreach ( $resources as $date => $day_resources ) {
				if ( $date < $today ) {
					continue;
				}
				$seen = array();
				foreach ( $day_resources as $resource ) {
					foreach ( $resource->slots as $slot ) {
						if ( ! $slot->can_accomodate( 1 ) ) {
							continue;
						}
						$start = (int) $slot->start_time;
						if ( $date === $today && $start <= $now_min ) {
							continue;
						}
						$left = (int) $slot->available_capacity();
						if ( isset( $seen[ $start ] ) ) {
							$idx                          = $seen[ $start ];
							$by_day[ $date ][ $idx ]['left'] = max( $by_day[ $date ][ $idx ]['left'], $left );
							continue;
						}
						$seen[ $start ]    = isset( $by_day[ $date ] ) ? count( $by_day[ $date ] ) : 0;
						$by_day[ $date ][] = array(
							'service' => $service,
							'start'   => $start,
							'end'     => $start + $duration,
							'left'    => $left,
						);
					}
				}
			}
		}
		foreach ( $by_day as $date => $list ) {
			usort(
				$list,
				function ( $a, $b ) {
					return $a['start'] <=> $b['start'];
				}
			);
			$by_day[ $date ] = $list;
		}
		return $by_day;
	}

	private function fmt( $minutes ) {
		return sprintf( '%02d:%02d', intdiv( (int) $minutes, 60 ) % 24, (int) $minutes % 60 );
	}

	private function print_slot( array $slot, $date, $show_spots, $button_text ) {
		$service = $slot['service'];
		$time    = $this->fmt( $slot['start'] ) . '-' . $this->fmt( $slot['end'] );
		$spots   = $slot['left'] . ( 1 === $slot['left'] ? ' spot left' : ' spots left' );
		$desc    = ! empty( $service->short_description ) ? $service->short_description : '';
		echo '<li><details name="lpws-class" class="lpws-event"><summary>';
		echo '<span class="lpws-time">' . esc_html( $time ) . '</span>';
		echo '<strong class="lpws-name">' . esc_html( $service->name ) . '</strong>';
		if ( $show_spots ) {
			echo '<span class="lpws-spots">' . esc_html( $spots ) . '</span>';
		}
		echo '</summary><div class="lpws-more">';
		if ( $desc ) {
			echo '<div class="lpws-text">' . wp_kses_post( $desc ) . '</div>';
		}
		echo '<a href="#" class="latepoint-book-button os_trigger_booking lpws-book"'
			. ' data-selected-service="' . esc_attr( (string) $service->id ) . '"'
			. ' data-selected-start-date="' . esc_attr( $date ) . '"'
			. ' data-selected-start-time="' . esc_attr( (string) $slot['start'] ) . '">'
			. esc_html( $button_text ) . '</a>';
		echo '</div></details></li>';
	}

	private function print_assets_once() {
		if ( self::$assets_printed ) {
			return;
		}
		self::$assets_printed = true;
		?>
<style>
.lpws{--lpws-ink:#33322e;--lpws-line:#e4e1da;--lpws-muted:#7a766d;--lpws-accent:#33322e;font:inherit;color:var(--lpws-ink)}
.lpws-week{display:none}.lpws-week.is-shown{display:block}
.lpws-nav{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 16px}
.lpws-title{margin:0;text-align:center}.lpws-title strong{display:block;font-size:1.15em}.lpws-title span{color:var(--lpws-muted);font-size:.9em}
.lpws-step{background:none;border:1px solid var(--lpws-line);border-radius:999px;padding:6px 14px;cursor:pointer;color:inherit;font:inherit}
.lpws-step[hidden]{display:block;visibility:hidden}
.lpws-days{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.lpws-day{border:1px solid var(--lpws-line);border-radius:10px;padding:12px 14px}
.lpws-day.is-past{opacity:.45}.lpws-day.is-today{border-color:var(--lpws-accent)}
.lpws-day-head{margin:0 0 8px;display:flex;gap:8px;align-items:baseline}.lpws-day-head span{color:var(--lpws-muted)}
.lpws-none{margin:0;color:var(--lpws-muted);font-size:.9em}
.lpws-events{list-style:none;margin:0;padding:0}
.lpws-event{border-top:1px solid var(--lpws-line)}.lpws-events li:first-child .lpws-event{border-top:0}
.lpws-event summary{display:grid;grid-template-columns:auto 1fr auto;gap:4px 14px;align-items:baseline;padding:10px 0;cursor:pointer;list-style:none}
.lpws-event summary::-webkit-details-marker{display:none}
.lpws-time{font-variant-numeric:tabular-nums;color:var(--lpws-muted)}
.lpws-spots{font-size:.85em;color:var(--lpws-muted)}
.lpws-more{padding:0 0 12px}.lpws-text{margin:0 0 10px;font-size:.95em}
.lpws-book{display:inline-block;background:var(--lpws-accent);color:#fff!important;border-radius:999px;padding:8px 22px;text-decoration:none}
@media(min-width:720px){.lpws-days{grid-template-columns:repeat(7,minmax(0,1fr))}.lpws-event summary{grid-template-columns:1fr}}
</style>
<script>
(function(){
document.addEventListener('click',function(e){
	var b=e.target.closest&&e.target.closest('.lpws-step');if(!b){return;}
	var root=b.closest('.lpws'),cur=root.querySelector('.lpws-week.is-shown'),
	idx=parseInt(cur.getAttribute('data-week'),10)+parseInt(b.getAttribute('data-dir'),10),
	next=root.querySelector('.lpws-week[data-week="'+idx+'"]');
	if(next){cur.classList.remove('is-shown');next.classList.add('is-shown');}
});
})();
</script>
		<?php
	}
}
