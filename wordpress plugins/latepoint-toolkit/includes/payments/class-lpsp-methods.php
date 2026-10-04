<?php
/**
 * Registers the QR-bill, TWINT and voucher payment methods with LatePoint and
 * renders the customer-facing payment instructions.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class LPSP_Methods {

	const PROCESSOR = 'lpsp';

	const METHOD_QR      = 'qr_bill';
	const METHOD_TWINT   = 'twint_manual';
	const METHOD_VOUCHER = 'voucher';

	public function __construct() {
		add_filter( 'latepoint_payment_processors', array( $this, 'register_processor' ) );
		add_action( 'latepoint_payment_processor_settings', array( $this, 'processor_settings_note' ), 10, 1 );

		add_filter( 'latepoint_get_all_payment_times', array( $this, 'add_all_methods' ) );
		add_filter( 'latepoint_get_enabled_payment_times', array( $this, 'add_enabled_methods' ) );

		// Pay-later methods: show instructions after booking.
		add_action( 'latepoint_step_confirmation_head_info_after', array( $this, 'output_confirmation_instructions' ), 20, 1 );
		add_action( 'latepoint_order_created', array( $this, 'email_payment_instructions' ), 30, 1 );

		// Voucher: input on the pay step, redemption on order intent processing.
		add_action( 'latepoint_step_payment__pay_content', array( $this, 'output_voucher_input' ), 10, 1 );
		add_filter( 'latepoint_process_payment_for_order_intent', array( $this, 'process_voucher_payment' ), 10, 2 );
		add_action( 'wp_enqueue_scripts', array( $this, 'enqueue_front' ) );
	}

	/* ---------------------------------------------------------------
	 * Registration
	 * ------------------------------------------------------------- */

	public function register_processor( $processors ) {
		$processors[ self::PROCESSOR ] = array(
			'code'       => self::PROCESSOR,
			'name'       => __( 'Swiss Payments (QR-bill, TWINT, Vouchers)', 'lpsp' ),
			'front_name' => __( 'Swiss payments', 'lpsp' ),
			'image_url'  => LPSP_URL . 'assets/icon-qr.svg',
		);
		return $processors;
	}

	public function processor_settings_note( $processor_code ) {
		if ( self::PROCESSOR !== $processor_code ) {
			return;
		}
		$url = LPSP_Settings::page_url();
		echo '<div class="sub-section-row"><div class="sub-section-content"><p>' .
			wp_kses_post(
				sprintf(
					/* translators: %s: settings URL */
					__( 'These methods are configured on the <a href="%s">LatePoint Swiss Payments</a> settings page.', 'lpsp' ),
					esc_url( $url )
				)
			) . '</p></div></div>';
	}

	private function method_info( $code ) {
		switch ( $code ) {
			case self::METHOD_QR:
				return array(
					'code'      => $code,
					'label'     => (string) LPSP_Options::get( 'qr_label', __( 'Bank transfer (QR-bill)', 'lpsp' ) ),
					'image_url' => LPSP_URL . 'assets/icon-qr.svg',
				);
			case self::METHOD_TWINT:
				return array(
					'code'      => $code,
					'label'     => (string) LPSP_Options::get( 'twint_label', 'TWINT' ),
					'image_url' => LPSP_URL . 'assets/icon-twint.svg',
				);
			default:
				return array(
					'code'      => $code,
					'label'     => (string) LPSP_Options::get( 'voucher_label', __( 'Voucher code', 'lpsp' ) ),
					'image_url' => LPSP_URL . 'assets/icon-voucher.svg',
				);
		}
	}

	public function add_all_methods( $payment_times ) {
		$later = defined( 'LATEPOINT_PAYMENT_TIME_LATER' ) ? LATEPOINT_PAYMENT_TIME_LATER : 'later';
		$now   = defined( 'LATEPOINT_PAYMENT_TIME_NOW' ) ? LATEPOINT_PAYMENT_TIME_NOW : 'now';
		$payment_times[ $later ][ self::METHOD_QR ][ self::PROCESSOR ]      = $this->method_info( self::METHOD_QR );
		$payment_times[ $later ][ self::METHOD_TWINT ][ self::PROCESSOR ]   = $this->method_info( self::METHOD_TWINT );
		$payment_times[ $now ][ self::METHOD_VOUCHER ][ self::PROCESSOR ]   = $this->method_info( self::METHOD_VOUCHER );
		return $payment_times;
	}

	public function add_enabled_methods( $payment_times ) {
		$later = defined( 'LATEPOINT_PAYMENT_TIME_LATER' ) ? LATEPOINT_PAYMENT_TIME_LATER : 'later';
		$now   = defined( 'LATEPOINT_PAYMENT_TIME_NOW' ) ? LATEPOINT_PAYMENT_TIME_NOW : 'now';

		if ( self::qr_enabled() ) {
			$payment_times[ $later ][ self::METHOD_QR ][ self::PROCESSOR ] = $this->method_info( self::METHOD_QR );
		}
		if ( self::twint_enabled() ) {
			$payment_times[ $later ][ self::METHOD_TWINT ][ self::PROCESSOR ] = $this->method_info( self::METHOD_TWINT );
		}
		if ( LPSP_Options::is_on( 'voucher_enabled' ) ) {
			$payment_times[ $now ][ self::METHOD_VOUCHER ][ self::PROCESSOR ] = $this->method_info( self::METHOD_VOUCHER );
		}
		return $payment_times;
	}

	public static function qr_enabled() {
		return LPSP_Options::is_on( 'qr_enabled' ) && null !== LPSP_Options::creditor();
	}

	public static function twint_enabled() {
		return LPSP_Options::is_on( 'twint_enabled' ) && '' !== trim( (string) LPSP_Options::get( 'twint_phone' ) );
	}

	/* ---------------------------------------------------------------
	 * Pay-later instructions (QR-bill, TWINT)
	 * ------------------------------------------------------------- */

	/** @return string|null Our pay-later method code for this order, if any. */
	private function order_method( $order ) {
		if ( ! is_object( $order ) || self::PROCESSOR !== $order->get_initial_payment_data_value( 'processor' ) ) {
			return null;
		}
		$method = $order->get_initial_payment_data_value( 'method' );
		return in_array( $method, array( self::METHOD_QR, self::METHOD_TWINT ), true ) ? $method : null;
	}

	private function amount_due( $order ) {
		$due = (float) $order->get_total_balance_due();
		return $due > 0 ? $due : 0.0;
	}

	/** Reference and payload for an order's QR-bill. */
	private function qr_data( $order, $amount ) {
		$creditor  = LPSP_Options::creditor();
		if ( ! $creditor ) {
			return null;
		}
		$ref       = LPSP_QRBill::build_reference( $creditor['iban'], (string) $order->id );
		$currency  = (string) LPSP_Options::get( 'qr_currency', 'CHF' );
		$message   = trim( (string) LPSP_Options::get( 'qr_message_prefix', 'Order' ) . ' ' . $order->confirmation_code );
		$payload   = LPSP_QRBill::payload( $creditor, $amount, $currency, $ref['type'], $ref['reference'], $message );
		return array(
			'creditor'  => $creditor,
			'ref_type'  => $ref['type'],
			'reference' => $ref['reference'],
			'currency'  => $currency,
			'message'   => $message,
			'payload'   => $payload,
		);
	}

	public function output_confirmation_instructions( $order ) {
		$method = $this->order_method( $order );
		if ( ! $method ) {
			return;
		}
		$amount = $this->amount_due( $order );
		if ( $amount <= 0 ) {
			return;
		}

		echo '<style>.lpsp-box{margin:16px 0;padding:16px;border:1px solid #d8dde6;border-radius:8px;background:#fff;text-align:left;font-size:14px;line-height:1.5}.lpsp-box h4{margin:0 0 8px;font-size:15px}.lpsp-box table{border-collapse:collapse;width:100%}.lpsp-box td{padding:3px 8px 3px 0;vertical-align:top}.lpsp-box td:first-child{color:#667085;white-space:nowrap}.lpsp-box .lpsp-qr{margin:12px 0}.lpsp-box .lpsp-qr svg{max-width:100%;height:auto;display:block}</style>';
		echo '<div class="lpsp-box">';

		if ( self::METHOD_QR === $method ) {
			$qr = $this->qr_data( $order, $amount );
			if ( ! $qr ) {
				echo '</div>';
				return;
			}
			$c = $qr['creditor'];
			echo '<h4>' . esc_html__( 'Pay by bank transfer', 'lpsp' ) . '</h4>';
			echo '<p>' . esc_html__( 'Scan the QR code with your banking app, or enter the details below.', 'lpsp' ) . '</p>';
			echo '<div class="lpsp-qr">' . LPSP_QRBill::svg( $qr['payload'], 200 ) . '</div>'; // phpcs:ignore WordPress.Security.EscapeOutput -- generated SVG of digits only.
			echo '<table>';
			$this->row( __( 'Account', 'lpsp' ), LPSP_QRBill::format_iban( $c['iban'] ) );
			$this->row( __( 'Payable to', 'lpsp' ), $c['name'] . ', ' . trim( $c['street'] . ' ' . $c['building'] ) . ', ' . $c['zip'] . ' ' . $c['city'] );
			$this->row( __( 'Reference', 'lpsp' ), LPSP_QRBill::format_reference( $qr['ref_type'], $qr['reference'] ) );
			$this->row( __( 'Amount', 'lpsp' ), $qr['currency'] . ' ' . number_format( $amount, 2, '.', "'" ) );
			$this->row( __( 'Message', 'lpsp' ), $qr['message'] );
			echo '</table>';
		} else {
			echo '<h4>' . esc_html( (string) LPSP_Options::get( 'twint_label', 'TWINT' ) ) . '</h4>';
			echo '<table>';
			$this->row( __( 'Send to', 'lpsp' ), (string) LPSP_Options::get( 'twint_phone' ) );
			$this->row( __( 'Amount', 'lpsp' ), $this->format_amount( $amount ) );
			$this->row( __( 'Message', 'lpsp' ), trim( (string) LPSP_Options::get( 'qr_message_prefix', 'Order' ) . ' ' . $order->confirmation_code ) );
			echo '</table>';
			$text = trim( (string) LPSP_Options::get( 'twint_instructions' ) );
			if ( '' !== $text ) {
				echo '<p>' . nl2br( esc_html( $text ) ) . '</p>';
			}
			$qr_url = (string) LPSP_Options::get( 'twint_qr_url' );
			if ( '' !== $qr_url ) {
				echo '<div class="lpsp-qr"><img src="' . esc_url( $qr_url ) . '" alt="TWINT QR" style="max-width:200px;height:auto"></div>';
			}
		}

		echo '<p>' . esc_html__( 'Please complete the payment using the details above.', 'lpsp' ) . '</p>';
		echo '</div>';
	}

	private function row( $label, $value ) {
		echo '<tr><td>' . esc_html( $label ) . '</td><td>' . esc_html( $value ) . '</td></tr>';
	}

	private function format_amount( $amount ) {
		if ( class_exists( 'OsMoneyHelper' ) ) {
			return OsMoneyHelper::format_price( $amount, true, false );
		}
		return number_format( $amount, 2, '.', "'" );
	}

	/** Plain-text copy of the instructions, since LatePoint's own emails do not know about them. */
	public function email_payment_instructions( $order ) {
		$method = $this->order_method( $order );
		if ( ! $method || ! LPSP_Options::is_on( 'send_email' ) ) {
			return;
		}
		$amount = $this->amount_due( $order );
		$customer = $order->get_customer();
		if ( $amount <= 0 || ! $customer || ! is_email( $customer->email ) ) {
			return;
		}

		$lines   = array();
		$lines[] = sprintf( __( 'Thank you for your booking (%s).', 'lpsp' ), $order->confirmation_code );
		$lines[] = '';
		if ( self::METHOD_QR === $method ) {
			$qr = $this->qr_data( $order, $amount );
			if ( ! $qr ) {
				return;
			}
			$c       = $qr['creditor'];
			$lines[] = __( 'Please pay by bank transfer:', 'lpsp' );
			$lines[] = __( 'Account', 'lpsp' ) . ': ' . LPSP_QRBill::format_iban( $c['iban'] );
			$lines[] = __( 'Payable to', 'lpsp' ) . ': ' . $c['name'] . ', ' . trim( $c['street'] . ' ' . $c['building'] ) . ', ' . $c['zip'] . ' ' . $c['city'];
			$lines[] = __( 'Reference', 'lpsp' ) . ': ' . LPSP_QRBill::format_reference( $qr['ref_type'], $qr['reference'] );
			$lines[] = __( 'Amount', 'lpsp' ) . ': ' . $qr['currency'] . ' ' . number_format( $amount, 2, '.', "'" );
			$lines[] = __( 'Message', 'lpsp' ) . ': ' . $qr['message'];
		} else {
			$lines[] = __( 'Please pay with TWINT:', 'lpsp' );
			$lines[] = __( 'Send to', 'lpsp' ) . ': ' . LPSP_Options::get( 'twint_phone' );
			$lines[] = __( 'Amount', 'lpsp' ) . ': ' . $this->format_amount( $amount );
			$lines[] = __( 'Message', 'lpsp' ) . ': ' . trim( (string) LPSP_Options::get( 'qr_message_prefix', 'Order' ) . ' ' . $order->confirmation_code );
			$text    = trim( (string) LPSP_Options::get( 'twint_instructions' ) );
			if ( '' !== $text ) {
				$lines[] = '';
				$lines[] = $text;
			}
		}
		$lines[] = '';
		$lines[] = __( 'Please complete the payment using the details above.', 'lpsp' );

		wp_mail( $customer->email, sprintf( __( 'Payment instructions for your booking %s', 'lpsp' ), $order->confirmation_code ), implode( "\n", $lines ) );
	}

	/* ---------------------------------------------------------------
	 * Vouchers (pay now)
	 * ------------------------------------------------------------- */

	public function output_voucher_input( $cart ) {
		if ( ! class_exists( 'OsPaymentsHelper' ) || ! OsPaymentsHelper::should_processor_handle_payment_for_cart( self::PROCESSOR, $cart ) ) {
			return;
		}
		if ( self::METHOD_VOUCHER !== $cart->payment_method ) {
			return;
		}
		echo '<div class="lp-payment-method-content" data-payment-method="' . esc_attr( self::METHOD_VOUCHER ) . '">';
		echo '<div class="lp-payment-method-content-i">';
		echo '<div class="os-form-group os-form-textfield-group">';
		echo '<label>' . esc_html__( 'Voucher code', 'lpsp' ) . '</label>';
		echo '<input type="text" class="os-form-control lpsp-voucher-input" autocomplete="off" autocapitalize="characters" placeholder="LP-XXXX-XXXX">';
		echo '<p class="lpsp-voucher-hint">' . esc_html__( 'The voucher balance must cover the full amount due.', 'lpsp' ) . '</p>';
		echo '</div></div></div>';
	}

	public function process_voucher_payment( $result, $order_intent ) {
		if ( ! OsPaymentsHelper::should_processor_handle_payment_for_order_intent( self::PROCESSOR, $order_intent ) ) {
			return $result;
		}
		if ( self::METHOD_VOUCHER !== $order_intent->get_payment_data_value( 'method' ) ) {
			return $result;
		}

		$redeemed = LPSP_Vouchers::redeem(
			$order_intent->get_payment_data_value( 'token' ),
			$order_intent->charge_amount,
			$order_intent->id
		);

		if ( ! $redeemed['ok'] ) {
			$result['status']  = LATEPOINT_STATUS_ERROR;
			$result['message'] = $redeemed['message'];
			$order_intent->add_error( 'payment_error', $redeemed['message'] );
			$order_intent->add_error( 'send_to_step', $redeemed['message'], 'payment' );
			return $result;
		}

		$result['status']    = LATEPOINT_STATUS_SUCCESS;
		$result['processor'] = self::PROCESSOR;
		$result['charge_id'] = $redeemed['charge_id'];
		$result['amount']    = $order_intent->charge_amount;
		$result['kind']      = LATEPOINT_TRANSACTION_KIND_CAPTURE;
		return $result;
	}

	public function enqueue_front() {
		if ( ! LPSP_Options::is_on( 'voucher_enabled' ) ) {
			return;
		}
		wp_enqueue_script( 'lpsp-front', LPSP_URL . 'assets/lpsp.js', array( 'jquery' ), LPSP_VERSION, true );
	}
}
