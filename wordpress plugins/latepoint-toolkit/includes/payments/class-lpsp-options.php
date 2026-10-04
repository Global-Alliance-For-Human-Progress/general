<?php
/**
 * Option access for the Swiss payments module (QR-bill, TWINT, vouchers).
 */

if ( ! defined( 'ABSPATH' ) && php_sapi_name() !== 'cli' ) {
	exit;
}

class LPSP_Options {

	public static function get( $key, $default = '' ) {
		return get_option( 'lpsp_' . $key, $default );
	}

	public static function set( $key, $value ) {
		return update_option( 'lpsp_' . $key, $value );
	}

	public static function is_on( $key ) {
		return self::get( $key, '0' ) === '1';
	}

	/** Creditor data for the QR-bill, or null when the setup is incomplete or invalid. */
	public static function creditor() {
		$c = array(
			'iban'     => LPSP_QRBill::normalize_iban( self::get( 'qr_iban' ) ),
			'name'     => trim( (string) self::get( 'qr_name' ) ),
			'street'   => trim( (string) self::get( 'qr_street' ) ),
			'building' => trim( (string) self::get( 'qr_building' ) ),
			'zip'      => trim( (string) self::get( 'qr_zip' ) ),
			'city'     => trim( (string) self::get( 'qr_city' ) ),
			'country'  => (string) self::get( 'qr_country', 'CH' ),
		);
		if ( ! LPSP_QRBill::is_valid_iban( $c['iban'] ) || '' === $c['name'] || '' === $c['zip'] || '' === $c['city'] ) {
			return null;
		}
		return $c;
	}
}
