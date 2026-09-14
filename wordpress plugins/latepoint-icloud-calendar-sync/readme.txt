=== LatePoint iCloud Calendar Sync (Two-Way) ===
Contributors: Liam Bartsch
Requires at least: 5.8
Tested up to: 6.6
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later

Free two-way Apple iCloud Calendar sync for LatePoint, over CalDAV, as a
companion plugin.

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

1. Zip the "latepoint-icloud-calendar-sync" folder.
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

= 1.0.0 =
* Initial release: two-way sync over CalDAV (bookings -> iCloud events, iCloud
  busy -> LatePoint blocked slots), app-specific password auth, calendar
  discovery + picker, per-agent targeting, busy-time caching.
