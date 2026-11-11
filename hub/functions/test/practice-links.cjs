'use strict';
// Joe 11-9-26: "a sandbox check that it goes to a test version like the link does."
// Opens every card the practice hub shows an administrator (made-up person) and fails when an address is missing
// (Site Not Found, an error page) or when a card opens a live app without saying so on the card.
// Run: node test/practice-links.cjs   (needs the internet; GitHub runs it after each practice deploy and on hub pull requests)
const H = require('../src/hub');

const admin = { status: 'ACTIVE', roles: ['Administrator'], name: 'Pat Admin' };
const db = { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => admin }) }) }) };
const project = process.argv[2] || 'ud-distribution-sandbox';

async function open(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
      const body = r.status < 400 ? await r.text() : '';
      return { status: r.status, missing: /Site Not Found/i.test(body) };
    } catch (e) { if (i === 2) return { status: 0, error: e.message }; }
    await new Promise(res => setTimeout(res, 3000));
  }
}

(async () => {
  const { tiles } = await H.hubCall(db, { email: 'pat.admin@uniteddairy.com' }, { op: 'home' }, { project });
  let bad = 0;
  for (const t of tiles) {
    const practice = /sandbox/.test(t.url), saysLive = /opens the live one/.test(t.note);
    const r = await open(t.url);
    const problems = [];
    if (r.error || r.status >= 400) problems.push('does not open (' + (r.error || 'HTTP ' + r.status) + ')');
    if (r.missing) problems.push('opens a Site Not Found page');
    if (!practice && !saysLive) problems.push('opens the live app without saying so');
    console.log((problems.length ? 'PROBLEM ' : 'OK      ') + t.name + ': ' + t.url + (saysLive ? ' (live, the card says so)' : '') + (problems.length ? ' - ' + problems.join('; ') : ''));
    if (problems.length) { bad++; if (process.env.GITHUB_STEP_SUMMARY) require('fs').appendFileSync(process.env.GITHUB_STEP_SUMMARY, '- ' + t.name + ': ' + problems.join('; ') + '\n'); }
  }
  if (bad) { console.error(bad + ' practice card(s) need fixing.'); process.exit(1); }
  console.log('Every practice card opens a practice copy, or says it opens the live one.');
})();
