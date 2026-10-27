# Operations (UDPO--FIRESOURCE)

## Keep the Help guide up to date (Joe, 2026-10-26)

Every screen has a `?` in its header that opens the Help guide (`public/help.html`) on that screen's part. All of the
help words live in one file: `public/help.md` (how to edit it is at the top of that file).

**Rule: any change to what a person sees on a screen (a new screen, a renamed button, a step that moves or changes, a
new rule, anything removed) also changes that screen's part of `public/help.md`, in the same pull request.** A pull
request that changes a screen without a matching help change is not finished.

- A new page in `public/` needs a part with `screens: <page>.html`. `functions/test/unit/help.test.js` fails until it has one.
- One page that is several screens (`loadout.html?area=CASE`, `reports.html?view=rundown`) can have a part per screen:
  the `?` picks the part whose `screens:` matches the most of the address.
- A new Administration item (`public/js/admin-items.js`) needs `administration.html?item=<key>` in a part, unless it opens
  a page that already has one.
- Each part says what the screen is for, what to do (numbered steps), the buttons, a `>` tip where useful and a `!>`
  "Do not" line for the mistakes people make.
- Plain words, no codes or jargon. Use made-up names only; never a real person's name, phone or email.

The "Help guide kept up to date" check (`.github/workflows/help-guide.yml`) fails a pull request that changes a page in
`public/` or a script in `public/js/` without changing `public/help.md`. When the change really is invisible (a fix
nobody sees), add a line to the pull request description saying why: `Help unchanged: <why>`.
