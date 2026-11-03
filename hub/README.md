# United Dairy Hub

One place to sign in and open every United Dairy app (Joe, 11-2-26: "one app that would branch out to everything").
It lives in the same Firebase project as Operations, so the same United Dairy Google sign-in and Users list apply.
Its code is in this `hub/` folder of the Operations repository for now; it has its own site, functions group and
workflows (`deploy-hub.yml`, `hub-tests.yml`) and never deploys Operations.
The plan: https://claude.ai/artifact/2yWqo77v8KfayHEUD5svJk

## Screens (`public/`)

- **Home** (`index.html`): a tile for each app the person may use, opening it in a new tab: Operations, Customer List,
  Fuel Reporting, UDMS. Statement Center is not in the hub yet.
- **People & Access** (`people.html`, administrators): the Users list with each person's role, plants and apps; add,
  change, enable or disable a person. It calls Operations' own `admin` call (`people`, `savePerson`), so it is the same
  list and the same save as Operations' People & Roles. Single-right changes and per-plant screens stay in Operations for now.
- **Help** (`help.html`, words in `public/help.md`). Every screen change also changes its part of `help.md`.

## Server (`functions/`)

One call, `hub` (functions group `hub`, region us-east4). Each tile follows its own app's rule: Operations and the Customer
List for everyone ACTIVE on the Users list, Fuel and UDMS for administrators. Addresses come from the project it runs in,
so the practice copy links to the practice copies.

## Coming next (the plan)

1. One Administration in the hub: People & Access, managers' access, Links & Codes, keys, Email & Texts. Each app keeps
   only a read-only view or a link back.
2. The keys Operations already holds (Verizon Connect, RedZone, MOCREO, Twilio) shown and changed from the hub. The code
   that uses them is not redone.

## Deploy

**Deploy Hub** (Actions): every push to main goes to the practice copy, `ud-distribution-sandbox-hub.web.app`. The live copy,
`ud-distribution-hub.web.app`, only by Run workflow with target production, from main. Needs the repository secrets
`FIREBASE_SERVICE_ACCOUNT_SANDBOX` / `_PRODUCTION` (the same deploy keys as Operations and the Customer List).

## Tests

`cd functions && npm install && npm test && npm run test:browser`
