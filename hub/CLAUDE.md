# United Dairy Hub (hub/ in the Operations repository)

- Everything for the hub stays inside `hub/`; its workflows are `.github/workflows/deploy-hub.yml` and `hub-tests.yml`.

- Any change to what a person sees on a screen also changes that screen's part of `public/help.md` in the same pull request.
  A new page needs a part with `screens: <page>.html` (functions/test/unit/hub.test.js checks it).
- Plain words on screens, dates like 10-8-26, United Dairy look (same as Operations and the Customer List), no pop-ups.
- Made-up names only in tests and pictures.
- Joe 11-2-26: do not redo the apps' API code. Keys and the code that uses them move as they are; the hub only shows and
  changes them. Statement Center: Joe added its card 11-7-26 (an Apps Script app; the hub only links to it).
- Practice copy first: nothing in another app is switched off until its replacement in the hub works.
