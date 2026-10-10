# Production: what has to exist, and who makes it

The new app's production copy is a **separate Firebase project** from the sandbox. Nothing below exists yet. Once it
does, one release step puts the app live: merge the release into `main`, then run **Deploy distribution app
(Firebase)** with target `production` and `DEPLOY PRODUCTION` typed in the confirm box.

## What production does on day one

- Reads Joe's real Uniontown sheets every minute, **read only**: the Live workbook *UDPO LIVE DATA - UNIONTOWN*
  (`11beWtlO848OyZI_Bom9y2WCZn2vnw4mLm24pf-rO1Cg`), Route, Driver, Equipment and Users Master, day offs, vacations
  (`functions/src/sources.js`, the same IDs as the current app), and the Plant Operations workbook
  (`1to7JVLHCqkIiU4uuIKP1ogjPBi_52eSS-b7TBKMBed0`).
- Writes to **no sheet**. `production-settings.json` has no write-back, `tools/production-env.cjs` stops the deploy if
  one is added, and `functions/src/writeback.js` refuses every production sheet in code. Dispatch changes are still
  made in the current app; the new app's dispatch screens show the real board and say *TEST COPY: SAVES STAY IN THE
  NEW APP*.
- Plant check screens (Quality, Temperatures, Yard, Shift Notes, Current Report) keep their own records in the new
  app's database, as on the sandbox.
- No Diagnostics: the deploy runs `tools/sandbox-diagnostics.cjs check` and stops if any of it is there.
- Report email is sent as `jcartwright@uniteddairy.com` and, until the plant managers' addresses are added
  (`REPORT_TO`, see below), only to the person who pressed Send.

Writing back to the real sheets is a later step: it needs a code change and Joe's typed sentence.

## The steps

| # | Step | Who | Where |
|---|---|---|---|
| 1 | Create the Firebase project. Suggested ID `ud-distribution` (if taken, `ud-distribution-prod`); its screens will be at `https://<ID>.web.app` | Joe or his tech | console.firebase.google.com > Add project (Google Analytics off) |
| 2 | Put it on the Blaze plan with Joe's existing billing account; add a $50 a month budget alert at 50 / 90 / 100% | Joe | Firebase > Usage and billing; Google Cloud > Billing > Budgets |
| 3 | Firestore database `(default)`, location **us-east4**, production mode | Joe's tech | Firebase > Firestore Database > Create |
| 4 | Register a Web app (any nickname, no Hosting tick) | Joe's tech | Firebase > Project settings > Your apps > Web |
| 5 | Turn on Google sign-in | Joe's tech | Firebase > Authentication > Sign-in method > Google |
| 6 | Make the deploy account `github-deploy` with only the roles in the README table (not Owner), and a JSON key | Joe's tech | Google Cloud > IAM > Service accounts |
| 7 | Give the server account two permissions the deploy account is not allowed to give: *Service Account Token Creator* on itself (report email) and *Secret Manager Secret Accessor* on the project (MOCREO). The server account is `<project number>-compute@developer.gserviceaccount.com` | Joe's tech | Google Cloud > IAM |
| 8 | In GitHub, repository `UDPO--FIRESOURCE` > Settings: secret `FIREBASE_SERVICE_ACCOUNT_PRODUCTION` = the key from step 6; variable `FIREBASE_PROJECT_PRODUCTION` = the project ID; environment `distribution-production` with Joe as required reviewer | Joe | GitHub > Settings > Secrets and variables > Actions; Environments |
| 9 | Share the 8 sheets above with the server account as **Viewer** (never Editor) | Joe | Each sheet > Share |
| 10 | Report email: in Google Workspace admin, domain-wide delegation for the production server account's Client ID (shown in the deploy summary, under Report email), scope `https://www.googleapis.com/auth/gmail.send`. The sandbox's Client ID is a different one and stays | Joe's tech (Workspace admin) | admin.google.com > Security > API controls > Domain-wide delegation |
| 11 | MOCREO: after the first deploy, paste the key and asset ID in **Administration > Connections & Keys > MOCREO & Sensors**, then Test Connection. (Or save them as Secret Manager secrets `MOCREO_API_KEY` and `MOCREO_ASSET_ID`.) Never in chat | Joe | The production app |
| 12 | Optional: plant managers' email addresses for reports, as the GitHub variable `PRODUCTION_ENV` = `REPORT_TO=a@uniteddairy.com,b@uniteddairy.com` (United Dairy addresses only) | Joe | GitHub > Settings > Variables |
| 13 | Release: merge the work into `main`, run the deploy for production, check the run's summary and the live checks | Claude, on Joe's release words | GitHub Actions |

| 14 | Last, only after Joe says in words that the new app is running the plant and types *"Turn off the old app: show the moved page, stop its timed jobs and emails, keep the sheets."*: release the old app with its off switch (united-dairy-desktop-operations PR #237), then run `udpoRetireOldApp` in its Apps Script editor. Every old page shows "This app has moved" with a link here; its timed jobs and outbound email stop; the sheets are not touched. Move the tablets and phones to this app's links | Claude (release), Joe (runs it or asks Claude) | Old app's Apps Script editor |

Steps 1 to 10 can be done any time; nothing runs until step 13. The deploy turns on the Google services it needs
(Sheets, IAM Credentials, Gmail, Secret Manager) by itself.

## The safety stops in the deploy

- Production runs only from **Run workflow**, only on `main`, and only with `DEPLOY PRODUCTION` typed; a push can
  deploy the sandbox only.
- With no production key or project name saved in GitHub, it deploys nothing and says so.
- The `distribution-production` environment waits for Joe's approval when he sets himself as its reviewer.
- `tools/production-env.cjs` refuses a write-back, the made-up sheets, any sandbox sheet copy, and email to or from
  anything but `@uniteddairy.com` (`functions/test/unit/production-env.test.js`).
- The unit and database tests run before every deploy; the live checks after it (home page, styles, a save without
  sign-in is refused, the first copy from the sheets).

## Going back

Until step 14 the current Apps Script app is never changed by any of this and keeps running. To go back, use the
current app as today. After step 14, run `udpoRestoreOldApp` in the old app's Apps Script editor: its pages open again,
its timed jobs return with their saved schedules and outbound email goes back to its earlier setting. To undo a bad production deploy of the screens: Firebase > Hosting > Release history > the previous release >
Roll back. To stop the new app reading the sheets, remove the server account's Viewer share on the sheets.
