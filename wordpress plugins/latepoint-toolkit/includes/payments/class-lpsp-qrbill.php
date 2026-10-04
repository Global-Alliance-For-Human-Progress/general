<?php
/**
 * Swiss QR-bill helpers: IBAN checks, payment references, the QR payload text
 * (Swiss Implementation Guidelines QR-bill v2.x, "SPC" 0200) and an SVG renderer.
 *
 * Pure PHP with no WordPress dependency except the vendored QR encoder, so it
 * can be unit-tested from the CLI.
 */

if ( ! defined( 'ABSPATH' ) && php_sapi_name() !== 'cli' ) {
	exit;
}

require_once __DIR__ . '/vendor/qrcode.php';

class LPSP_QRBill {

	public static function normalize_iban( $iban ) {
		return strtoupper( preg_replace( '/\s+/', '', (string) $iban ) );
	}

	/** Only CH/LI IBANs (21 chars) are valid creditor accounts for a QR-bill. */
	public static function is_valid_iban( $iban ) {
		$iban = self::normalize_iban( $iban );
		if ( ! preg_match( '/^(CH|LI)\d{2}[0-9A-Z]{17}$/', $iban ) ) {
			return false;
		}
		$rearranged = substr( $iban, 4 ) . substr( $iban, 0, 4 );
		return self::mod97( self::letters_to_digits( $rearranged ) ) === 1;
	}

	/** QR-IBANs carry an IID in the range 30000-31999 and require a QR reference (QRR). */
	public static function is_qr_iban( $iban ) {
		$iban = self::normalize_iban( $iban );
		if ( strlen( $iban ) !== 21 ) {
			return false;
		}
		$iid = (int) substr( $iban, 4, 5 );
		return $iid >= 30000 && $iid <= 31999;
	}

	public static function format_iban( $iban ) {
		return trim( chunk_split( self::normalize_iban( $iban ), 4, ' ' ) );
	}

	/** 26 digits from the base number plus a modulo 10 recursive check digit (27 total). */
	public static function qrr_reference( $base ) {
		$digits = preg_replace( '/\D/', '', (string) $base );
		$digits = substr( str_pad( $digits, 26, '0', STR_PAD_LEFT ), -26 );
		$table  = array( 0, 9, 4, 6, 8, 2, 7, 1, 3, 5 );
		$carry  = 0;
		foreach ( str_split( $digits ) as $d ) {
			$carry = $table[ ( $carry + (int) $d ) % 10 ];
		}
		return $digits . ( ( 10 - $carry ) % 10 );
	}

	/** ISO 11649 creditor reference: "RF" + 2 check digits + up to 21 alphanumerics. */
	public static function scor_reference( $base ) {
		$base = strtoupper( preg_replace( '/[^0-9A-Za-z]/', '', (string) $base ) );
		$base = substr( $base, 0, 21 );
		$check = 98 - self::mod97( self::letters_to_digits( $base . 'RF00' ) );
		return 'RF' . str_pad( (string) $check, 2, '0', STR_PAD_LEFT ) . $base;
	}

	/**
	 * @return array{type:string,reference:string}
	 */
	public static function build_reference( $iban, $base ) {
		if ( self::is_qr_iban( $iban ) ) {
			return array( 'type' => 'QRR', 'reference' => self::qrr_reference( $base ) );
		}
		return array( 'type' => 'SCOR', 'reference' => self::scor_reference( $base ) );
	}

	public static function format_reference( $type, $reference ) {
		if ( 'QRR' === $type ) {
			// Groups of 5 from the right: "21 00000 00003 13947 14300 09017".
			return trim( strrev( chunk_split( strrev( $reference ), 5, ' ' ) ) );
		}
		return trim( chunk_split( $reference, 4, ' ' ) );
	}

	/**
	 * Build the QR code payload text.
	 *
	 * @param array $c Creditor: iban, name, street, building, zip, city, country.
	 */
	public static function payload( array $c, $amount, $currency, $ref_type, $reference, $message = '' ) {
		$clean = function ( $v, $max ) {
			$v = trim( preg_replace( '/[\r\n]+/', ' ', (string) $v ) );
			return function_exists( 'mb_substr' ) ? mb_substr( $v, 0, $max ) : substr( $v, 0, $max );
		};
		$lines = array(
			'SPC',
			'0200',
			'1',
			self::normalize_iban( $c['iban'] ),
			'S',
			$clean( $c['name'], 70 ),
			$clean( $c['street'], 70 ),
			$clean( $c['building'], 16 ),
			$clean( $c['zip'], 16 ),
			$clean( $c['city'], 35 ),
			strtoupper( substr( (string) $c['country'], 0, 2 ) ),
			'', '', '', '', '', '', '',
			number_format( (float) $amount, 2, '.', '' ),
			strtoupper( $currency ),
			'', '', '', '', '', '', '',
			$ref_type,
			'QRR' === $ref_type || 'SCOR' === $ref_type ? $reference : '',
			$clean( $message, 140 ),
			'EPD',
		);
		return implode( "\n", $lines );
	}

	/** Render the payload as an SVG QR code (error correction M) with the Swiss cross overlay. */
	public static function svg( $payload, $px = 230 ) {
		$qr = new QRCode();
		$qr->setErrorCorrectLevel( QR_ERROR_CORRECT_LEVEL_M );
		$qr->addData( $payload, QR_MODE_8BIT_BYTE );
		$length = $qr->getData( 0 )->getLength();
		$type   = 40;
		for ( $t = 1; $t <= 40; $t++ ) {
			if ( $length <= QRUtil::getMaxLength( $t, QR_MODE_8BIT_BYTE, QR_ERROR_CORRECT_LEVEL_M ) ) {
				$type = $t;
				break;
			}
		}
		$qr->setTypeNumber( $type );
		$qr->make();

		$n      = $qr->getModuleCount();
		$margin = 4;
		$size   = $n + 2 * $margin;
		$path   = '';
		for ( $r = 0; $r < $n; $r++ ) {
			for ( $col = 0; $col < $n; $col++ ) {
				if ( $qr->isDark( $r, $col ) ) {
					$path .= 'M' . ( $col + $margin ) . ' ' . ( $r + $margin ) . 'h1v1h-1z';
				}
			}
		}

		// Swiss cross: 7mm black square with white cross, on a 9mm white box, in a 46mm symbol.
		$mid   = $size / 2;
		$box   = $n * 9 / 46;
		$sq    = $n * 7 / 46;
		$arm_l = $sq * 20 / 32;
		$arm_w = $sq * 6 / 32;

		$svg  = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' . $size . ' ' . $size . '" width="' . (int) $px . '" height="' . (int) $px . '" role="img" aria-label="Swiss QR code" shape-rendering="crispEdges">';
		$svg .= '<rect width="' . $size . '" height="' . $size . '" fill="#fff"/>';
		$svg .= '<path d="' . $path . '" fill="#000"/>';
		$svg .= '<rect x="' . ( $mid - $box / 2 ) . '" y="' . ( $mid - $box / 2 ) . '" width="' . $box . '" height="' . $box . '" fill="#fff"/>';
		$svg .= '<rect x="' . ( $mid - $sq / 2 ) . '" y="' . ( $mid - $sq / 2 ) . '" width="' . $sq . '" height="' . $sq . '" fill="#000"/>';
		$svg .= '<rect x="' . ( $mid - $arm_w / 2 ) . '" y="' . ( $mid - $arm_l / 2 ) . '" width="' . $arm_w . '" height="' . $arm_l . '" fill="#fff"/>';
		$svg .= '<rect x="' . ( $mid - $arm_l / 2 ) . '" y="' . ( $mid - $arm_w / 2 ) . '" width="' . $arm_l . '" height="' . $arm_w . '" fill="#fff"/>';
		$svg .= '</svg>';
		return $svg;
	}

	private static function letters_to_digits( $s ) {
		$out = '';
		foreach ( str_split( $s ) as $ch ) {
			$out .= ctype_alpha( $ch ) ? (string) ( ord( $ch ) - 55 ) : $ch;
		}
		return $out;
	}

	private static function mod97( $digits ) {
		$rem = 0;
		foreach ( str_split( $digits, 7 ) as $chunk ) {
			$rem = (int) ( $rem . $chunk ) % 97;
		}
		return $rem;
	}
}
