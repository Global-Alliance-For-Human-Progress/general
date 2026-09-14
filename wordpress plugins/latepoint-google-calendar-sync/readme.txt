=== LatePoint Google Calendar Sync (Two-Way) ===
Contributors: Liam Bartsch
Requires at least: 5.8
Tested up to: 6.6
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later

Free two-way Google Calendar sync for LatePoint, as a companion plugin.

== What it does ==

1. Sync out (LatePoint -> Google): when a booking is created, changed, cancelled
   or deleted in LatePoint, a matching event is created / updated / removed in
   your Google Calendar.

2. Block busy (Google -> LatePoint): your Google Calendar's busy times are read
   and used to block those slots in LatePoint, so clients can't book over your
   existing commitments (dentist, other work, personal events, etc).

It is a companion to LatePoint. It does NOT replace LatePoint, and it only uses
LatePoint's public hooks (verified against LatePoint 5.6.11):
  - latepoint_booking_created / _updated / _change_status / _will_be_deleted
  - latepoint_get_booked_periods

== Requirements ==

- WordPress with the LatePoint plugin installed and active.
- A free Google Cloud project (for the OAuth Client ID + Secret). No paid tier
  or billing is required for Calendar API on normal usage.

== Install ==

1. Zip the "latepoint-google-calendar-sync" folder.
2. WP Admin -> Plugins -> Add New -> Upload Plugin -> choose the zip -> Install
   -> Activate.
3. Go to Settings -> "LatePoint GCal Sync".

== Google Cloud setup (one time, ~10 minutes) ==

1. Go to https://console.cloud.google.com/ and create a new project (top bar
   project selector -> New Project). Name it anything, e.g. "Website Calendar".

2. Enable the Calendar API:
   - APIs & Services -> Library -> search "Google Calendar API" -> Enable.

3. Configure the OAuth consent screen:
   - APIs & Services -> OAuth consent screen.
   - User type: External. Fill in the app name, your support email, and the
     developer contact email. Save.
   - Scopes: you can leave the defaults, the plugin requests the calendar scopes
     at connect time.
   - Test users: add the Google account whose calendar you want to sync (the
     business calendar). While the app is in "Testing" mode, only listed test
     users can connect, which is fine for a single-owner site. You do NOT need
     to publish/verify the app for your own use.

4. Create the OAuth client credentials:
   - APIs & Services -> Credentials -> Create Credentials -> OAuth client ID.
   - Application type: Web application.
   - Authorized redirect URIs -> Add URI, and paste the exact redirect URI shown
     on the plugin's settings page (Settings -> LatePoint GCal Sync). It looks
     like:  https://yoursite.com/wp-admin/options-general.php?page=lpgcs-settings
   - Create. Copy the Client ID and Client Secret.

5. In the plugin settings page:
   - Paste the Client ID and Client Secret, choose the agent (or "All agents"
     for a single-person site), pick the target calendar (usually "primary"),
     tick both sync directions, and Save.
   - Click "Connect Google Account" and approve access with the business Google
     account. You'll be redirected back and the status will show "Connected".

== Notes and limits ==

- Busy times are cached for ~10 minutes to avoid hammering the Google API on
  every availability check. Use "Refresh busy times now" on the settings page to
  clear that cache immediately after changing your Google Calendar. You can
  change the cache duration with the `lpgcs_busy_cache_seconds` filter.

- "Block busy" applies to the agent you selected. On a single-agent site choose
  "All agents".

- Event titles/descriptions can be customized with the `lpgcs_event_summary` and
  `lpgcs_event_description` filters.

- Privacy: "Block busy" uses Google's free/busy API, which returns only busy time
  ranges, not the titles or details of your private events.

== If sync stops working ==

Because this rides on LatePoint's hooks, a future LatePoint release could rename
or change them. Signs: new bookings stop appearing in Google, or your Google
busy times stop blocking slots. To check quickly, set `define('WP_DEBUG', true);`
in wp-config.php and look in wp-content/debug.log for lines starting with
"[LPGCS]". If Google rejected the saved connection (e.g. after changing the
Google password or revoking access), the settings page shows a reconnect warning;
click Disconnect then Connect again.

== Changelog ==

= 1.0.0 =
* Initial release: two-way sync (bookings -> Google events, Google busy ->
  LatePoint blocked slots), OAuth connect/disconnect, per-agent targeting,
  busy-time caching.
