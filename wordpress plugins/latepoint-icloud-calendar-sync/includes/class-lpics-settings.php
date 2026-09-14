<?php
/**
 * Admin settings page: iCloud credentials (Apple ID + app-specific password),
 * a "test connection" step that discovers the account's calendars, the calendar
 * picker, which agent the calendar belongs to, and the two direction toggles.
 *
 * Unlike the Google sibling there is no OAuth redirect: CalDAV uses Basic auth,
 * so connecting is just save-credentials + discover-calendars.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class LPICS_Settings {

	public function __construct() {
		add_action( 'admin_menu', array( $this, 'register_menu' ) );
		add_action( 'admin_init', array( $this, 'handle_actions' ) );
	}

	public function register_menu() {
		add_options_page(
			'LatePoint iCloud Calendar Sync',
			'LatePoint iCloud Sync',
			'manage_options',
			LPICS_SETTINGS_SLUG,
			array( $this, 'render_page' )
		);
	}

	/** Process form posts before the page renders. */
	public function handle_actions() {
		if ( ! is_admin() || ! current_user_can( 'manage_options' ) ) {
			return;
		}
		if ( ! isset( $_GET['page'] ) || LPICS_SETTINGS_SLUG !== $_GET['page'] ) {
			return;
		}

		// 1) Save credentials and/or settings, then (re)discover calendars.
		if ( isset( $_POST['lpics_save_settings'] ) ) {
			check_admin_referer( 'lpics_save_settings' );

			LPICS_Options::set( 'apple_id', sanitize_text_field( wp_unslash( $_POST['lpics_apple_id'] ?? '' ) ) );
			// Only overwrite the password if a new one was actually typed in.
			$posted_pass = trim( (string) wp_unslash( $_POST['lpics_app_password'] ?? '' ) );
			if ( '' !== $posted_pass ) {
				LPICS_Options::set( 'app_password', sanitize_text_field( $posted_pass ) );
			}

			LPICS_Options::set( 'agent_id', (int) ( $_POST['lpics_agent_id'] ?? 0 ) );
			LPICS_Options::set( 'sync_out', isset( $_POST['lpics_sync_out'] ) ? '1' : '0' );
			LPICS_Options::set( 'block_busy', isset( $_POST['lpics_block_busy'] ) ? '1' : '0' );

			// Record the chosen calendar (value is the absolute CalDAV URL).
			$chosen_url = esc_url_raw( wp_unslash( $_POST['lpics_calendar_url'] ?? '' ) );
			if ( '' !== $chosen_url ) {
				LPICS_Options::set( 'calendar_url', $chosen_url );
				LPICS_Options::set( 'calendar_label', $this->label_for_url( $chosen_url ) );
			}

			// Try discovery whenever we have credentials, to refresh the calendar
			// list (and validate the password).
			$status = 'saved';
			if ( LPICS_Options::get( 'apple_id' ) && LPICS_Options::get( 'app_password' ) ) {
				$result = LPICS_CalDAV_Client::test_connection();
				if ( ! $result['ok'] ) {
					set_transient( 'lpics_flash_error', $result['error'], 60 );
					$status = 'connect_error';
				}
			}

			wp_safe_redirect( admin_url( 'options-general.php?page=' . LPICS_SETTINGS_SLUG . '&lpics_status=' . $status ) );
			exit;
		}

		// 2) Re-run discovery only (reload calendar list).
		if ( isset( $_POST['lpics_test'] ) ) {
			check_admin_referer( 'lpics_test' );
			$result = LPICS_CalDAV_Client::test_connection();
			$status = $result['ok'] ? 'connected' : 'connect_error';
			if ( ! $result['ok'] ) {
				set_transient( 'lpics_flash_error', $result['error'], 60 );
			}
			wp_safe_redirect( admin_url( 'options-general.php?page=' . LPICS_SETTINGS_SLUG . '&lpics_status=' . $status ) );
			exit;
		}

		// 3) Disconnect: forget the password + discovered data (keep Apple ID).
		if ( isset( $_POST['lpics_disconnect'] ) ) {
			check_admin_referer( 'lpics_disconnect' );
			LPICS_Options::delete( 'app_password' );
			LPICS_Options::delete( 'calendar_url' );
			LPICS_Options::delete( 'calendar_label' );
			LPICS_Options::delete( 'calendars' );
			LPICS_Options::delete( 'calendar_home' );
			LPICS_Options::delete( 'last_auth_error' );
			wp_safe_redirect( admin_url( 'options-general.php?page=' . LPICS_SETTINGS_SLUG . '&lpics_status=disconnected' ) );
			exit;
		}

		// 4) Clear cached busy times.
		if ( isset( $_POST['lpics_clear_cache'] ) ) {
			check_admin_referer( 'lpics_clear_cache' );
			$this->clear_busy_cache();
			wp_safe_redirect( admin_url( 'options-general.php?page=' . LPICS_SETTINGS_SLUG . '&lpics_status=cache_cleared' ) );
			exit;
		}
	}

	private function label_for_url( $url ) {
		$calendars = LPICS_Options::get( 'calendars', array() );
		if ( is_array( $calendars ) ) {
			foreach ( $calendars as $cal ) {
				if ( isset( $cal['url'] ) && $cal['url'] === $url ) {
					return isset( $cal['label'] ) ? $cal['label'] : $url;
				}
			}
		}
		return $url;
	}

	private function clear_busy_cache() {
		global $wpdb;
		$like = $wpdb->esc_like( '_transient_lpics_busy_' ) . '%';
		$wpdb->query( $wpdb->prepare( "DELETE FROM {$wpdb->options} WHERE option_name LIKE %s", $like ) );
		$like_to = $wpdb->esc_like( '_transient_timeout_lpics_busy_' ) . '%';
		$wpdb->query( $wpdb->prepare( "DELETE FROM {$wpdb->options} WHERE option_name LIKE %s", $like_to ) );
	}

	/** LatePoint agents for the dropdown: [id => "First Last"]. */
	private function get_agents() {
		global $wpdb;
		$agents = array();
		if ( ! defined( 'LATEPOINT_TABLE_AGENTS' ) ) {
			return $agents;
		}
		$rows = $wpdb->get_results( 'SELECT id, first_name, last_name FROM ' . LATEPOINT_TABLE_AGENTS . ' ORDER BY first_name, last_name' );
		if ( $rows ) {
			foreach ( $rows as $row ) {
				$name                     = trim( $row->first_name . ' ' . $row->last_name );
				$agents[ (int) $row->id ] = $name !== '' ? $name : ( 'Agent #' . $row->id );
			}
		}
		return $agents;
	}

	public function render_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$connected     = LPICS_Options::is_connected();
		$apple_id      = LPICS_Options::get( 'apple_id' );
		$has_pass      = (bool) LPICS_Options::get( 'app_password' );
		$agent_id      = LPICS_Options::agent_id();
		$calendar_url  = LPICS_Options::calendar_url();
		$calendar_lbl  = LPICS_Options::get( 'calendar_label' );
		$sync_out      = LPICS_Options::sync_out_enabled();
		$block_busy    = LPICS_Options::block_busy_enabled();
		$auth_error    = LPICS_Options::get( 'last_auth_error' );
		$agents        = $this->get_agents();
		$calendars     = LPICS_Options::get( 'calendars', array() );
		if ( ! is_array( $calendars ) ) {
			$calendars = array();
		}
		$flash_error = get_transient( 'lpics_flash_error' );
		if ( $flash_error ) {
			delete_transient( 'lpics_flash_error' );
		}
		$status = isset( $_GET['lpics_status'] ) ? sanitize_text_field( wp_unslash( $_GET['lpics_status'] ) ) : '';
		?>
		<div class="wrap">
			<h1>LatePoint iCloud Calendar Sync (Two-Way)</h1>

			<?php if ( 'saved' === $status ) : ?>
				<div class="notice notice-success is-dismissible"><p>Settings saved.</p></div>
			<?php elseif ( 'connected' === $status ) : ?>
				<div class="notice notice-success is-dismissible"><p>Connected to iCloud. Calendar list refreshed.</p></div>
			<?php elseif ( 'disconnected' === $status ) : ?>
				<div class="notice notice-success is-dismissible"><p>iCloud account disconnected.</p></div>
			<?php elseif ( 'cache_cleared' === $status ) : ?>
				<div class="notice notice-success is-dismissible"><p>Cached busy times cleared.</p></div>
			<?php endif; ?>

			<?php if ( $flash_error ) : ?>
				<div class="notice notice-error is-dismissible"><p><?php echo esc_html( $flash_error ); ?></p></div>
			<?php endif; ?>

			<?php if ( $auth_error ) : ?>
				<div class="notice notice-warning"><p><strong>Connection problem:</strong> <?php echo esc_html( $auth_error ); ?></p></div>
			<?php endif; ?>

			<h2>1. Connection status</h2>
			<table class="widefat" style="max-width:760px;margin-bottom:16px;">
				<tbody>
					<tr>
						<td style="width:220px;"><strong>Status</strong></td>
						<td>
							<?php if ( $connected ) : ?>
								<span style="color:#1a7f37;font-weight:600;">Connected</span>
								<?php if ( $apple_id ) : ?> as <code><?php echo esc_html( $apple_id ); ?></code><?php endif; ?>
							<?php elseif ( $apple_id && $has_pass ) : ?>
								<span style="color:#996800;font-weight:600;">Credentials saved, pick a calendar below</span>
							<?php else : ?>
								<span style="color:#b32d2e;font-weight:600;">Not connected</span>
							<?php endif; ?>
						</td>
					</tr>
					<tr>
						<td><strong>Target calendar</strong></td>
						<td><?php echo $calendar_lbl ? esc_html( $calendar_lbl ) : '<em>none selected</em>'; ?></td>
					</tr>
					<tr>
						<td><strong>Sync out</strong> (bookings &rarr; iCloud)</td>
						<td><?php echo $sync_out ? 'On' : 'Off'; ?></td>
					</tr>
					<tr>
						<td><strong>Block busy</strong> (iCloud &rarr; availability)</td>
						<td><?php echo $block_busy ? 'On' : 'Off'; ?></td>
					</tr>
				</tbody>
			</table>

			<?php if ( $apple_id && $has_pass ) : ?>
				<div style="display:flex;gap:10px;margin-bottom:24px;">
					<form method="post"><?php wp_nonce_field( 'lpics_test' ); ?>
						<button class="button" name="lpics_test" value="1">Test connection / reload calendars</button>
					</form>
					<?php if ( $connected ) : ?>
						<form method="post"><?php wp_nonce_field( 'lpics_clear_cache' ); ?>
							<button class="button" name="lpics_clear_cache" value="1">Refresh busy times now</button>
						</form>
					<?php endif; ?>
					<form method="post"><?php wp_nonce_field( 'lpics_disconnect' ); ?>
						<button class="button" name="lpics_disconnect" value="1" onclick="return confirm('Disconnect the iCloud account? Existing bookings stay, but new ones will stop syncing until you reconnect.');">Disconnect</button>
					</form>
				</div>
			<?php endif; ?>

			<hr>

			<form method="post">
				<?php wp_nonce_field( 'lpics_save_settings' ); ?>

				<h2>2. iCloud credentials</h2>
				<p>
					iCloud needs an <strong>app-specific password</strong>, not your normal Apple password. Create one at
					<a href="https://appleid.apple.com" target="_blank" rel="noopener">appleid.apple.com</a>
					&rarr; Sign-In &amp; Security &rarr; App-Specific Passwords &rarr; generate one (label it e.g. &ldquo;LatePoint&rdquo;), then paste it below.
					Your Apple ID must have two-factor authentication enabled for this option to appear.
				</p>

				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="lpics_apple_id">Apple ID (email)</label></th>
						<td><input name="lpics_apple_id" id="lpics_apple_id" type="email" class="regular-text" value="<?php echo esc_attr( $apple_id ); ?>" autocomplete="off"></td>
					</tr>
					<tr>
						<th scope="row"><label for="lpics_app_password">App-specific password</label></th>
						<td>
							<input name="lpics_app_password" id="lpics_app_password" type="password" class="regular-text" value="" autocomplete="off" placeholder="<?php echo $has_pass ? 'saved (leave blank to keep current)' : 'xxxx-xxxx-xxxx-xxxx'; ?>">
							<?php if ( $has_pass ) : ?><p class="description">A password is already saved. Leave blank to keep it.</p><?php endif; ?>
						</td>
					</tr>
				</table>

				<h2>3. What to sync</h2>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="lpics_calendar_url">Target calendar</label></th>
						<td>
							<?php if ( empty( $calendars ) ) : ?>
								<em>Enter your Apple ID and app-specific password above and click <strong>Save settings</strong>. Your calendars will then appear here to choose from.</em>
							<?php else : ?>
								<select name="lpics_calendar_url" id="lpics_calendar_url">
									<option value="">- select a calendar -</option>
									<?php foreach ( $calendars as $cal ) : ?>
										<?php if ( empty( $cal['url'] ) ) { continue; } ?>
										<option value="<?php echo esc_attr( $cal['url'] ); ?>" <?php selected( $calendar_url, $cal['url'] ); ?>>
											<?php echo esc_html( isset( $cal['label'] ) ? $cal['label'] : $cal['url'] ); ?>
										</option>
									<?php endforeach; ?>
								</select>
								<p class="description">The iCloud calendar that LatePoint bookings sync into, and whose busy times block availability. A dedicated calendar (e.g. &ldquo;Appointments&rdquo;) is cleanest.</p>
							<?php endif; ?>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="lpics_agent_id">Calendar belongs to agent</label></th>
						<td>
							<select name="lpics_agent_id" id="lpics_agent_id">
								<option value="0" <?php selected( $agent_id, 0 ); ?>>All agents (single-agent site)</option>
								<?php foreach ( $agents as $id => $name ) : ?>
									<option value="<?php echo esc_attr( $id ); ?>" <?php selected( $agent_id, $id ); ?>><?php echo esc_html( $name ); ?></option>
								<?php endforeach; ?>
							</select>
							<p class="description">Bookings for this agent sync to the connected calendar, and that calendar's busy times block only this agent. Choose &ldquo;All agents&rdquo; if there's just one.</p>
						</td>
					</tr>
					<tr>
						<th scope="row">Sync directions</th>
						<td>
							<label style="display:block;margin-bottom:8px;">
								<input type="checkbox" name="lpics_sync_out" value="1" <?php checked( $sync_out ); ?>>
								Push LatePoint bookings into the iCloud calendar
							</label>
							<label style="display:block;">
								<input type="checkbox" name="lpics_block_busy" value="1" <?php checked( $block_busy ); ?>>
								Block LatePoint availability using the iCloud calendar's busy times
							</label>
							<p class="description">Note: all-day iCloud events (birthdays, holidays) do not block bookings by default, and events marked &ldquo;free&rdquo; are ignored. See readme.txt.</p>
						</td>
					</tr>
				</table>

				<p class="submit"><button class="button button-primary" name="lpics_save_settings" value="1">Save settings</button></p>
			</form>
		</div>
		<?php
	}
}
