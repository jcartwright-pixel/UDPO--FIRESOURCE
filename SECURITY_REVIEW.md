# Security review: new distribution app (phase 2, 2026-10-09)

Scope: sign-in, roles, database rules, the server calls, the sheet write-back, the screens and the deploy
workflow in this repository. Tested on the local emulators with made-up data. Nothing is live yet.

## Fixed in this review

1. **Any United Dairy Google account could read everything.** Before, the database let any signed-in
   @uniteddairy.com account read the dispatch, and that included driver phone numbers and email addresses
   copied from DRIVERS_MASTER. Now a person must also be ACTIVE in USERS_MASTER, which is the same list the
   current app uses. Someone not on that list sees a plain message ("ask an administrator to add you") and is
   signed out. Tests: `rules.test.js` (inactive and unknown accounts refused), `screens.cjs` (new-hire account
   told and signed out).
2. **The screens can be framed by another site.** Hosting now sends headers that stop other sites from
   framing the screens (clickjacking) and from sniffing file types, and that keep browsers on HTTPS
   (`firebase.json`).
3. **The write-back could aim at a different workbook from the one the copy reads.** The conflict check
   compares the sheet with what the copy last read. If the two pointed at different workbooks, that comparison
   would be wrong. The server now refuses to run unless `WRITEBACK_JSON` and `SOURCES_JSON` name the same
   sandbox workbook.

## Checked and sound

- **Sign-in.** Only verified @uniteddairy.com Google accounts are allowed. Three places enforce this: the
  database rules, every server call (`src/auth.js`) and the screens. `joe@uniteddairy.com.evil.com`, unverified
  addresses and gmail.com accounts are refused (tested). The Google "hd" hint only filters the account picker;
  the real checks are in the rules and on the server.
- **No writes from the browser.** The rules deny every write. Every change goes through one server call that
  does the following:
  - checks the person is ACTIVE with the right role;
  - checks nobody else changed that run first;
  - writes a save log with before and after values.

  Assigning drivers, trucks and trailers needs Administrator, Admin, Manager, Supervisor or Dispatcher. Load
  order needs Administrator, Admin or Manager, the same as today. Running the copy by hand needs
  Administrator.
- **Private lists stay private.** The save log, the write-back queue and other people's user entries cannot be
  read from a screen (tested).
- **Input limits.** The server checks every field: known save types only, IDs limited to safe characters,
  notes up to 500 characters, at most 150 loads in a reorder, and a request ID that cannot be reused for a
  different save.
- **Screens.** Everything that came from a sheet or a person is escaped before it is shown, so a driver note
  cannot run code on someone's screen. The local test login (`?testEmail=`) only works on the developer's own
  machine, against the fake local sign-in.
- **Production sheets.** The write-back refuses the production Live workbook and all four master sheets in
  code, whatever the settings say (tested). The copy only ever asks Google for read-only access.
- **Deploy workflow.** It is run by hand only and has read-only repository permissions. Deploy keys are
  repository secrets that are never printed, and it deploys nothing until the projects exist.

- **Drivers' phone Check-In (`route.html`, no United Dairy account).** The same model as the current public Route
  page: the phone sends the plant's Route Distribution code with every call. The server keeps only a salted hash of
  the code, compares it in constant time and allows 30 wrong codes a minute in total (tested). A phone can read only
  the active drivers' names and the loads Dispatch gave the chosen driver for today or yesterday, and can save only a
  check-in on one of those loads (tested: another driver's load and an older load are refused). It cannot read the
  database directly; the database rules stay closed to it. A manager makes a new code on Driver Check-ins; the old
  code stops working at once. Picking another driver's name is possible for anyone holding the code, as today.
- **Master-list write-back.** Driver, Route and Equipment Master, day offs and vacations are written only to sandbox
  copies named in `WRITEBACK_JSON.masters`, each the same copy the transfer reads; every production list is refused in
  code (tested). Two passes at once cannot add the same new row twice (each claims its saves first).
- **Per-screen switch.** Only an ADMINISTRATOR can move a screen or turn the write-back on or off (`setSwitch`,
  checked on the server; tested). Every flip is logged in `actions` with before and after. A screen cannot move to the
  new app with the write-back off, the write-back cannot go off while a screen is on the new app, and the server
  refuses saves from any screen still run from the current app (tested), so a save is never kept in the new app alone.
  The copy from the sheets holds any run or master entry whose save is waiting or was written after the copy began
  reading, so it cannot undo a save (tested).
- **Maintenance queues.** Check-in problems become one record per run, day and kind in `maintenance`, written only to
  the sandbox Live workbook's TRUCK / TRAILER / FORK TRUCK / WASH / RETURNS LIVE tabs; fixing a check-in updates its
  record instead of adding another.

## Recommended before going live (not built; each needs a setting or a decision)

1. **Deploy keys without a stored password.** Today the workflow expects a service-account key file saved as
   a GitHub secret. Google's "Workload Identity Federation" lets GitHub deploy with no stored key, so there is
   nothing to leak. It takes about 15 minutes in Google Cloud when the projects are made.
2. **App Check.** This stops copies of the screens on other websites from calling the server. Sign-in is still
   required either way. It is free and can be turned on once the app has a real address.
3. **Sign-in providers.** In Firebase Authentication, turn on Google only. Leave email/password and
   anonymous sign-in off, and turn on email enumeration protection.
4. **Driver phone numbers.** The copy keeps every DRIVERS_MASTER cell, including phone and email, because
   dispatch uses them. If dispatchers do not need them in the new app, the copy can drop those columns.
5. **App Check on the phone page too.** Once the app has its real address, App Check also limits the phone calls to
   the real page.
6. **Separate server accounts.** Use one account that can only read the sheets for the copy, and a separate
   one, with edit rights on the sandbox workbook only, for the write-back.
