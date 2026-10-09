# United Dairy Distribution app (new, Firebase)

The new distribution app that runs **beside** the current Apps Script app (route B in
`SPEED_REVIEW_7.0.278.md`). Nothing in this folder changes the current app, its Installer, its releases or the
Google Sheets.

## Where it stands (phase 2)

Built and tested on Google's local test database with made-up data. **Nothing is live**: there is no Firebase
project yet, so nobody can open it until the steps under "What Joe provides" are done.

| Piece | State |
|---|---|
| Database layout (Firestore) | Built |
| One-way copy from the sheets (every minute) | Built, tested with made-up sheets in the real column layout |
| Daily Dispatch screen | Built, test copy: the current columns and buttons (RUNS?, OVR, depart time, jack, Edit box, move to another day, Print, Down Trucks / Trailers, Driver Call-Off, Add Route / Run); managers drag the load order |
| Weekly Dispatch screen | Built, test copy: pick driver, truck, trailer per day, CARRIER / OPEN / NOT RUNNING, Override, legend colours, Route Run Days, Driver Assignment Board, Publish record. Reset Week (managers); Save Draft not needed (every pick saves) |
| Vacation Schedule | Built, test copy: Time Off list, Calendar with the day-off box, Eligibility by years of service, Print Year; a day off takes the driver off that day's runs |
| Route Editor | Built, test copy (managers): start times, miles, hours, load day, default truck / trailer / jack, Route Days, Load Order drag, Route Details, Recap, Add Route / Run. Ctrl+D fill-down, Shift+click block copy, block paste from Excel or Sheets |
| Equipment | Built, test copy: trucks and trailers, put down / back in service, the run each unit is on today. Fleet service and work orders stay in the current app |
| Sign-in | Built: United Dairy Google accounts only |
| Saves (driver, truck, trailer, driver note, load order) | Built, one call each; shown on screen at once, saved in the background |
| Writing saves back to a **sandbox copy** of the Live sheet | Built, off until switched on; the production sheet is refused in code |
| Sheet Conflicts screen | Built: saves the write-back did not write, with both values |
| Route Distribution home | Built: eight cards with live numbers (loads, needs driver, covered, week, drivers, check-ins, time off, units, routes, conflicts) |
| Drivers screen | Built, test copy: seniority order, vacation weeks, assigned truck, relief, available; add, edit (name, dates, truck, relief) and Remove Selected (managers) |
| Master tabs (Driver, Route, Equipment Master) | Saves stay in the new app; not written back to the sheets yet |
| Driver Check-ins screen | Built, test copy: what drivers reported per delivery day; a dispatcher can enter or fix one (same Live columns as the phone check-in). Driver phone form, plant journal and maintenance queue still on the current app |
| Writing to the production sheet, per-screen switch | Not built (only after Joe says go) |

**Why Firestore and not SQL.** Joe asked for "the SQL package". Google's SQL database (Cloud SQL) is an
always-on server: about $30 to $50 a month for us against about $10 to $20 for Firestore, and at our size it
is not faster. Firestore also tells every open screen about a change the moment it is saved, which SQL does not
do on its own. If true SQL is wanted later, the data layout here moves over table for table.

## How it works, in plain words

1. **The copy.** Every minute the server reads the three Live week tabs (previous, current, next) and Route,
   Driver, Equipment and Users Master. It has read-only permission, so it cannot change a sheet. Only rows that
   changed since the last copy are written, which keeps the bill small.
2. **Each run keeps its own ID.** A run is stored under its week and the sheet's `run_id`, never under a row
   number, so sorting or inserting rows in a Live tab cannot put a driver on the wrong run. A run listed on two
   rows (for example Sun Valley on Wednesday and on Saturday) gets the days it runs added to its ID.
3. **Nothing is lost.** Besides the fields the screens use, every non-blank cell of the row is kept word for
   word.
4. **The screens** read the copy directly and update the moment anything changes, with no 30-second checks.
   Both fit on one page, no scrolling, at 1920x950 and 1366x650, even with 32 loads in a day.
5. **Saves** are one call each. The server checks the person is allowed, checks nobody changed that run since
   their screen showed it, saves, and writes who, when, before and after to a save log. A retry after a dropped
   connection saves once. In phase 1 saves only change the new app's test copy. A test save stays until that run
   changes in the sheet; then the sheet wins.
6. **Who can save.** From USERS_MASTER: Administrator, Manager, Supervisor or Dispatcher can assign drivers,
   trucks and trailers; only Administrator and Manager can change the load order (the same rule as today).
7. **Writing back to the sheet (sandbox only for now).** When the write-back is switched on, each save also
   queues the sheet cells it changes, in the same database step, so a save can never miss its sheet update. The
   server writes them into the Live tab, finding the row by `run_id`, never by row number. A cell is written only
   if the sheet still holds what the new app last saw there; if someone typed something else in the meantime, the
   sheet value is kept and the cell goes on the **Sheet Conflicts** screen with both values, until someone marks
   it checked. While a save is waiting to be written, the minute copy leaves that run alone, so the copy cannot
   undo the save. In this phase only a sandbox copy of the Live workbook can be written: the production Live
   workbook and the master sheets are refused in code, whatever the settings say.
8. **Safety stops.** The copy stops itself if any screen has been switched to the new app (that needs the
   write-back, not built yet) or if two Live tabs claim the same week. Saves stop if the app is ever taken out of
   test mode.

### Things the copy found in the real sheets (read 2026-10-09, read only)

- The Live tabs write dates two ways (`2026-10-05` and `10/5/2026`). The copy reads both the same.
- Some rows hold a driver's name in the driver ID column (for example route 805 Tuesday: `RAMSEY KEYSHAWN`).
  The copy matches the name to the driver and lists the fix.
- The "Week Start" label at the top of LIVE CURRENT WEEK says 9/27/2026 while its rows are for the week of
  10/4/2026 (and its "Purpose" says LIVE NEXT WEEK). The copy goes by the rows and lists the difference.

## What Joe provides before anyone can open it

1. **Billing owner.** A Google Cloud billing account, best United Dairy's own, with Joe as owner. Firebase's
   "Blaze" pay-as-you-go plan; no monthly fee. Estimated $10 to $20 a month (an estimate, not a quote).
2. **Budget alert.** In Google Cloud Billing, a budget of $50 a month that emails Joe at 50%, 90% and 100%.
3. **Two Firebase projects:** a sandbox and a production one (suggested IDs `ud-distribution-sandbox` and
   `ud-distribution`).
4. **Read-only access for the copy.** Share the Live workbook (UDPO LIVE DATA - UNIONTOWN) and Route, Driver,
   Equipment and Users Master with the server's account as **Viewer**.
5. **Sign-in.** In Firebase Authentication turn on Google sign-in.
6. **Deploy key.** A deploy key per project saved in GitHub (see the deploy workflow), so the app is put live by
   a GitHub workflow like the Route relay, never by hand.
7. **For the sandbox write-back test only:** a copy of the Live workbook (File, Make a copy), shared with the
   sandbox server's account as **Editor**. The sandbox project then copies from and writes to that copy, never
   to the real one.

## For developers

```
./
  firebase.json            hosting, functions, Firestore rules/indexes, emulator ports
  firestore.rules          read: verified @uniteddairy.com accounts ACTIVE in USERS_MASTER; write: nobody (server only)
  SECURITY_REVIEW.md       sign-in, roles, rules and write-back review, in plain words
  firestore.indexes.json   keeps the big cell maps out of the indexes
  functions/
    index.js               transferEveryMinute (schedule), transferNow (admin), save (callable),
                           writeBackOnSave (each save) and writeBackEveryMinute (retry)
    src/logic.js           shared dispatch rules (dates, 6 AM roll, load-day blocks, Daily/Weekly rows)
    src/model.js           collections, Live column -> field map, run IDs
    src/transfer.js        sheet parsing and the changed-rows-only copy
    src/actions.js         one-transaction saves, revisions, idempotent request IDs, save log
    src/auth.js            United Dairy account check
    src/writeback.js       database -> sandbox Live sheet, conflict rule, production IDs refused
    src/sheets.js          Sheets API reader (read only) and writer (write-back)
    src/sources.js         Uniontown spreadsheet IDs (the same as the current app)
    test/unit, test/emulator, test/browser, test/fixtures/fake-sheets.js
  public/                  index.html (home), daily.html, weekly.html, drivers.html, checkins.html, conflicts.html, css/app.css,
                           js/app.js, js/edit.js (pickers, optimistic saves), js/logic.js (copy)
  tools/sync-logic.cjs     copies functions/src/logic.js to public/js/logic.js
```

Run the tests (Node 22 and Java 21 needed for the emulators):

```
cd functions
npm ci
npm test                  # rules and parsing
npm run test:emulator     # transfer, saves, security rules on the local database
npm run test:browser      # screens in Chromium against the local emulators
```

Settings on the sandbox server (environment variables of the functions):

- `SOURCES_JSON` points the copy at the sandbox Live workbook copy instead of the real one:
  `{"live":{"spreadsheetId":"<sandbox copy ID>"}}` (masters can stay the real ones, read only).
- `WRITEBACK_JSON` turns on writing to it: `{"spreadsheetId":"<sandbox copy ID>"}`. The write-back runs only
  when this is set **and** `config/app` has `writeBack.enabled: true` in the database.

On a workstation whose web proxy blocks the emulator's set-up of database triggers, put
`UD_LOCAL_NO_TRIGGERS=1` in `functions/.env.local` (ignored by git) before `npm run test:browser`; GitHub's test
run keeps the trigger.

After changing `functions/src/logic.js` run `npm run sync-logic`; a test fails if the screens' copy differs.

Deploy: `.github/workflows/deploy.yml`, run by hand, sandbox first. Production only after Joe's
release words for the new app.
