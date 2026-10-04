<?php
/**
 * Prepaid voucher codes: storage and atomic redemption.
 *
 * A voucher is a code with a CHF balance the owner creates (for example after
 * a customer paid a package price by bank transfer or cash). At checkout the
 * customer enters the code and the order amount is deducted from its balance.
 * Every redemption is logged against the order intent, which also makes the
 * redeem step idempotent if LatePoint processes the same intent twice.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class LPSP_Vouchers {

	const DB_VERSION = '1';

	public static function vouchers_table() {
		global $wpdb;
		return $wpdb->prefix . 'lpsp_vouchers';
	}

	public static function redemptions_table() {
		global $wpdb;
		return $wpdb->prefix . 'lpsp_redemptions';
	}

	public static function install() {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$charset = $wpdb->get_charset_collate();

		dbDelta( 'CREATE TABLE ' . self::vouchers_table() . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			code varchar(40) NOT NULL,
			amount decimal(10,2) NOT NULL DEFAULT 0,
			balance decimal(10,2) NOT NULL DEFAULT 0,
			expires_at date DEFAULT NULL,
			note varchar(255) NOT NULL DEFAULT '',
			created_at datetime NOT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY code (code)
		) $charset;" );

		dbDelta( 'CREATE TABLE ' . self::redemptions_table() . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			voucher_id bigint(20) unsigned NOT NULL,
			order_intent_id bigint(20) unsigned NOT NULL,
			amount decimal(10,2) NOT NULL,
			charge_id varchar(80) NOT NULL,
			created_at datetime NOT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY order_intent_id (order_intent_id),
			KEY voucher_id (voucher_id)
		) $charset;" );

		update_option( 'lpsp_db_version', self::DB_VERSION );
	}

	public static function maybe_upgrade() {
		if ( get_option( 'lpsp_db_version' ) !== self::DB_VERSION ) {
			self::install();
		}
	}

	public static function normalize_code( $code ) {
		return strtoupper( preg_replace( '/[^0-9A-Za-z-]/', '', (string) $code ) );
	}

	/** Readable code without look-alike characters, e.g. "LP-7K3M-9QXA". */
	public static function generate_code() {
		$alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
		do {
			$parts = array();
			for ( $p = 0; $p < 2; $p++ ) {
				$part = '';
				for ( $i = 0; $i < 4; $i++ ) {
					$part .= $alphabet[ wp_rand( 0, strlen( $alphabet ) - 1 ) ];
				}
				$parts[] = $part;
			}
			$code = 'LP-' . implode( '-', $parts );
		} while ( self::find_by_code( $code ) );
		return $code;
	}

	public static function find_by_code( $code ) {
		global $wpdb;
		$code = self::normalize_code( $code );
		if ( '' === $code ) {
			return null;
		}
		return $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::vouchers_table() . ' WHERE code = %s', $code ) );
	}

	public static function all() {
		global $wpdb;
		return $wpdb->get_results( 'SELECT * FROM ' . self::vouchers_table() . ' ORDER BY id DESC LIMIT 500' );
	}

	/**
	 * @return int|WP_Error New voucher id.
	 */
	public static function create( $amount, $code = '', $expires_at = '', $note = '' ) {
		global $wpdb;
		$amount = round( (float) $amount, 2 );
		if ( $amount <= 0 ) {
			return new WP_Error( 'lpsp_amount', __( 'Voucher amount must be greater than zero.', 'lpsp' ) );
		}
		$code = '' === trim( (string) $code ) ? self::generate_code() : self::normalize_code( $code );
		if ( strlen( $code ) < 4 || strlen( $code ) > 40 ) {
			return new WP_Error( 'lpsp_code', __( 'Voucher code must be 4 to 40 characters.', 'lpsp' ) );
		}
		if ( self::find_by_code( $code ) ) {
			return new WP_Error( 'lpsp_code_exists', __( 'That voucher code already exists.', 'lpsp' ) );
		}
		$expires_at = preg_match( '/^\d{4}-\d{2}-\d{2}$/', (string) $expires_at ) ? $expires_at : null;

		$ok = $wpdb->insert(
			self::vouchers_table(),
			array(
				'code'       => $code,
				'amount'     => number_format( $amount, 2, '.', '' ),
				'balance'    => number_format( $amount, 2, '.', '' ),
				'expires_at' => $expires_at,
				'note'       => mb_substr( sanitize_text_field( $note ), 0, 255 ),
				'created_at' => current_time( 'mysql' ),
			)
		);
		return $ok ? (int) $wpdb->insert_id : new WP_Error( 'lpsp_db', __( 'Could not save the voucher.', 'lpsp' ) );
	}

	public static function delete( $id ) {
		global $wpdb;
		return (bool) $wpdb->delete( self::vouchers_table(), array( 'id' => (int) $id ) );
	}

	/**
	 * Deduct $amount from the voucher for this order intent.
	 *
	 * @return array{ok:bool,message:string,charge_id:string}
	 */
	public static function redeem( $code, $amount, $order_intent_id ) {
		global $wpdb;
		$amount           = number_format( round( (float) $amount, 2 ), 2, '.', '' );
		$order_intent_id  = (int) $order_intent_id;
		$fail             = function ( $msg ) {
			return array( 'ok' => false, 'message' => $msg, 'charge_id' => '' );
		};

		$voucher = self::find_by_code( $code );
		if ( ! $voucher ) {
			return $fail( __( 'This voucher code is not valid.', 'lpsp' ) );
		}

		// Idempotent: this intent already redeemed (for example a retried request).
		$existing = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::redemptions_table() . ' WHERE order_intent_id = %d', $order_intent_id ) );
		if ( $existing ) {
			if ( (int) $existing->voucher_id === (int) $voucher->id ) {
				return array( 'ok' => true, 'message' => '', 'charge_id' => $existing->charge_id );
			}
			return $fail( __( 'A different voucher was already used for this order.', 'lpsp' ) );
		}

		if ( ! empty( $voucher->expires_at ) && $voucher->expires_at < current_time( 'Y-m-d' ) ) {
			return $fail( __( 'This voucher has expired.', 'lpsp' ) );
		}
		if ( (float) $voucher->balance + 0.00001 < (float) $amount ) {
			return $fail(
				sprintf(
					/* translators: 1: voucher balance, 2: amount due */
					__( 'The voucher balance (%1$s) does not cover the amount due (%2$s). Please choose another payment method.', 'lpsp' ),
					number_format( (float) $voucher->balance, 2, '.', "'" ),
					number_format( (float) $amount, 2, '.', "'" )
				)
			);
		}

		// Atomic deduction: only succeeds if the balance still covers the amount.
		$rows = $wpdb->query(
			$wpdb->prepare(
				'UPDATE ' . self::vouchers_table() . ' SET balance = balance - %s WHERE id = %d AND balance >= %s',
				$amount,
				(int) $voucher->id,
				$amount
			)
		);
		if ( 1 !== (int) $rows ) {
			return $fail( __( 'The voucher balance is no longer sufficient. Please try again.', 'lpsp' ) );
		}

		$charge_id = 'lpsp-v' . (int) $voucher->id . '-i' . $order_intent_id;
		$logged    = $wpdb->insert(
			self::redemptions_table(),
			array(
				'voucher_id'      => (int) $voucher->id,
				'order_intent_id' => $order_intent_id,
				'amount'          => $amount,
				'charge_id'       => $charge_id,
				'created_at'      => current_time( 'mysql' ),
			)
		);
		if ( ! $logged ) {
			// Lost a race on the same intent: give the money back, then report the existing redemption.
			$wpdb->query( $wpdb->prepare( 'UPDATE ' . self::vouchers_table() . ' SET balance = balance + %s WHERE id = %d', $amount, (int) $voucher->id ) );
			return $fail( __( 'Could not record the voucher redemption. Please try again.', 'lpsp' ) );
		}

		return array( 'ok' => true, 'message' => '', 'charge_id' => $charge_id );
	}
}
