// Customers (United Dairy Customer List, Joe 11/1): every customer by customer, by route or by day, with the boxes to find,
// filter and sort, a customer's own card (address, phone, keys or door code, notes) and the Print menu. An Administrator imports the
// Route Menu workbook here (and the Route Book with it), or brings over the Sales app's list.
import { requireSignIn, escapeHtml as e, showError, serverText, shortDate } from './app.js';
import { readList, saveStep, printMenu, printDoc, tablePage, routeDayPage, sortedRouteDays, routesOf, U } from './udcl.js';

const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const loadXlsx = () => window.XLSX ? Promise.resolve(window.XLSX) : new Promise((ok, bad) => { const el = document.createElement('script'); el.src = XLSX_URL; el.onload = () => ok(window.XLSX); el.onerror = () => bad(new Error('Could not load the Excel reader. Check the network and try again.')); document.head.appendChild(el); });

const params = new URLSearchParams(location.search);
let data = null, view = ['customer', 'route', 'day'].indexOf(params.get('view')) >= 0 ? params.get('view') : 'customer';
let allLines = [];
const $ = (id) => document.getElementById(id);
const f = () => ({ q: $('q').value, route: $('route').value, day: $('day').value, chain: $('chain').value, sort: $('sort').value || view });
const dayName = (d) => U.DAY_NAMES[d] || d;

function fillPickers() {
  const keep = (id, opts, all) => { const box = $(id), was = box.value; box.innerHTML = '<option value="">' + all + '</option>' + opts.map(([v, t]) => '<option value="' + e(v) + '">' + e(t) + '</option>').join(''); box.value = opts.some(o => o[0] === was) ? was : ''; };
  keep('route', routesOf(data.routeDays).map(r => [r, 'Route ' + r]), 'All routes');
  keep('day', U.DAYS.map(d => [d, dayName(d)]), 'All days');
  const chains = [...new Set(Object.values(data.customers).map(c => c.chain).filter(Boolean))].sort(U.byRoute);
  keep('chain', chains.map(c => [c, 'Chain ' + c]), 'All chains');
  if (params.get('route') && !$('route').value) $('route').value = params.get('route');
}

/** The customers picked by the boxes, one row each (a customer with no delivery shows only when no route or day is picked). */
function customersShown() {
  const fl = f(), lines = U.pick(allLines, Object.assign({}, fl, { sort: 'customer' }));
  const keys = new Set(lines.map(l => l.key));
  const words = U.text(fl.q).toUpperCase().split(' ').filter(Boolean);
  const rows = U.customerRows(data.customers, allLines).filter(c => keys.has(c.key) || (!fl.route && !fl.day && (!fl.chain || c.chain === fl.chain) && !(c.deliveries || []).length &&
    words.every(w => [c.name, c.account, c.city, c.chain, c.address, U.dcName(c.dc)].join(' ').toUpperCase().indexOf(w) >= 0)));
  const s = fl.sort === 'customer' || !U.SORTS[fl.sort] ? null : fl.sort;
  if (s === 'account') rows.sort((a, b) => U.byRoute(a.account, b.account));
  else if (s === 'city') rows.sort((a, b) => String(a.city).localeCompare(String(b.city)) || a.name.localeCompare(b.name));
  else if (s === 'chain') rows.sort((a, b) => U.byRoute(a.chain || 'zz', b.chain || 'zz') || a.name.localeCompare(b.name));
  else if (s === 'route' || s === 'day') rows.sort((a, b) => { const x = (a.deliveries || [])[0] || {}, y = (b.deliveries || [])[0] || {}; return s === 'route' ? U.byRoute(x.route || 'zz', y.route || 'zz') || U.dayIndex(x.day) - U.dayIndex(y.day) : U.dayIndex(x.day) - U.dayIndex(y.day) || U.byRoute(x.route || 'zz', y.route || 'zz'); });
  return rows;
}
const deliveriesText = (c) => (c.deliveries || []).map(d => d.day + ' ' + d.route + ' #' + d.stop).join(', ');

function draw() {
  document.querySelectorAll('#views button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === view)));
  if (!data) return;
  const fl = f();
  if (view === 'customer') {
    const rows = customersShown();
    $('thead').innerHTML = '<tr><th style="width:9%">Account</th><th class="l" style="width:24%">Customer</th><th style="width:7%">Chain</th><th style="width:9%">DC</th><th class="l" style="width:20%">Address</th><th style="width:12%">Days</th><th class="l">Route, day and stop</th></tr>';
    $('rows').innerHTML = rows.map(c => '<tr class="pick' + (c.active === false ? ' inactive' : '') + '" data-key="' + e(c.key) + '"><td>' + e(c.account) + '</td><td class="l"><b>' + e(c.name) + '</b></td><td>' + e(c.chain) + '</td><td>' + e(U.dcName(c.dc)) + '</td>' +
      '<td class="l" title="' + e(U.addressLine(c)) + '">' + (U.addressLine(c) ? e(U.addressLine(c)) : '<span class="warnline">No address yet</span>') + '</td><td class="days">' + e(U.dayLetters(c.days || [])) + '</td><td class="l">' + e(deliveriesText(c)) + '</td></tr>').join('') ||
      '<tr><td colspan="7" class="empty">' + (Object.keys(data.customers).length ? 'No customer matches these boxes.' : emptyText()) + '</td></tr>';
    $('count').textContent = rows.length + ' customer' + (rows.length === 1 ? '' : 's');
  } else {
    const lines = U.pick(allLines, fl);
    const grp = (l) => view === 'route' && (!$('sort').value || $('sort').value === 'route') ? 'Route ' + l.route + ' · ' + dayName(l.day) : view === 'day' && (!$('sort').value || $('sort').value === 'day') ? dayName(l.day) + ' · Route ' + l.route : '';
    $('thead').innerHTML = '<tr><th style="width:8%">Day</th><th style="width:7%">Route</th><th style="width:6%">Stop</th><th style="width:6%">Load</th><th style="width:9%">Account</th><th class="l" style="width:24%">Customer</th><th class="l" style="width:16%">City</th><th class="l">Stop note</th></tr>';
    let last = null;
    $('rows').innerHTML = lines.map(l => {
      const g = grp(l), head = g && g !== last ? '<tr class="group"><td colspan="8" class="l">' + e(g) + ' &nbsp; <a href="route-sequence.html?route=' + encodeURIComponent(l.route) + '&day=' + l.day + '">Open in Route Sequence &rarr;</a></td></tr>' : '';
      last = g;
      return head + '<tr class="pick" data-key="' + e(l.key) + '"><td>' + e(dayName(l.day).slice(0, 3)) + '</td><td>' + e(l.route) + '</td><td><span class="stopno">' + l.stop + '</span></td><td>' + (l.loadSeq || '<span class="warnline">-</span>') + '</td><td>' + e(l.account) + '</td><td class="l"><b>' + e(l.name) + '</b></td><td class="l">' + e(l.city) + '</td><td class="l">' + e(l.note) + '</td></tr>';
    }).join('') || '<tr><td colspan="8" class="empty">' + (allLines.length ? 'No delivery matches these boxes.' : emptyText()) + '</td></tr>';
    $('count').textContent = lines.length + ' deliver' + (lines.length === 1 ? 'y' : 'ies');
  }
  const im = data.imported;
  $('imported').textContent = im ? 'Imported from ' + (im.fileName || 'the Route Menu') + ' on ' + shortDate(im.at) + ' by ' + im.by + ' · ' + (im.counts.customers || 0) + ' customers, ' + (im.counts.routeDays || 0) + ' route days' +
    (im.counts.noLoadSeq ? ' · ' + im.counts.noLoadSeq + ' stops have no load sequence yet' : '') : '';
}
const emptyText = () => data.canImport ? 'The customer list is empty. Press Import Route Menu to bring in the Uniontown Route Menu workbook.' : 'The customer list is empty. An administrator imports it from the Route Menu workbook.';

/* ---------- a customer's card ---------- */
function panel(title, body) {
  closePanel();
  const p = document.createElement('aside');
  p.className = 'udcl-panel'; p.id = 'panel';
  p.innerHTML = '<header><h2>' + e(title) + '</h2><button type="button" id="p-close">Close</button></header><div class="body">' + body + '</div>';
  document.body.appendChild(p);
  $('p-close').onclick = closePanel;
  window.udBack = () => { if ($('panel')) { closePanel(); return true; } return false; };
  return p;
}
function closePanel() { const p = $('panel'); if (p) p.remove(); window.udBack = null; }

function openCustomer(key) {
  const c = key ? data.customers[key] : null, add = !c, ro = !data.canEdit;
  const v = (k) => e(c && c[k] !== undefined && c[k] !== null ? c[k] : '');
  const dis = ro ? ' disabled' : '';
  const ds = c ? U.customerRows({ [key]: c }, allLines)[0].deliveries : [];
  const p = panel(add ? 'Add a customer' : c.name, (add ? '<label>Account number<input id="c-account" inputmode="numeric" placeholder="Leave blank if it has none"></label>' : '<div class="deliveries">Account ' + v('account') + (c.active === false ? ' · <b>Not on the Route Menu any more</b>' : '') + '<br>' + (ds.length ? ds.map(d => '<a href="route-sequence.html?route=' + encodeURIComponent(d.route) + '&day=' + d.day + '">' + e(dayName(d.day)) + ' route ' + e(d.route) + ', stop ' + d.stop + '</a>').join('<br>') : 'Not on any route day') + '</div>') +
    '<label>Name<input id="c-name" value="' + v('name') + '"' + dis + '></label>' +
    '<div class="two"><label>Chain<input id="c-chain" value="' + v('chain') + '"' + dis + '></label><label>Phone<input id="c-phone" value="' + v('phone') + '"' + dis + '></label></div>' +
    '<label>Distribution center<select id="c-dc"' + dis + '><option value="">Not set</option>' + U.DCS.map(d => '<option value="' + d.code + '"' + ((c ? U.dcOf(c.dc) : (U.PLANT_DC[data.plant] || '')) === d.code ? ' selected' : '') + '>' + d.code + ' ' + e(d.name) + '</option>').join('') + '</select></label>' +
    '<label>Street<input id="c-address" value="' + v('address') + '"' + dis + '></label><label>Street, line 2<input id="c-address2" value="' + v('address2') + '"' + dis + '></label>' +
    '<div class="three"><label>City<input id="c-city" value="' + v('city') + '"' + dis + '></label><label>State<input id="c-state" value="' + v('state') + '" maxlength="4"' + dis + '></label><label>Zip<input id="c-zip" value="' + v('zip') + '"' + dis + '></label></div>' +
    '<label>Contact<input id="c-contact" value="' + v('contact') + '"' + dis + '></label>' +
    '<label>Keys or door code<input id="c-keys" value="' + v('keys') + '"' + dis + '></label>' +
    '<label>Notes for the driver (shows on the route book at every stop for this customer)<textarea id="c-notes"' + dis + '>' + v('notes') + '</textarea></label>' +
    (add ? '<button type="button" class="primary" id="c-save">Add customer</button>' : '') + '<div id="c-msg"></div>');
  const fields = () => { const o = {}; U.CUSTOMER_FIELDS.forEach(k => { const el = $('c-' + k); if (el) o[k] = el.value; }); return o; };
  const say = (t, cls) => { $('c-msg').innerHTML = t ? '<div class="msg ' + (cls || '') + '">' + e(t) + '</div>' : ''; };
  if (ro) return;
  if (add) {
    $('c-save').onclick = async () => {
      try { const out = await saveStep('saveCustomer', { add: true, account: $('c-account').value, fields: fields() }); data.customers[out.customer.key] = out.customer; rebuild(); openCustomer(out.customer.key); }
      catch (err) { say(serverText(err, 'the customer list'), 'bad'); }
    };
    return;
  }
  // Every box saves when it is left (as everywhere in Operations).
  p.querySelectorAll('input, textarea, select').forEach(el => el.addEventListener('change', async () => {
    try { const out = await saveStep('saveCustomer', { key, fields: { [el.id.slice(2)]: el.value } }); data.customers[key] = out.customer; rebuild(); say('Saved.', 'good'); }
    catch (err) { say(serverText(err, 'the customer list'), 'bad'); }
  }));
}

/* ---------- import ---------- */
function sheetRows(X, wb, name) { const ws = wb.Sheets[name]; return ws ? X.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) : null; }
function findSheet(wb, want) { return wb.SheetNames.find(n => n.trim().toLowerCase() === want.toLowerCase()); }

function openImport() {
  panel('Import the customer list', '<p>Pick the <b>Route Menu</b> workbook (it decides every customer, route, day and load sequence). Pick the <b>Route Book</b> too if you have it: it only fills in start times, run order, keys and instructions that are still blank, where they still fit.</p>' +
    '<label>Route Menu workbook (.xlsb, .xlsx)<input type="file" id="i-menu" accept=".xlsx,.xlsb,.xls,.xlsm"></label>' +
    '<label>Route Book workbook (optional)<input type="file" id="i-book" accept=".xlsx,.xlsb,.xls,.xlsm"></label>' +
    '<button type="button" class="primary" id="i-go">Read and import</button><div id="i-msg"></div><hr>' +
    '<p>No workbook at hand? Bring over the list already uploaded for the Sales app (no load sequence or addresses).</p><button type="button" id="i-sales">Bring over the Sales app list</button>' +
    '<p class="deliveries">An import keeps what was typed here: run order, start times, instructions, load maps, addresses, phones, keys and notes. A route day no longer in the Route Menu is removed.</p>');
  const say = (t, cls) => { $('i-msg').innerHTML = t ? '<div class="msg ' + (cls || '') + '">' + e(t) + '</div>' : ''; };
  $('i-go').onclick = async () => {
    const mf = $('i-menu').files[0], bf = $('i-book').files[0];
    if (!mf) return say('Pick the Route Menu workbook first.', 'bad');
    try {
      say('Reading ' + mf.name + '…');
      const X = await loadXlsx(), wb = X.read(await mf.arrayBuffer(), { type: 'array' });
      const tab = findSheet(wb, 'Customer By Route');
      const menu = tab ? U.menuStops(sheetRows(X, wb, tab)) : null;
      if (!menu || !menu.stops.length) return say('No "Customer By Route" tab with Day, Route and Name headings was found in ' + mf.name + '.', 'bad');
      const accounts = new Set(menu.stops.concat(menu.unrouted).map(s => s.account).filter(Boolean)), names = new Set(menu.stops.concat(menu.unrouted).map(s => U.nameKey(s.name)));
      const at = findSheet(wb, 'Address List'), gt = findSheet(wb, 'GPS Address');
      const allAddr = at ? U.addressList(sheetRows(X, wb, at)) : {}, allGps = gt ? U.gpsAddresses(sheetRows(X, wb, gt)) : {};
      const addresses = {}, gps = {};
      accounts.forEach(a => { if (allAddr[a]) addresses[a] = allAddr[a]; });
      names.forEach(n => { if (allGps[n]) gps[n] = allGps[n]; });
      let book = {};
      if (bf) { say('Reading ' + bf.name + '…'); const bw = X.read(await bf.arrayBuffer(), { type: 'array' }); const sheets = {}; bw.SheetNames.forEach(n => { sheets[n] = sheetRows(X, bw, n); }); book = U.routeBook(sheets); }
      say('Saving ' + menu.stops.length + ' delivery lines…');
      const out = await saveStep('importMenu', { stops: menu.stops, unrouted: menu.unrouted, addresses, gps, book, fileName: mf.name + (bf ? ' + ' + bf.name : ''), thenView: true });
      setData(out);
      const c = out.counts;
      say(out.message + ' ' + c.added + ' new customers, ' + c.filled + ' had their address or keys filled in, ' + c.inactive + ' no longer on the Route Menu, ' + c.removedDays + ' route days removed.' + (c.noLoadSeq ? ' ' + c.noLoadSeq + ' stops have no load sequence in the Route Menu: give them one on Route Sequence.' : ''), 'good');
    } catch (err) { say(serverText(err, 'the customer list'), 'bad'); }
  };
  $('i-sales').onclick = async () => {
    try { const out = await saveStep('copySales', { thenView: true }); setData(out); say(out.message, 'good'); } catch (err) { say(serverText(err, 'the customer list'), 'bad'); }
  };
}

/* ---------- print ---------- */
function printItems() {
  if (!data) return [];
  const fl = f(), pn = data.plantName, filt = [fl.route && 'route ' + fl.route, fl.day && dayName(fl.day), fl.chain && 'chain ' + fl.chain, fl.q && '"' + fl.q + '"'].filter(Boolean).join(', ');
  const lineCols = [['Day', l => dayName(l.day).slice(0, 3), 1], ['Route', l => l.route, 1], ['Stop', l => l.stop, 1], ['Load', l => l.loadSeq || '', 1], ['Account', l => l.account], ['Customer', l => l.name], ['Address', l => U.addressLine(l)], ['Note', l => l.note]];
  const rds = sortedRouteDays(data.routeDays).filter(rd => (!fl.route || rd.route === fl.route) && (!fl.day || rd.day === fl.day));
  return [
    { label: 'This list, as shown', note: (filt ? 'Only ' + filt : 'Everything') + ', in this order', html: () => view === 'customer'
      ? printDoc('Customers', [tablePage('Customers · ' + pn, filt || 'All customers', customersShown(), [['Account', c => c.account], ['Customer', c => c.name], ['Chain', c => c.chain, 1], ['DC', c => U.dcName(c.dc), 1], ['Address', c => U.addressLine(c)], ['Phone', c => c.phone], ['Days', c => U.dayLetters(c.days || []), 1], ['Route, day and stop', c => deliveriesText(c)]])])
      : printDoc('Deliveries', [tablePage('Deliveries · ' + pn, filt || 'All deliveries', U.pick(allLines, fl), lineCols, view === 'route' ? (l => 'Route ' + l.route + ' · ' + dayName(l.day)) : (l => dayName(l.day) + ' · Route ' + l.route))]) },
    { label: 'Route sequence sheets for the office', note: rds.length + ' route day' + (rds.length === 1 ? '' : 's') + (filt ? ' (' + filt + ')' : '') + ', one page each', html: () => printDoc('Route sequence', rds.map(rd => routeDayPage(rd, data.customers, 'office', pn))) },
    { label: 'Driver route book pages', note: rds.length + ' route day' + (rds.length === 1 ? '' : 's') + ', with keys, time in / out and the load map', html: () => printDoc('Route book', rds.map(rd => routeDayPage(rd, data.customers, 'driver', pn))) },
    { label: 'Customer list by route', note: 'Every route, its days and customers', html: () => printDoc('Customers by route', [tablePage('Customers by route · ' + pn, 'Route, day, stop', U.pick(allLines, Object.assign({}, fl, { sort: 'route' })), lineCols, l => 'Route ' + l.route + ' · ' + dayName(l.day))]) },
    { label: 'Customer list by day', note: 'Every day, its routes and customers', html: () => printDoc('Customers by day', [tablePage('Customers by day · ' + pn, 'Day, route, stop', U.pick(allLines, Object.assign({}, fl, { sort: 'day' })), lineCols, l => dayName(l.day))]) },
    { label: 'Customer addresses and phones', note: 'One line per customer, by name', html: () => printDoc('Customer addresses', [tablePage('Customer addresses · ' + pn, filt || 'All customers', customersShown(), [['Account', c => c.account], ['Customer', c => c.name], ['Address', c => U.addressLine(c)], ['Phone', c => c.phone], ['Contact', c => c.contact], ['Keys / door code', c => c.keys]])]) }
  ];
}

function rebuild() { allLines = U.lines(data.customers, data.routeDays); fillPickers(); draw(); }
function setData(d) {
  data = Object.assign({}, data || {}, d);
  $('plant-name').textContent = data.plantName || '';
  $('add').hidden = !data.canEdit; $('import').hidden = !data.canImport;
  rebuild();
}

document.querySelectorAll('#views button').forEach(b => { b.onclick = () => { view = b.dataset.view; $('sort').value = ''; history.replaceState(null, '', '?view=' + view); draw(); }; });
['q', 'route', 'day', 'chain', 'sort'].forEach(id => $(id).addEventListener(id === 'q' ? 'input' : 'change', draw));
$('rows').addEventListener('click', ev => { if (ev.target.closest('a')) return; const tr = ev.target.closest('tr[data-key]'); if (tr) openCustomer(tr.dataset.key); });
$('add').onclick = () => openCustomer(null);
$('import').onclick = openImport;
printMenu($('udcl-print-menu'), printItems);

requireSignIn(async () => {
  try { setData(await readList()); showError(''); }
  catch (err) { showError(serverText(err, 'the customer list')); }
});
