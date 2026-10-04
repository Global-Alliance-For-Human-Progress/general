<?php
/**
 * Settings page (LatePoint Toolkit > Swiss Payments): QR-bill account,
 * TWINT details, and voucher management.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class LPSP_Settings {

	public function __construct() {
		add_action( 'admin_menu', array( $this, 'register_menu' ) );
		add_action( 'admin_init', array( $this, 'handle_actions' ) );
	}

	public static function page_url( $args = array() ) {
		return add_query_arg( array_merge( array( 'page' => LPSP_SETTINGS_SLUG ), $args ), admin_url( 'admin.php' ) );
	}

	public function register_menu() {
		add_submenu_page(
			LPICS_SETTINGS_SLUG,
			__( 'LatePoint Swiss Payments', 'lpsp' ),
			__( 'Swiss Payments', 'lpsp' ),
			'manage_options',
			LPSP_SETTINGS_SLUG,
			array( $this, 'render' )
		);
	}

	/* ---------------------------------------------------------------
	 * Actions
	 * ------------------------------------------------------------- */

	public function handle_actions() {
		if ( empty( $_POST['lpsp_action'] ) || ! current_user_can( 'manage_options' ) ) {
			return;
		}
		check_admin_referer( 'lpsp_admin' );
		$action = sanitize_key( wp_unslash( $_POST['lpsp_action'] ) );

		if ( 'save_settings' === $action ) {
			$this->save_settings();
		} elseif ( 'create_voucher' === $action ) {
			$this->create_voucher();
		} elseif ( 'delete_voucher' === $action ) {
			LPSP_Vouchers::delete( isset( $_POST['voucher_id'] ) ? (int) $_POST['voucher_id'] : 0 );
			wp_safe_redirect( self::page_url( array( 'lpsp_msg' => 'voucher_deleted' ) ) );
			exit;
		}
	}

	private function post( $key ) {
		return isset( $_POST[ $key ] ) ? sanitize_text_field( wp_unslash( $_POST[ $key ] ) ) : '';
	}

	private function save_settings() {
		$text_keys = array( 'qr_iban', 'qr_name', 'qr_street', 'qr_building', 'qr_zip', 'qr_city', 'qr_message_prefix', 'qr_label', 'twint_phone', 'twint_label', 'voucher_label' );
		foreach ( $text_keys as $key ) {
			LPSP_Options::set( $key, $this->post( $key ) );
		}
		LPSP_Options::set( 'qr_iban', LPSP_QRBill::normalize_iban( $this->post( 'qr_iban' ) ) );
		LPSP_Options::set( 'qr_country', 'LI' === $this->post( 'qr_country' ) ? 'LI' : 'CH' );
		LPSP_Options::set( 'qr_currency', 'EUR' === $this->post( 'qr_currency' ) ? 'EUR' : 'CHF' );
		LPSP_Options::set( 'twint_qr_url', esc_url_raw( $this->post( 'twint_qr_url' ) ) );
		LPSP_Options::set( 'twint_instructions', isset( $_POST['twint_instructions'] ) ? sanitize_textarea_field( wp_unslash( $_POST['twint_instructions'] ) ) : '' );
		foreach ( array( 'qr_enabled', 'twint_enabled', 'voucher_enabled', 'send_email' ) as $key ) {
			LPSP_Options::set( $key, empty( $_POST[ $key ] ) ? '0' : '1' );
		}
		wp_safe_redirect( self::page_url( array( 'lpsp_msg' => 'saved' ) ) );
		exit;
	}

	private function create_voucher() {
		$result = LPSP_Vouchers::create(
			str_replace( ',', '.', $this->post( 'voucher_amount' ) ),
			$this->post( 'voucher_code' ),
			$this->post( 'voucher_expires' ),
			$this->post( 'voucher_note' )
		);
		if ( is_wp_error( $result ) ) {
			wp_safe_redirect( self::page_url( array( 'lpsp_msg' => 'voucher_error', 'lpsp_err' => rawurlencode( $result->get_error_message() ) ) ) );
		} else {
			wp_safe_redirect( self::page_url( array( 'lpsp_msg' => 'voucher_created' ) ) );
		}
		exit;
	}

	/* ---------------------------------------------------------------
	 * Rendering
	 * ------------------------------------------------------------- */

	private function checkbox( $key, $label ) {
		printf(
			'<label><input type="checkbox" name="%1$s" value="1" %2$s> %3$s</label>',
			esc_attr( $key ),
			checked( LPSP_Options::is_on( $key ), true, false ),
			esc_html( $label )
		);
	}

	private function field( $key, $label, $default = '', $width = 'regular-text', $help = '' ) {
		printf(
			'<tr><th scope="row"><label for="%1$s">%2$s</label></th><td><input type="text" id="%1$s" name="%1$s" value="%3$s" class="%4$s">%5$s</td></tr>',
			esc_attr( $key ),
			esc_html( $label ),
			esc_attr( LPSP_Options::get( $key, $default ) ),
			esc_attr( $width ),
			$help ? '<p class="description">' . esc_html( $help ) . '</p>' : ''
		);
	}

	public function render() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$msg = isset( $_GET['lpsp_msg'] ) ? sanitize_key( wp_unslash( $_GET['lpsp_msg'] ) ) : '';
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'LatePoint Swiss Payments', 'lpsp' ); ?></h1>
			<?php
			$notices = array(
				'saved'           => array( 'success', __( 'Settings saved.', 'lpsp' ) ),
				'voucher_created' => array( 'success', __( 'Voucher created.', 'lpsp' ) ),
				'voucher_deleted' => array( 'success', __( 'Voucher deleted.', 'lpsp' ) ),
			);
			if ( isset( $notices[ $msg ] ) ) {
				printf( '<div class="notice notice-%s is-dismissible"><p>%s</p></div>', esc_attr( $notices[ $msg ][0] ), esc_html( $notices[ $msg ][1] ) );
			} elseif ( 'voucher_error' === $msg ) {
				$err = isset( $_GET['lpsp_err'] ) ? sanitize_text_field( rawurldecode( wp_unslash( $_GET['lpsp_err'] ) ) ) : '';
				printf( '<div class="notice notice-error"><p>%s</p></div>', esc_html( $err ) );
			}
			?>

			<h2><?php esc_html_e( 'Pay on site', 'lpsp' ); ?></h2>
			<p>
				<?php
				$local_on = class_exists( 'OsPaymentsHelper' ) && OsPaymentsHelper::is_local_payments_enabled();
				echo $local_on
					? '<strong style="color:#1a7f37">' . esc_html__( 'Enabled.', 'lpsp' ) . '</strong> '
					: '<strong style="color:#b42318">' . esc_html__( 'Not enabled.', 'lpsp' ) . '</strong> ';
				esc_html_e( 'Pay on site ("Pay Locally") is built into LatePoint and free. Turn it on in LatePoint > Settings > Payments.', 'lpsp' );
				?>
			</p>

			<form method="post">
				<?php wp_nonce_field( 'lpsp_admin' ); ?>
				<input type="hidden" name="lpsp_action" value="save_settings">

				<h2><?php esc_html_e( 'Bank transfer (Swiss QR-bill)', 'lpsp' ); ?></h2>
				<p><?php $this->checkbox( 'qr_enabled', __( 'Offer QR-bill bank transfer at checkout', 'lpsp' ) ); ?></p>
				<?php
				$iban = LPSP_Options::get( 'qr_iban' );
				if ( '' !== $iban && ! LPSP_QRBill::is_valid_iban( $iban ) ) {
					echo '<div class="notice notice-warning inline"><p>' . esc_html__( 'The IBAN is not a valid CH/LI IBAN, so QR-bill stays hidden until it is fixed.', 'lpsp' ) . '</p></div>';
				} elseif ( '' !== $iban && LPSP_Options::is_on( 'qr_enabled' ) && null === LPSP_Options::creditor() ) {
					echo '<div class="notice notice-warning inline"><p>' . esc_html__( 'Name, ZIP and city are required, so QR-bill stays hidden until they are filled in.', 'lpsp' ) . '</p></div>';
				}
				?>
				<table class="form-table" role="presentation">
					<?php
					$this->field( 'qr_label', __( 'Label at checkout', 'lpsp' ), __( 'Bank transfer (QR-bill)', 'lpsp' ) );
					$this->field( 'qr_iban', __( 'IBAN or QR-IBAN', 'lpsp' ), '', 'regular-text', __( 'CH or LI. A QR-IBAN gets a QR reference, a normal IBAN gets an ISO 11649 reference (RF...).', 'lpsp' ) );
					$this->field( 'qr_name', __( 'Account holder', 'lpsp' ) );
					$this->field( 'qr_street', __( 'Street', 'lpsp' ) );
					$this->field( 'qr_building', __( 'House number', 'lpsp' ), '', 'small-text' );
					$this->field( 'qr_zip', __( 'ZIP', 'lpsp' ), '', 'small-text' );
					$this->field( 'qr_city', __( 'City', 'lpsp' ) );
					$this->field( 'qr_message_prefix', __( 'Message prefix', 'lpsp' ), 'Order', 'regular-text', __( 'Shown on the bank statement followed by the booking confirmation code.', 'lpsp' ) );
					?>
					<tr>
						<th scope="row"><?php esc_html_e( 'Country / currency', 'lpsp' ); ?></th>
						<td>
							<select name="qr_country">
								<option value="CH" <?php selected( LPSP_Options::get( 'qr_country', 'CH' ), 'CH' ); ?>>CH</option>
								<option value="LI" <?php selected( LPSP_Options::get( 'qr_country', 'CH' ), 'LI' ); ?>>LI</option>
							</select>
							<select name="qr_currency">
								<option value="CHF" <?php selected( LPSP_Options::get( 'qr_currency', 'CHF' ), 'CHF' ); ?>>CHF</option>
								<option value="EUR" <?php selected( LPSP_Options::get( 'qr_currency', 'CHF' ), 'EUR' ); ?>>EUR</option>
							</select>
						</td>
					</tr>
				</table>

				<h2><?php esc_html_e( 'TWINT (manual)', 'lpsp' ); ?></h2>
				<p class="description">
					<?php esc_html_e( 'The customer sends money to your TWINT number and you confirm it by hand. There is no fee, but TWINT private accounts are not meant for business use and payments cannot be matched automatically. Check TWINT terms before relying on this, or get a TWINT business account.', 'lpsp' ); ?>
				</p>
				<p><?php $this->checkbox( 'twint_enabled', __( 'Offer manual TWINT at checkout', 'lpsp' ) ); ?></p>
				<table class="form-table" role="presentation">
					<?php
					$this->field( 'twint_label', __( 'Label at checkout', 'lpsp' ), 'TWINT' );
					$this->field( 'twint_phone', __( 'TWINT phone number', 'lpsp' ), '', 'regular-text', __( 'Required to show the method.', 'lpsp' ) );
					$this->field( 'twint_qr_url', __( 'TWINT QR image URL (optional)', 'lpsp' ), '', 'large-text', __( 'Upload your TWINT QR to the media library and paste its URL.', 'lpsp' ) );
					?>
					<tr>
						<th scope="row"><label for="twint_instructions"><?php esc_html_e( 'Extra instructions', 'lpsp' ); ?></label></th>
						<td><textarea id="twint_instructions" name="twint_instructions" rows="3" class="large-text"><?php echo esc_textarea( LPSP_Options::get( 'twint_instructions' ) ); ?></textarea></td>
					</tr>
				</table>

				<h2><?php esc_html_e( 'Vouchers and prepaid credit', 'lpsp' ); ?></h2>
				<p><?php $this->checkbox( 'voucher_enabled', __( 'Let customers pay with a voucher code at checkout', 'lpsp' ) ); ?></p>
				<table class="form-table" role="presentation">
					<?php $this->field( 'voucher_label', __( 'Label at checkout', 'lpsp' ), __( 'Voucher code', 'lpsp' ) ); ?>
				</table>

				<h2><?php esc_html_e( 'Emails', 'lpsp' ); ?></h2>
				<p><?php $this->checkbox( 'send_email', __( 'Email the payment instructions to the customer after booking (QR-bill and TWINT)', 'lpsp' ) ); ?></p>

				<?php submit_button( __( 'Save settings', 'lpsp' ) ); ?>
			</form>

			<hr>
			<h2><?php esc_html_e( 'Voucher codes', 'lpsp' ); ?></h2>
			<p class="description"><?php esc_html_e( 'A voucher is paid for outside the booking flow (cash, bank transfer, TWINT), then you create the code here and give it to the customer. At checkout the full amount due is deducted from the balance. Partial coverage is not supported: the balance must cover the whole amount.', 'lpsp' ); ?></p>

			<form method="post" style="margin:12px 0">
				<?php wp_nonce_field( 'lpsp_admin' ); ?>
				<input type="hidden" name="lpsp_action" value="create_voucher">
				<input type="text" name="voucher_amount" placeholder="<?php esc_attr_e( 'Amount', 'lpsp' ); ?>" class="small-text" required>
				<input type="text" name="voucher_code" placeholder="<?php esc_attr_e( 'Code (blank = generate)', 'lpsp' ); ?>">
				<input type="date" name="voucher_expires" title="<?php esc_attr_e( 'Expiry (optional)', 'lpsp' ); ?>">
				<input type="text" name="voucher_note" placeholder="<?php esc_attr_e( 'Note (for example customer name)', 'lpsp' ); ?>" class="regular-text">
				<?php submit_button( __( 'Create voucher', 'lpsp' ), 'secondary', 'submit', false ); ?>
			</form>

			<table class="widefat striped" style="max-width:900px">
				<thead><tr>
					<th><?php esc_html_e( 'Code', 'lpsp' ); ?></th>
					<th><?php esc_html_e( 'Balance', 'lpsp' ); ?></th>
					<th><?php esc_html_e( 'Initial', 'lpsp' ); ?></th>
					<th><?php esc_html_e( 'Expires', 'lpsp' ); ?></th>
					<th><?php esc_html_e( 'Note', 'lpsp' ); ?></th>
					<th></th>
				</tr></thead>
				<tbody>
				<?php
				$vouchers = LPSP_Vouchers::all();
				if ( ! $vouchers ) {
					echo '<tr><td colspan="6">' . esc_html__( 'No vouchers yet.', 'lpsp' ) . '</td></tr>';
				}
				foreach ( $vouchers as $v ) :
					?>
					<tr>
						<td><code><?php echo esc_html( $v->code ); ?></code></td>
						<td><?php echo esc_html( number_format( (float) $v->balance, 2, '.', "'" ) ); ?></td>
						<td><?php echo esc_html( number_format( (float) $v->amount, 2, '.', "'" ) ); ?></td>
						<td><?php echo esc_html( $v->expires_at ? $v->expires_at : '-' ); ?></td>
						<td><?php echo esc_html( $v->note ); ?></td>
						<td>
							<form method="post" onsubmit="return confirm('<?php echo esc_js( __( 'Delete this voucher?', 'lpsp' ) ); ?>')">
								<?php wp_nonce_field( 'lpsp_admin' ); ?>
								<input type="hidden" name="lpsp_action" value="delete_voucher">
								<input type="hidden" name="voucher_id" value="<?php echo (int) $v->id; ?>">
								<button class="button-link-delete" type="submit"><?php esc_html_e( 'Delete', 'lpsp' ); ?></button>
							</form>
						</td>
					</tr>
				<?php endforeach; ?>
				</tbody>
			</table>
		</div>
		<?php
	}
}
