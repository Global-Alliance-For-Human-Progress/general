=== LatePoint Toolkit (iCloud Sync, Swiss Payments) ===
Contributors: Liam Bartsch
Requires at least: 5.8
Tested up to: 6.6
Requires PHP: 7.4
Stable tag: 1.5.6
License: GPLv2 or later

Free LatePoint add-ons as a companion plugin: two-way Apple iCloud Calendar sync
over CalDAV with ntfy alerts, plus fee-free Swiss payment options (QR-bill bank
transfer, manual TWINT, prepaid voucher codes).

== Swiss payments (QR-bill, TWINT, vouchers) ==

Configure under LatePoint Toolkit > Swiss Payments (sidebar). Verified against LatePoint
5.7.3, public payment hooks only.

- Pay on site: already built into LatePoint ("Pay Locally"), free. Enable it
  under LatePoint > Settings > Payments.
- Bank transfer (Swiss QR-bill): pay-later method. After booking the customer
  sees a scannable Swiss QR code plus account, reference, amount and message,
  and gets the same details by email. A QR-IBAN gets a QR reference (QRR), a
  normal IBAN gets an ISO 11649 reference (RF...). The reference is derived from
  the LatePoint order id. You mark the payment received in LatePoint
  (Transactions).
- TWINT (manual): pay-later method. The customer sends money to your TWINT
  number with the booking code as message, you confirm it by hand. TWINT private
  accounts are not meant for business use and payments cannot be matched
  automatically. Check the TWINT terms or use a TWINT business account.
- Vouchers: pay-now method. Create a code with a balance, the customer enters it
  at checkout and the full amount due is deducted. The balance must cover the
  whole amount, partial coverage is not supported. Redemptions are logged per
  order intent and are idempotent.

Notes: the voucher tables (wp_lpsp_vouchers, wp_lpsp_redemptions) are kept when
the plugin is deleted because they hold customer balances. If an order fails
after a voucher was redeemed, the balance is not restored automatically.

== What it does ==

1. Sync out (LatePoint -> iCloud): when a booking is created, changed, cancelled
   or deleted in LatePoint, a matching event is created / updated / removed in
   your iCloud calendar. Events show up in the Apple Calendar app on iPhone, iPad
   and Mac.

2. Block busy (iCloud -> LatePoint): your iCloud calendar's events are read for
   the window LatePoint is checking and used to block those slots, so clients
   can't book over your existing commitments.

It is a companion to LatePoint. It does NOT replace LatePoint, and it only uses
LatePoint's public hooks (verified against LatePoint 5.6.11):
  - latepoint_booking_created / _updated / _change_status / _will_be_deleted
  - latepoint_get_booked_periods

== Why this is different from the Google version ==

Apple has no OAuth and no free/busy API, so this plugin speaks CalDAV directly to
caldav.icloud.com using your Apple ID plus an app-specific password. Busy times
are computed by reading the events in the requested window (with server-side
recurrence expansion), because iCloud offers no dedicated free/busy endpoint.

== Requirements ==

- WordPress with the LatePoint plugin installed and active.
- An Apple ID with two-factor authentication enabled (required to create an
  app-specific password).
- Outbound HTTPS from your web server to caldav.icloud.com (standard on almost
  all hosts).

== Install ==

1. Zip the "latepoint-toolkit" folder.
2. WP Admin -> Plugins -> Add New -> Upload Plugin -> choose the zip -> Install
   -> Activate.
3. Go to Settings -> "LatePoint iCloud Sync".

== Setup (about 5 minutes) ==

1. Create an app-specific password:
   - Go to https://appleid.apple.com and sign in.
   - Sign-In & Security -> App-Specific Passwords -> generate a new one.
   - Label it something like "LatePoint". Copy the password Apple shows
     (format xxxx-xxxx-xxxx-xxxx). You only see it once.
   - If you don't see this option, enable two-factor authentication on the
     Apple ID first.

2. In the plugin settings page (Settings -> LatePoint iCloud Sync):
   - Enter your Apple ID (the email address) and paste the app-specific password.
   - Click "Save settings". The plugin connects to iCloud and loads your list of
     calendars.
   - Choose the target calendar (a dedicated calendar such as "Appointments" is
     cleanest), pick the agent (or "All agents" for a single-person site), tick
     both sync directions, and Save again.
   - The status should now read "Connected".

== Notes and limits ==

- Busy times are cached for ~10 minutes to avoid hitting iCloud on every
  availability check. Use "Refresh busy times now" on the settings page to clear
  that cache immediately after changing your calendar. Change the duration with
  the `lpics_busy_cache_seconds` filter.

- All-day events (birthdays, holidays, multi-day markers) do NOT block bookings
  by default, because they are usually informational. To make all-day events
  block time, add: add_filter('lpics_block_all_day', '__return_true');

- Events marked "free" in Apple Calendar (TRANSP:TRANSPARENT) and cancelled
  events are ignored when computing busy times.

- Recurring events are expanded by iCloud's server for the requested window, so
  repeating commitments block correctly without the plugin having to implement
  an RRULE engine. If a specific recurring event ever fails to block, check the
  debug log (below).

- "Block busy" applies to the agent you selected. On a single-agent site choose
  "All agents".

- Event titles/descriptions can be customized with the `lpics_event_summary` and
  `lpics_event_description` filters.

- Privacy: this plugin reads event times (and, internally, titles) from the one
  calendar you select in order to compute busy slots. Only busy time ranges are
  ever used to block LatePoint; event details are not exposed to booking clients.

== If sync stops working ==

Because this rides on LatePoint's hooks, a future LatePoint release could rename
or change them. Signs: new bookings stop appearing in iCloud, or your iCloud
busy times stop blocking slots. To check, set `define('WP_DEBUG', true);` in
wp-config.php and look in wp-content/debug.log for lines starting with "[LPICS]".

If iCloud rejected the saved connection (for example after you changed the Apple
password or revoked the app-specific password), the settings page shows a
reconnect warning. Generate a new app-specific password, paste it in, and Save.

== Do not run both calendar sync plugins on the same calendar ==

If you also run the Google version, point each at a different calendar/account,
or run only one. They use separate booking meta keys so they will not corrupt
each other, but syncing the same booking into two places at once is confusing.

== Changelog ==

= 1.5.6 =
* Fix: [lp_week_schedule] long class names no longer take 3 lines in the 7-day layout; a bracketed part such as (Intermediate) shows as a small second line.

= 1.5.5 =
* Change: [lp_week_schedule] class links use underscores and drop hyphens (Abs & Glutes is #abs_glutes, K-POP is #kpop).

= 1.5.4 =
* New: [lp_week_schedule] other-class labels are links that scroll to the matching class section on the page
  (CSS ID = class name as a slug, e.g. abs_glutes). Turn off with other_links="no".

= 1.5.3 =
* Fix: [lp_week_schedule] other-class cards no longer overflow in the 7-day layout; time, name and label now stack.

= 1.5.2 =
* Change: [lp_week_schedule] classes are now separate cards. Bookable classes have a solid
  card with a dark edge, other classes are dashed and muted, and a small legend explains both.

= 1.5.1 =
* New: [lp_week_schedule] can also list classes that cannot be booked through LatePoint:
  other_classes="Mon 18:00-19:00 Yoga; Wed 09:00-10:00 Pilates" (every week, or a date like
  2026-12-24 10:00-11:00 Name) shows them greyed in the same week view with no Book button,
  tagged by other_label (default "Not bookable here"). New intro="..." adds an explanation
  line above the schedule.

= 1.5.0 =
* New: [lp_week_schedule] shortcode, a week view of your services' open slots (this week,
  next week and so on) with time, spots left, details and a Book button that opens the
  LatePoint booking popup preset to that service, date and time. Options: service_ids,
  weeks (1 to 8, default 4), show_spots (yes/no), button_text, theme (light/dark).
  The widget is an opaque panel, so a page background image or overlay never shows through.

= 1.4.3 =
* New: "People per slot" accepts a comma list (for example 20,10,3) to set a
  different capacity per service, in the order shown on the settings page.
  A single number still applies to all services.

= 1.4.2 =
* Change: "Block availability using the iCloud calendar" is now off by default and
  was switched off once on existing sites, so bookings (and their events) no
  longer make a slot unavailable. Tick it again on the settings page to re-enable.

= 1.4.1 =
* Fix: our own booking events are now also recognised by their UID (lpics-...),
  because iCloud can drop the custom X- property, which kept slots blocked.

= 1.4.0 =
* New: "People per slot" setting. Writes the capacity into every LatePoint service
  (LatePoint core already enforces it, but the free plugin has no field for it),
  so several people can book the same slot. Each booking still gets its own
  iCloud event and ntfy push. 0 = off.

= 1.3.1 =
* Fix: events this plugin pushes to iCloud for a booking are no longer read back
  as busy time, so a booking no longer blocks its own slot for other people.
  Disable with the lpics_ignore_own_booking_events filter.

= 1.3.0 =
* The pay-later checkout methods (QR-bill bank transfer and manual TWINT) are
  switched off by commenting out their registration, so a booking is never
  confirmed before it is paid. The code and settings are kept, and the voucher
  method is unchanged. Uncomment the lines in
  includes/payments/class-lpsp-methods.php to bring them back.

= 1.2.5 =
* Fix: the ntfy push for a new booking was sent as a fire-and-forget HTTPS
  request that WordPress often drops before it goes out (the test button worked
  because it waits for the reply). The push now goes out from the background
  queue as a normal request, and the settings page shows "Last booking push
  (ntfy)" with the real result.

= 1.2.4 =
* Fix: iCloud busy blocks are now created per real LatePoint agent and location
  instead of agent 0 / location 0, which LatePoint could ignore, so busy times
  still showed as bookable. The last-check row now lists the blocked agents.

= 1.2.3 =
* The iCloud Sync settings page now shows the result of the last availability
  check ("Last availability check"), so busy-time blocking can be diagnosed
  without enabling WP_DEBUG or editing wp-config.php.

= 1.2.2 =
* Debug logging for the busy-time blocking path ("[LPICS] inject busy: ..."), to
  diagnose slots that are still offered while the iCloud calendar is busy.

= 1.2.1 =
* Settings now live under a top-level "LatePoint Toolkit" sidebar menu (iCloud
  Sync, Swiss Payments) instead of under Settings, so they are easy to find.

= 1.2.0 =
* New Swiss payments module: QR-bill bank transfer, manual TWINT and prepaid
  voucher codes as LatePoint payment methods, with their own settings page.
  The plugin is now called "LatePoint Toolkit" and the folder is now
  latepoint-toolkit. Existing iCloud sync settings are reused. To upgrade from
  the old "latepoint-icloud-calendar-sync" folder: install and activate this
  zip, but only DEACTIVATE the old plugin, do not delete it, because deleting
  it runs its uninstall routine and erases the saved iCloud settings. If both
  are active this plugin shows a notice instead of loading.

= 1.1.0 =
* Sync out now runs in the background (WP-Cron) instead of on the booking-save
  request, so a slow or failing iCloud call can no longer make LatePoint's
  "Create Order" screen hang. Bookings save instantly and sync a moment later.
* Booking hooks are fully exception-guarded and tolerate LatePoint API
  differences, so nothing this plugin does can break LatePoint's save flow.
* Added a "Send test event now" button on the settings page that writes a real
  event to the target calendar and reports the exact result, for quick
  diagnosis of sync-out problems.
* Optional "Alert me when a new booking is created" setting: attaches a
  calendar alarm to each new synced event so your Apple devices ping shortly
  after a booking comes in. On by default; toggle it under "What to sync".
  Adjust the delay with the `lpics_creation_alarm_offset_seconds` filter.
* More detailed [LPICS] debug logging around the booking sync path.

= 1.0.0 =
* Initial release: two-way sync over CalDAV (bookings -> iCloud events, iCloud
  busy -> LatePoint blocked slots), app-specific password auth, calendar
  discovery + picker, per-agent targeting, busy-time caching.
