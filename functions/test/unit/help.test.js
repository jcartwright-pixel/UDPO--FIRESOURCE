'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

// Joe 10/26: "a complete help file ... anytime we make changes, we update the help." Every screen has a part in
// public/help.md (opened by the "?" in its header), and these checks fail when a screen, or an Administration item, has none.
// The rule for every change is in CLAUDE.md: a change to what a person sees changes its part of help.md in the same PR.
const PUB = path.join(__dirname, '../../../public');
const load = (rel) => import(pathToFileURL(path.join(PUB, rel)).href);
const helpFile = () => fs.readFileSync(path.join(PUB, 'help.md'), 'utf8');

test('every screen has its own part in the Help guide', async () => {
  const H = await load('js/help.js');
  const help = H.parseHelp(helpFile());
  const pages = fs.readdirSync(PUB).filter(f => f.endsWith('.html'));
  const missing = pages.filter(f => !H.sectionForPage(help, f, ''));
  assert.deepEqual(missing, [], 'these screens have no part in public/help.md (add one with "screens: <page>")');
});

test('every Administration item has help, its own part or the part of the page it opens', async () => {
  const H = await load('js/help.js');
  const { ADMIN_GROUPS } = await load('js/admin-items.js');
  const help = H.parseHelp(helpFile());
  const missing = [];
  ADMIN_GROUPS.forEach(([, , items]) => items.forEach(([key, title, , page]) => {
    const found = page ? H.sectionForPage(help, page.split('?')[0], page.split('?')[1] || '') : null;
    const own = help.sections.find(s => s.screens.indexOf('administration.html?item=' + key) >= 0);
    if (!found && !own) missing.push(key + ' (' + title + ')');
  }));
  assert.deepEqual(missing, [], 'these Administration items have no help: add "administration.html?item=<key>" to a part');
});

test('the Help guide is well formed: one id each, every screen it names exists, every link goes somewhere', async () => {
  const H = await load('js/help.js');
  const help = H.parseHelp(helpFile());
  assert.ok(help.sections.length >= 60, 'the guide covers the app');
  const ids = help.sections.map(s => s.id);
  assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), [], 'two parts share an id');
  help.sections.forEach(s => {
    assert.ok(s.body.length > 40, s.title + ' has no words');
    s.screens.forEach(e => assert.ok(fs.existsSync(path.join(PUB, e.split('?')[0])), s.title + ' names ' + e + ', which is not a page'));
    (s.body.match(/\]\(#([a-z0-9-]+)\)/g) || []).forEach(l => {
      const id = /#([a-z0-9-]+)/.exec(l)[1];
      assert.ok(ids.indexOf(id) >= 0, s.title + ' links to #' + id + ', which is not a part');
    });
  });
});

test('the "?" finds the most exact part for a screen with settings', async () => {
  const H = await load('js/help.js');
  const help = H.parseHelp(['# A', '## Loads', 'screens: loadout.html', '', 'All loads.', '## Reports', 'screens: reports.html', '', 'R.',
    '## Rundown', 'screens: reports.html?view=rundown', '', 'The rundown.'].join('\n'));
  assert.equal(H.sectionForPage(help, 'loadout.html', 'area=CASE&testEmail=x').title, 'Loads');
  assert.equal(H.sectionForPage(help, 'reports.html', 'view=rundown').title, 'Rundown');
  assert.equal(H.sectionForPage(help, 'reports.html', 'view=shifts').title, 'Reports');
  assert.equal(H.sectionForPage(help, 'nothing.html', ''), null);
});

test('the help words come out as plain, safe page text', async () => {
  const H = await load('js/help.js');
  const html = H.renderBody('### Do this\n1. Press `Save`\n- **Bold** <b>not a tag</b>\n> A tip\n!> Not this\nSee [Daily](#daily).');
  assert.ok(html.includes('<h3>Do this</h3>') && html.includes('<ol><li>Press <span class="help-key">Save</span></li></ol>'));
  assert.ok(html.includes('<b>Bold</b> &lt;b&gt;not a tag&lt;/b&gt;'), 'typed tags are shown, never run');
  assert.ok(html.includes('<p class="help-tip">A tip</p>') && html.includes('<p class="help-dont">Not this</p>'));
  assert.ok(html.includes('<a href="#daily" data-help-link="daily">Daily</a>'));
});

test('the Help guide uses made-up words only: no email addresses or phone numbers', () => {
  const text = helpFile().replace(/<!--[\s\S]*?-->/g, '');
  assert.equal(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/.test(text), false, 'an email address is in help.md');
  assert.deepEqual(text.match(/\b\d{3}-\d{3}-\d{4}\b/g) || [], ['330-555-1234'], 'only the made-up example phone number');
});
