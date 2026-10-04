/**
 * Copies the voucher code the customer types into LatePoint's hidden
 * cart[payment_token] field, which LatePoint sends to the server as the
 * payment token. Delegated, because LatePoint loads each booking step by AJAX.
 */
(function ($) {
	function sync($input) {
		var $form = $input.closest('.latepoint-booking-form-element');
		$form.find('input[name="cart[payment_token]"]').val($.trim($input.val()));
	}

	$(document).on('input change blur', '.lpsp-voucher-input', function () {
		sync($(this));
	});

	$(document).on('latepoint:submitBookingForm', '.latepoint-booking-form-element', function () {
		var $input = $(this).find('.lpsp-voucher-input');
		if ($input.length) {
			sync($input);
		}
	});
})(jQuery);
