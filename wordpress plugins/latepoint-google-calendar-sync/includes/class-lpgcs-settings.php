<?php
/**
 * Admin settings page: credentials, connect/disconnect (OAuth), which agent the
 * calendar belongs to, and the two direction toggles. Also handles the OAuth
 * redirect callback (Google sends ?code= back to this page's URL).
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class LPGCS_Settings {

	public function __construct() {
		add_action( 'admin_menu', array( $this, 'register_menu' ) );
		add_action( 'admin_init', array( $this, 'handle_actions' ) );
	}

	public function register_menu() {
		add_options_page(
			'LatePoint Google Calendar Sync',
			'LatePoint GCal Sync',
			'manage_options',
			LPGCS_SETTINGS_SLUG,
			array( $this, 'render_page' )
		);
	}

	/**
	 * Runs on admin_init so it can process form posts and the OAuth callback
	 * before the page renders.
	 */
	public function handle_actions() {
		if ( ! is_admin() || ! current_user_can( 'manage_options' ) ) {
			return;
		}
		if ( ! isset( $_GET['page'] ) || LPGCS_SETTINGS_SLUG !== $_GET['page'] ) {
			return;
		}

		// 1) OAuth callback from Google (?code=...).
		if ( isset( $_GET['code'] ) ) {
			$code   = sanitize_text_field( wp_unslash( $_GET['code'] ) );
			$result = LPGCS_Google_Client::exchange_code_for_tokens( $code );
			$status = ( true === $result ) ? 'connected' : 'connect_error';
			if ( true !== $result ) {
				set_transient( 'lpgcs_flash_error', $result, 60 );
			}
			wp_safe_redirect( admin_url( 'options-general.php?page=' . LPGCS_SETTINGS_SLUG . '&lpgcs_status=' . $status ) );
			exit;
		}
		if ( isset( $_GET['error'] ) ) {
			set_transient( 'lpgcs_flash_error', 'Google returned: ' . sanitize_text_field( wp_unslash( $_GET['error'] ) ), 60 );
			wp_safe_redirect( admin_url( 'options-general.php?page=' . LPGCS_SETTINGS_SLUG ) );
			exit;
		}

		// 2) Save settings form.
		if ( isset( $_POST['lpgcs_save_settings'] ) ) {
			check_admin_referer( 'lpgcs_save_settings' );
			LPGCS_Options::set( 'client_id', sanitize_text_field( wp_unslash( $_POST['lpgcs_client_id'] ?? '' ) ) );
			// Only overwrite the secret if a new one was actually typed in.
			$posted_secret = trim( (string) wp_unslash( $_POST['lpgcs_client_secret'] ?? '' ) );
			if ( '' !== $posted_secret ) {
				LPGCS_Options::set( 'client_secret', sanitize_text_field( $posted_secret ) );
			}
			LPGCS_Options::set( 'agent_id', (int) ( $_POST['lpgcs_agent_id'] ?? 0 ) );
			LPGCS_Options::set( 'calendar_id', sanitize_text_field( wp_unslash( $_POST['lpgcs_calendar_id'] ?? 'primary' ) ) );
			LPGCS_Options::set( 'sync_out', isset( $_POST['lpgcs_sync_out'] ) ? '1' : '0' );
			LPGCS_Options::set( 'block_busy', isset( $_POST['lpgcs_block_busy'] ) ? '1' : '0' );

			wp_safe_redirect( admin_url( 'options-general.php?page=' . LPGCS_SETTINGS_SLUG . '&lpgcs_status=saved' ) );
			exit;
		}

		// 3) Start OAuth connect.
		if ( isset( $_POST['lpgcs_connect'] ) ) {
			check_admin_referer( 'lpgcs_connect' );
			$url = LPGCS_Google_Client::build_auth_url();
			if ( $url ) {
				wp_redirect( $url ); // external URL, wp_safe_redirect would block it
				exit;
			}
			set_transient( 'lpgcs_flash_error', 'Enter and save your Client ID and Client Secret first.', 60 );
			wp_safe_redirect( admin_url( 'options-general.php?page=' . LPGCS_SETTINGS_SLUG ) );
			exit;
		}

		// 4) Disconnect.
		if ( isset( $_POST['lpgcs_disconnect'] ) ) {
			check_admin_referer( 'lpgcs_disconnect' );
			LPGCS_Google_Client::disconnect();
			wp_safe_redirect( admin_url( 'options-general.php?page=' . LPGCS_SETTINGS_SLUG . '&lpgcs_status=disconnected' ) );
			exit;
		}

		// 5) Clear the cached busy times (force a fresh freeBusy on next render).
		if ( isset( $_POST['lpgcs_clear_cache'] ) ) {
			check_admin_referer( 'lpgcs_clear_cache' );
			$this->clear_busy_cache();
			wp_safe_redirect( admin_url( 'options-general.php?page=' . LPGCS_SETTINGS_SLUG . '&lpgcs_status=cache_cleared' ) );
			exit;
		}
	}

	private function clear_busy_cache() {
		global $wpdb;
		// Transients we set are prefixed lpgcs_busy_ ; delete both the value and
		// timeout rows.
		$like = $wpdb->esc_like( '_transient_lpgcs_busy_' ) . '%';
		$wpdb->query( $wpdb->prepare( "DELETE FROM {$wpdb->options} WHERE option_name LIKE %s", $like ) );
		$like_to = $wpdb->esc_like( '_transient_timeout_lpgcs_busy_' ) . '%';
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
				$name = trim( $row->first_name . ' ' . $row->last_name );
				$agents[ (int) $row->id ] = $name !== '' ? $name : ( 'Agent #' . $row->id );
			}
		}
		return $agents;
	}

	public function render_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$connected     = LPGCS_Options::is_connected();
		$client_id     = LPGCS_Options::get( 'client_id' );
		$has_secret    = (bool) LPGCS_Options::get( 'client_secret' );
		$agent_id      = LPGCS_Options::agent_id();
		$calendar_id   = LPGCS_Options::calendar_id();
		$sync_out      = LPGCS_Options::sync_out_enabled();
		$block_busy    = LPGCS_Options::block_busy_enabled();
		$connected_eml = LPGCS_Options::get( 'connected_email' );
		$auth_error    = LPGCS_Options::get( 'last_auth_error' );
		$agents        = $this->get_agents();
		$redirect_uri  = LPGCS_Google_Client::redirect_uri();
		$flash_error   = get_transient( 'lpgcs_flash_error' );
		if ( $flash_error ) {
			delete_transient( 'lpgcs_flash_error' );
		}
		$status = isset( $_GET['lpgcs_status'] ) ? sanitize_text_field( wp_unslash( $_GET['lpgcs_status'] ) ) : '';
		?>
		<div class="wrap">
			<h1>LatePoint Google Calendar Sync (Two-Way)</h1>

			<?php if ( 'saved' === $status ) : ?>
				<div class="notice notice-success is-dismissible"><p>Settings saved.</p></div>
			<?php elseif ( 'connected' === $status ) : ?>
				<div class="notice notice-success is-dismissible"><p>Google account connected.</p></div>
			<?php elseif ( 'disconnected' === $status ) : ?>
				<div class="notice notice-success is-dismissible"><p>Google account disconnected.</p></div>
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
			<table class="widefat" style="max-width:720px;margin-bottom:16px;">
				<tbody>
					<tr>
						<td style="width:200px;"><strong>Status</strong></td>
						<td>
							<?php if ( $connected ) : ?>
								<span style="color:#1a7f37;font-weight:600;">Connected</span>
								<?php if ( $connected_eml ) : ?> as <code><?php echo esc_html( $connected_eml ); ?></code><?php endif; ?>
							<?php else : ?>
								<span style="color:#b32d2e;font-weight:600;">Not connected</span>
							<?php endif; ?>
						</td>
					</tr>
					<tr>
						<td><strong>Sync out</strong> (bookings &rarr; Google)</td>
						<td><?php echo $sync_out ? 'On' : 'Off'; ?></td>
					</tr>
					<tr>
						<td><strong>Block busy</strong> (Google &rarr; availability)</td>
						<td><?php echo $block_busy ? 'On' : 'Off'; ?></td>
					</tr>
				</tbody>
			</table>

			<?php if ( $client_id && $has_secret ) : ?>
				<div style="display:flex;gap:10px;margin-bottom:24px;">
					<?php if ( ! $connected ) : ?>
						<form method="post"><?php wp_nonce_field( 'lpgcs_connect' ); ?>
							<button class="button button-primary" name="lpgcs_connect" value="1">Connect Google Account</button>
						</form>
					<?php else : ?>
						<form method="post"><?php wp_nonce_field( 'lpgcs_disconnect' ); ?>
							<button class="button" name="lpgcs_disconnect" value="1" onclick="return confirm('Disconnect the Google account? Existing bookings stay, but new ones will stop syncing until you reconnect.');">Disconnect</button>
						</form>
						<form method="post"><?php wp_nonce_field( 'lpgcs_clear_cache' ); ?>
							<button class="button" name="lpgcs_clear_cache" value="1">Refresh busy times now</button>
						</form>
					<?php endif; ?>
				</div>
			<?php else : ?>
				<p><em>Enter your Google API credentials below and save, then a Connect button will appear.</em></p>
			<?php endif; ?>

			<hr>

			<form method="post">
				<?php wp_nonce_field( 'lpgcs_save_settings' ); ?>

				<h2>2. Google API credentials</h2>
				<p>Create these once in a free Google Cloud project, full steps are in the plugin's <code>readme.txt</code>. When creating the OAuth client, add this exact <strong>Authorized redirect URI</strong>:</p>
				<p><code style="background:#f6f7f7;padding:6px 8px;display:inline-block;"><?php echo esc_html( $redirect_uri ); ?></code></p>

				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="lpgcs_client_id">Client ID</label></th>
						<td><input name="lpgcs_client_id" id="lpgcs_client_id" type="text" class="regular-text" value="<?php echo esc_attr( $client_id ); ?>" autocomplete="off"></td>
					</tr>
					<tr>
						<th scope="row"><label for="lpgcs_client_secret">Client Secret</label></th>
						<td>
							<input name="lpgcs_client_secret" id="lpgcs_client_secret" type="password" class="regular-text" value="" autocomplete="off" placeholder="<?php echo $has_secret ? '•••••••• (leave blank to keep current)' : ''; ?>">
							<?php if ( $has_secret ) : ?><p class="description">A secret is already saved. Leave blank to keep it.</p><?php endif; ?>
						</td>
					</tr>
				</table>

				<h2>3. What to sync</h2>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="lpgcs_agent_id">Calendar belongs to agent</label></th>
						<td>
							<select name="lpgcs_agent_id" id="lpgcs_agent_id">
								<option value="0" <?php selected( $agent_id, 0 ); ?>>All agents (single-agent site)</option>
								<?php foreach ( $agents as $id => $name ) : ?>
									<option value="<?php echo esc_attr( $id ); ?>" <?php selected( $agent_id, $id ); ?>><?php echo esc_html( $name ); ?></option>
								<?php endforeach; ?>
							</select>
							<p class="description">Bookings for this agent sync to the connected calendar, and that calendar's busy times block only this agent. Choose "All agents" if there's just one.</p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="lpgcs_calendar_id">Target calendar ID</label></th>
						<td>
							<input name="lpgcs_calendar_id" id="lpgcs_calendar_id" type="text" class="regular-text" value="<?php echo esc_attr( $calendar_id ); ?>">
							<p class="description">Use <code>primary</code> for the account's main calendar, or paste a specific calendar's ID from Google Calendar settings.</p>
						</td>
					</tr>
					<tr>
						<th scope="row">Sync directions</th>
						<td>
							<label style="display:block;margin-bottom:8px;">
								<input type="checkbox" name="lpgcs_sync_out" value="1" <?php checked( $sync_out ); ?>>
								Push LatePoint bookings into Google Calendar
							</label>
							<label style="display:block;">
								<input type="checkbox" name="lpgcs_block_busy" value="1" <?php checked( $block_busy ); ?>>
								Block LatePoint availability using Google Calendar busy times
							</label>
						</td>
					</tr>
				</table>

				<p class="submit"><button class="button button-primary" name="lpgcs_save_settings" value="1">Save settings</button></p>
			</form>
		</div>
		<?php
	}
}
