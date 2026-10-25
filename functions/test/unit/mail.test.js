'use strict';
// Send Current Report email (src/mail.js, src/reportmail.js): the message Gmail gets, the token exchange, who it goes to,
// and the plain reason a report shows when it was not emailed. Google is never called: signer and fetch are fakes.
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../../src/mail');
const RM = require('../../src/reportmail');
const R = require('../../src/plant-rules');

const signer = { account: 'app@demo.iam.gserviceaccount.com', signed: [], async signJwt(p) { this.signed.push(p); return 'signed.jwt'; } };
function fakeFetch(answers) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    const a = answers[calls.length - 1];
    return { ok: a.status < 300, status: a.status, text: async () => JSON.stringify(a.body) };
  };
  fn.calls = calls;
  return fn;
}
const decode = raw => Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
const part = (mime, type) => Buffer.from(mime.split('Content-Type: ' + type + '; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0].replace(/\r\n/g, ''), 'base64').toString('utf8');

test('the email: text and HTML versions, UTF-8 subject, no header injection, addresses cleaned', () => {
  const mime = M.buildMime({ from: 'joe@uniteddairy.com', fromName: 'United Dairy Plant Operations', to: ['a@uniteddairy.com', 'b@uniteddairy.com'],
    subject: 'Plant Update 10/8 10:00 AM: All routes on time\r\nBcc: x@evil.com', text: 'Cooler 44°F', html: '<b>44°F</b>', boundary: 'B' });
  assert.match(mime, /^From: United Dairy Plant Operations <joe@uniteddairy\.com>\r\nTo: a@uniteddairy\.com, b@uniteddairy\.com\r\nSubject: Plant Update 10\/8 10:00 AM: All routes on time Bcc: x@evil\.com\r\n/);
  assert.equal(mime.split('\r\nBcc:').length, 1);
  assert.equal(part(mime, 'text/plain'), 'Cooler 44°F');
  assert.equal(part(mime, 'text/html'), '<b>44°F</b>');
  assert.equal(M.headerText('Café'), '=?UTF-8?B?' + Buffer.from('Café').toString('base64') + '?=');
  assert.deepEqual(M.addresses('A@UnitedDairy.com, bad, a@uniteddairy.com; c@uniteddairy.com x<y>@z.com'), ['a@uniteddairy.com', 'c@uniteddairy.com']);
});

test('sendMail: signs as the server account for the sender, gets a Gmail token, sends', async () => {
  const fetch = fakeFetch([{ status: 200, body: { access_token: 'tok' } }, { status: 200, body: { id: 'g1' } }]);
  signer.signed = [];
  const res = await M.sendMail({ from: 'joe@uniteddairy.com', to: ['joe@uniteddairy.com'], subject: 'S', text: 't', html: '<p>h</p>' }, { signer, fetch, now: 1000000 });
  assert.deepEqual(res, { id: 'g1', to: ['joe@uniteddairy.com'] });
  assert.deepEqual(signer.signed[0], { iss: 'app@demo.iam.gserviceaccount.com', sub: 'joe@uniteddairy.com', scope: M.GMAIL_SEND, aud: 'https://oauth2.googleapis.com/token', iat: 1000, exp: 4600 });
  assert.match(fetch.calls[0].opts.body, /grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=signed\.jwt/);
  assert.equal(fetch.calls[1].url, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
  assert.equal(fetch.calls[1].opts.headers.Authorization, 'Bearer tok');
  assert.match(decode(JSON.parse(fetch.calls[1].opts.body).raw), /^From: joe@uniteddairy\.com\r\nTo: joe@uniteddairy\.com\r\nSubject: S\r\n/);
});

test('sendMail: Google refusals become plain codes', async () => {
  const msg = { from: 'joe@uniteddairy.com', to: ['joe@uniteddairy.com'], subject: 'S', text: 't', html: 'h' };
  await assert.rejects(M.sendMail(msg, { signer, fetch: fakeFetch([{ status: 401, body: { error: 'unauthorized_client' } }]) }), e => e.code === 'NOT_DELEGATED');
  await assert.rejects(M.sendMail(msg, { signer, fetch: fakeFetch([{ status: 400, body: { error: 'invalid_grant' } }]) }), e => e.code === 'BAD_SENDER');
  await assert.rejects(M.sendMail(msg, { signer, fetch: fakeFetch([{ status: 200, body: { access_token: 't' } }, { status: 403, body: { error: { message: 'Gmail API has not been used' } } }]) }), e => e.code === 'GMAIL_OFF');
  await assert.rejects(M.sendMail(Object.assign({}, msg, { to: ['nope'] }), { signer, fetch: fakeFetch([]) }), e => e.code === 'NO_RECIPIENTS');
});

function fakeRef() { const ref = { updates: [], async update(x) { ref.updates.push(x); } }; return ref; }
const REPORT = { status: 'SENDING', subject: 'Plant Update 10/8 10:00 AM: All routes on time', text: 'ROUTES BEHIND (0)', note: 'Short staffed', by: 'pat@uniteddairy.com', mode: 'test',
  reportJson: JSON.stringify({ dayLabel: 'Thursday 10/8', behind: [], loaded: [{ route: '<501>', loadSequence: 1 }], nextUp: [], totalLoads: '4"><script>', leftToLoad: 3, pickups: [], down: [], lines: [], temperatures: [] }) };

test('report email: test mode and live without the group go only to the person who pressed Send; live with the group goes to it', async () => {
  assert.deepEqual(RM.recipients(REPORT, { REPORT_TO: 'mgr@uniteddairy.com' }), { to: ['pat@uniteddairy.com'], copy: true });
  assert.deepEqual(RM.recipients(Object.assign({}, REPORT, { mode: 'live' }), {}), { to: ['pat@uniteddairy.com'], copy: true });
  assert.deepEqual(RM.recipients(Object.assign({}, REPORT, { mode: 'live' }), { REPORT_TO: 'mgr@uniteddairy.com, gm@uniteddairy.com' }), { to: ['mgr@uniteddairy.com', 'gm@uniteddairy.com'], copy: false });
});

test('report email: SENT with who it went to; the HTML is the current app layout, escaped', async () => {
  const ref = fakeRef(); let sent = null;
  const status = await RM.mailReport(ref, REPORT, { env: { MAIL_FROM: 'joe@uniteddairy.com' }, sendMail: async (m) => { sent = m; return { id: 'g1', to: m.to }; } });
  assert.equal(status, 'SENT');
  assert.deepEqual([sent.from, sent.to, sent.subject, sent.text], ['joe@uniteddairy.com', ['pat@uniteddairy.com'], REPORT.subject, REPORT.text]);
  assert.match(sent.html, /ALL ROUTES ON TIME[\s\S]*Thursday 10\/8 &middot; -3 of 0 loaded/);
  assert.match(sent.html, /Short staffed[\s\S]*&lt;501&gt;/);
  assert.doesNotMatch(sent.html, /<script>|<501>/);
  assert.equal(ref.updates[0].status, 'SENT');
  assert.deepEqual([ref.updates[0].emailed, ref.updates[0].sentTo, ref.updates[0].testCopy], [true, ['pat@uniteddairy.com'], true]);
});

test('report email: HELD without a sender; FAILED with a plain reason; nothing done twice', async () => {
  const held = fakeRef();
  assert.equal(await RM.mailReport(held, REPORT, { env: {} }), 'HELD');
  assert.deepEqual(held.updates[0], { status: 'HELD', emailed: false, reason: 'Email is not set up in Operations yet.' });
  const failed = fakeRef();
  const err = new M.MailError('NOT_DELEGATED', 'x');
  assert.equal(await RM.mailReport(failed, REPORT, { env: { MAIL_FROM: 'joe@uniteddairy.com' }, sendMail: async () => { throw err; } }), 'FAILED');
  assert.equal(failed.updates[0].reason, RM.REASON.NOT_DELEGATED);
  const again = fakeRef();
  assert.equal(await RM.mailReport(again, Object.assign({}, REPORT, { status: 'SENT' }), { env: { MAIL_FROM: 'joe@uniteddairy.com' } }), null);
  assert.equal(again.updates.length, 0);
});

test('report email: the HTML of a real report matches the screen numbers', () => {
  const html = R.reportHtml({ dayLabel: 'Thursday 10/8', behind: [{ route: '801', run: 'UT DSD MILK', depart: '1:00 PM' }], loaded: [{ route: '802', run: 'UT WALMART', loadSequence: 2, doneAt: '3:42 PM', depart: '5:00 AM' }], nextUp: [{ route: '6304_1', run: 'LANCASTER' }], totalLoads: 4, leftToLoad: 3,
    pickups: [{ route: '503', run: 'MASSILLON', quantity: '3 cases', product: 'Chocolate milk' }], down: [], lines: [], temperatures: [{ location: 'Cooler North', reading: 44, status: 'HIGH', flag: true }] }, '');
  assert.match(html, /1 ROUTE BEHIND<\/div><div style="font-size:14px;margin-top:3px">Thursday 10\/8 &middot; 1 of 4 loaded/);
  // Joe 10/16: each route is one row: route number, the run's short name, Done time and Dispatch time; only BEHIND has a word.
  const row = (...cells) => new RegExp(cells.map(c => '>' + c + '</td>').join('[^<]*<td[^>]*'));
  assert.match(html, /Route<\/td>.*Run<\/td>.*Done<\/td>.*Dispatch<\/td>/);
  assert.match(html, row('802', 'Walmart', '3:42 PM', '5:00 AM'));
  assert.match(html, /801<\/td>[^]*?>DSD<\/td>[^]*?BEHIND[^]*?>1:00 PM<\/td>/);
  assert.match(html, row('6304', 'Lancaster', '–', '–'));
  assert.doesNotMatch(html, /NOT LOADED|>LOADED</);
  assert.match(html, /PICKUP 503 MASSILLON<\/b> 3 cases Chocolate milk/);
  assert.match(html, /Cooler North[\s\S]*44&deg;F [\s\S]*HIGH/);
});

test('report email: routes split by delivery day, loaded in finish order, a blank run uses the route name (Joe 10/17)', () => {
  const now = Date.parse('2026-10-17T22:00:00Z'); // Saturday 6 PM at the plant
  const L = (route, run, routeName, state, disp, deliv, seq, done) => ({ route, run, routeName, area: 'CASE', state, dispatchTime: disp, loadDate: '2026-10-17', deliveryDate: deliv, departureDate: deliv, loadSequence: seq, completedAt: done || '', truck: '', trailer: '' });
  const r = R.plantReport({ loads: [
    L('827', 'UT WALMART', '', 'DONE', '02:00', '2026-10-18', 1, '2026-10-17T16:00:00Z'),
    L('836', 'UT PECK', '', 'DONE', '03:00', '2026-10-18', 2, '2026-10-17T14:00:00Z'),
    L('852_2', 'UT JERSEY LOAD 2', '', 'WAITING', '13:00', '2026-10-19', 3),
    L('844', '', 'UT ZANESVILLE DSD', 'WAITING', '18:00', '2026-10-18', 4)], pickups: [], shiftLog: [], lines: [], temps: [], roundStart: '' }, now);
  assert.equal(r.behind.length, 0, 'Jersey leaves Monday, so it is not late on Saturday');
  const html = R.reportHtml(r, '');
  assert.match(html, /Delivers Sunday 10-18-26[\s\S]*>836<[\s\S]*>827<[\s\S]*Delivers Sunday 10-18-26[\s\S]*>844<\/td>[^]*?>Zanesville<\/td>[\s\S]*Delivers Monday 10-19-26[\s\S]*>852</);
  const one = R.reportHtml(R.plantReport({ loads: [L('827', 'UT WALMART', '', 'DONE', '02:00', '2026-10-18', 1, '2026-10-17T16:00:00Z')], pickups: [], shiftLog: [], lines: [], temps: [], roundStart: '' }, now), '');
  assert.doesNotMatch(one, /Delivers/, 'no separator when every load delivers the same day');
});

// Joe 10/20 (3:09 PM report): "it should be sorted by our load order", so moving a load on Daily Case Loadout moves it in the email.
test('report email: not loaded routes follow the load order, not dispatch time, with a behind load where the plant has it', () => {
  const now = Date.parse('2026-10-20T19:09:00Z'); // Tuesday 3:09 PM at the plant
  const L = (route, run, disp, seq) => ({ id: 'r' + route, route, run, routeName: '', area: 'CASE', state: 'WAITING', dispatchTime: disp, loadDate: '2026-10-20', deliveryDate: '2026-10-21', departureDate: '2026-10-21', loadSequence: seq, completedAt: '', truck: '', trailer: '' });
  const loads = [L('854', 'CREAMOLAND', '02:00', 1), L('852_2', 'UT JERSEY LOAD 2', '13:00', 2), L('6303', 'UT WALMART', '01:00', 3), L('824', 'UT DSD MILK', '01:00', 4)];
  loads[1].loadDate = '2026-10-20'; loads[1].deliveryDate = '2026-10-21'; loads[1].departureDate = '2026-10-20';
  const r = R.plantReport({ loads, pickups: [], shiftLog: [], lines: [], temps: [], roundStart: '' }, now);
  const f = R.loadForecast({ date: '2026-10-20', loads, history: [] }, now);
  const html = R.reportHtml(Object.assign({}, r, { forecast: f }), '');
  const order = [...html.matchAll(/font-size:16px;font-weight:800;color:[^"]*">(\d+)<\/td>/g)].map(m => m[1]);
  assert.deepEqual(order, ['854', '852', '6303', '824'], 'Creamoland is loaded first because the plant put it first, though 6303 and 824 leave earlier');
  const est = [...html.matchAll(/>(\d{1,2}:\d\d [AP]M)(?: &#9888;)?<\/span>/g)].map(m => m[1]);
  assert.equal(est.length, 3, 'every load not behind shows its Est. Done');
  const mins = t => { const [h, m] = t.split(/[: ]/); return (Number(h) % 12 + (/PM/.test(t) ? 12 : 0)) * 60 + Number(m); };
  const run = est.map(mins).map(m => m < 15 * 60 ? m + 1440 : m);
  assert.deepEqual(run, run.slice().sort((a, b) => a - b), 'Est. Done runs in order down the list');
});

test('report email: loads grouped by type, Case then Box, Tote, Tanker, each with Loaded then Not loaded (Joe 10/19)', () => {
  const now = Date.parse('2026-10-19T14:00:00Z');
  const L = (route, run, area, state, disp, done) => ({ route, run, routeName: '', area, state, dispatchTime: disp, loadDate: '2026-10-19', deliveryDate: '2026-10-19', departureDate: '2026-10-19', loadSequence: 1, completedAt: done || '', truck: '', trailer: '' });
  const r = R.plantReport({ loads: [
    L('950', 'UT RAW TANKER', 'TANKER', 'DONE', '06:30', '2026-10-19T10:30:00Z'),
    L('912', 'UT KTI TOTES', 'TOTES', 'DONE', '06:00', '2026-10-19T10:10:00Z'),
    L('6301_1', 'UT CHARLESTON LOAD 1', 'BOXING', 'DONE', '05:00', '2026-10-19T09:05:00Z'),
    L('827', 'UT WALMART', 'CASE', 'DONE', '05:30', '2026-10-19T09:40:00Z'),
    L('801', 'UT DSD MILK', 'CASE', 'DONE', '04:00', '2026-10-19T08:30:00Z'),
    L('951', 'UT SKIM TANKER', 'TANKER', 'WAITING', '12:00'),
    L('845', 'UT DSD', 'CASE', 'WAITING', '14:00')], pickups: [], shiftLog: [], lines: [], temps: [], roundStart: '' }, now);
  const html = R.reportHtml(r, '');
  assert.match(html, /Case \(3\)[\s\S]*Loaded \(2\)[\s\S]*>801<[\s\S]*>827<[\s\S]*Not loaded \(1\)[\s\S]*>845<[\s\S]*Box \(1\)[\s\S]*Loaded \(1\)[\s\S]*>6301<[\s\S]*Tote \(1\)[\s\S]*Loaded \(1\)[\s\S]*>912<[\s\S]*Tanker \(2\)[\s\S]*Loaded \(1\)[\s\S]*>950<[\s\S]*Not loaded \(1\)[\s\S]*>951</,
    'Case, Box, Tote, Tanker; Loaded then Not loaded inside each; finish order kept');
  assert.equal((html.match(/"height:3px/g) || []).length, 3, 'a line between each of the four types');
  const box = html.slice(html.indexOf('Box (1)'), html.indexOf('Tote (1)'));
  assert.doesNotMatch(box, /Not loaded/, 'a list with no loads is left out');
});

// Joe 10/25 ("Gmail report is not showing the boxing loading"): Scheduler box loads are on Daily Box Loadout, so they are in the email too.
test('report email: Scheduler box loads are listed under Box, with their pickup time on their load day', () => {
  const now = Date.parse('2026-10-24T14:00:00Z'); // Saturday 10 AM at the plant
  const live = [{ id: 'r827', route: '827', run: 'UT WALMART', routeName: '', area: 'CASE', state: 'WAITING', dispatchTime: '17:00', loadDate: '2026-10-24', deliveryDate: '2026-10-25', departureDate: '2026-10-25', loadSequence: 1, completedAt: '', truck: '', trailer: '' }];
  const todays = [
    { id: 'S1', date: '2026-10-25', loadDate: '2026-10-24', route: '950', run: 'ALDI - CHARLESTON', loadNo: 1, pickupTime: '08:00', loadType: 'BOXING', trailer: '', work: { state: 'COMPLETE', completedAt: '2026-10-24T12:30:00Z' } },
    { id: 'S2', date: '2026-10-25', loadDate: '2026-10-24', route: '950', run: 'ALDI - CHARLESTON', loadNo: 2, pickupTime: '13:00', loadType: 'BOXING', trailer: '', work: {} }];
  const loads = R.reportLoads(live, todays, []);
  assert.equal(loads.length, 3, 'the case load and both Scheduler box loads');
  const r = R.plantReport({ loads, pickups: [], shiftLog: [], lines: [], temps: [], roundStart: '' }, now);
  assert.equal(r.totalLoads, 3);
  assert.deepEqual(r.areas.map(a => a.area), ['CASE', 'BOXING']);
  assert.equal(r.behind.length, 0, 'Load 2 picks up at 1:00 PM, so it is not behind at 10 AM');
  const html = R.reportHtml(r, '');
  assert.match(html, /Case \(1\)[\s\S]*>827<[\s\S]*Box \(2\)[\s\S]*Loaded \(1\)[\s\S]*>950<[\s\S]*Not loaded \(1\)[\s\S]*>950<[\s\S]*1:00 PM/, 'both box loads under Box, Load 2 with its 1:00 PM pickup');
});

// Joe 10/25: "for the boxes… it has to include like the Charleston, Aldi's, and the Saxonburg Aldi's".
test('report email: ALDI Charleston and Fairmont-Saxonburg box loads are under Box, whether on the dispatch week or only on the Scheduler', () => {
  const now = Date.parse('2026-10-24T14:00:00Z');
  const B = (id, route, run, state) => ({ id, runId: route, route, run, routeName: run, area: 'BOXING', state, dispatchTime: '20:00', loadDate: '2026-10-24', deliveryDate: '2026-10-25', departureDate: '2026-10-25', loadSequence: 1, completedAt: state === 'DONE' ? '2026-10-24T13:00:00Z' : '', truck: '', trailer: '' });
  // 950_2 is running on the week (a dispatch load); the Scheduler's Load 2 for it goes on that line, once.
  const live = [B('r950_2', '950_2', 'ALDI - CHARLESTON LOAD 2', 'DONE')];
  const S = (id, runId, route, run, n) => ({ id, runId, date: '2026-10-25', loadDate: '2026-10-24', route, run, loadNo: n, pickupTime: '16:00', loadType: 'BOXING', trailer: '', work: {} });
  const todays = [S('S2', '950_2', '950_2', 'ALDI - CHARLESTON LOAD 2', 2), S('S3', '950_3', '950_3', 'ALDI - CHARLESTON LOAD 3', 3),
    S('S4', '907_2', '907_2', 'ALDI - FAIRMONT-SAXONBURG LOAD 1', 1), S('S5', '907_3', '907_3', 'ALDI - FAIRMONT-SAXONBURG LOAD 2', 2)];
  const loads = R.reportLoads(live, todays, []);
  assert.equal(loads.length, 4, 'Charleston Load 2 once (dispatch line), Charleston Load 3, and both Saxonburg loads');
  const r = R.plantReport({ loads, pickups: [], shiftLog: [], lines: [], temps: [], roundStart: '' }, now);
  assert.deepEqual(r.areas, [{ area: 'BOXING', left: 3, total: 4 }]);
  const html = R.reportHtml(r, '');
  const box = html.slice(html.indexOf('Box (4)'));
  assert.ok(html.includes('Box (4)'), 'the Box section has all four');
  assert.match(box, /Loaded \(1\)[\s\S]*>950<[\s\S]*Not loaded \(3\)/);
  assert.equal((box.match(/>950</g) || []).length, 2, 'two Charleston loads');
  assert.equal((box.match(/>907</g) || []).length, 2, 'two Saxonburg loads');
});
