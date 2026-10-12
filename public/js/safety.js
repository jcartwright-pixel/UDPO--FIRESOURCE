// Safety Walkthrough screens (Joe 10/12): the plant being walked, who may save, the photo shrink and the shared reads.
import { collection, doc, query, where, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
import { escapeHtml, shortDate } from './app.js';

const L = window.UDLogic, S = window.UDSafety;

// Joe 10/12: on a tablet standing up or a phone the tables show as cards (css/safety.css); each cell carries its column's
// name so the card can show it. Kept up as the screens redraw their rows.
function labelCells(table) {
  const names = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim());
  table.querySelectorAll('tbody tr').forEach(tr => { let i = 0; [...tr.children].forEach(td => { if (names[i] && !td.hasAttribute('colspan')) td.setAttribute('data-label', names[i]); else td.removeAttribute('data-label'); i += td.colSpan || 1; }); });
}
document.querySelectorAll('table.sw-grid').forEach(table => {
  labelCells(table);
  new MutationObserver(() => labelCells(table)).observe(table, { childList: true, subtree: true });
});
export const PLANT_ROLES = L.SAVE_ROLES.concat(['PLANT_EMPLOYEE']);
export const today = () => L.localDay(new Date().toISOString());
export const thisMonth = () => today().slice(0, 7);
export const monthName = (m) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1, 15)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });

// The plant: the one picked on the main screen (this tab), else the person's first plant. ?plant= wins.
export function plantsOf(person) {
  const ids = person ? L.plantsFor(person) : [];
  const list = L.PLANTS.filter(p => ids.indexOf(p.id) >= 0);
  return list.length ? list : L.PLANTS.slice(0, 1);
}
export function pickPlant(person, wanted) {
  const list = plantsOf(person);
  let picked = wanted || '';
  if (!picked) try { picked = sessionStorage.getItem('udPlant') || ''; } catch (e) { /* no storage */ }
  return (list.find(p => p.id === picked) || list[0]).id;
}
export const plantName = (id) => (L.PLANTS.find(p => p.id === id) || { name: id }).name;
export const canWalk = (person, app) => L.hasRole(person, PLANT_ROLES) && L.screenState(app, 'plant').open;
export const canSetUp = (person, app) => L.hasRole(person, L.REORDER_ROLES) && L.screenState(app, 'plant').open;
export const modeText = (app) => { const st = L.screenState(app, 'plant'); return st.live ? (st.open ? 'NEW APP' : 'VIEW ONLY') : 'TEST COPY'; };

// A photo shrinks to 1280 pixels on its long side as a JPEG before it is saved (small enough for one record).
export function shrinkPhoto(file) {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.naturalWidth, h = img.naturalHeight;
      const k = Math.min(1, 1280 / Math.max(w, h));
      w = Math.round(w * k); h = Math.round(h * k);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      let q = 0.72, data = c.toDataURL('image/jpeg', q);
      while (data.length > 650000 && q > 0.3) { q -= 0.12; data = c.toDataURL('image/jpeg', q); }
      resolve(data);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a picture.')); };
    img.src = url;
  });
}

// Open issues of a plant (and, with walkId, the ones that walk marked Fixed), newest first.
export function watchOpenIssues(db, plant, cb, fail) {
  return onSnapshot(query(collection(db, 'safetyIssues'), where('facilityId', '==', plant), where('status', '==', 'OPEN')), s => cb(s.docs.map(d => Object.assign({ id: d.id }, d.data()))), fail);
}
export function watchIssues(db, plant, cb, fail) {
  return onSnapshot(query(collection(db, 'safetyIssues'), where('facilityId', '==', plant)), s => cb(s.docs.map(d => Object.assign({ id: d.id }, d.data()))), fail);
}
// The plant's checklist with its Location Areas (Joe 10/12) as setup.locations; cb once both have been read, then on each change.
export function watchSetup(db, plant, cb) {
  let setup, locs;
  const send = () => { if (setup !== undefined && locs !== undefined) cb(setup || locs ? Object.assign({}, setup || {}, { locations: locs }) : null); };
  const a = onSnapshot(doc(db, 'safetySetup', plant), s => { setup = s.exists() ? s.data() : null; send(); }, () => { setup = null; send(); });
  const b = onSnapshot(doc(db, 'locationAreas', plant), s => { locs = s.exists() ? s.data() : null; send(); }, () => { locs = null; send(); });
  return () => { a(); b(); };
}
export function watchExtinguishers(db, plant, cb, fail) {
  return onSnapshot(query(collection(db, 'extinguishers'), where('facilityId', '==', plant)), s => cb(s.docs.map(d => Object.assign({ id: d.id }, d.data())).filter(e => e.status !== 'RETIRED')
    .sort((a, b) => String(a.tag).localeCompare(String(b.tag), 'en', { numeric: true }))), fail);
}

// "7 DAYS" in amber, red once past 30 days; "TODAY" on the day it was found.
export function agePill(issue) {
  const d = S.daysOpen(issue, today());
  if (issue.status === 'FIXED') return '';
  return d ? '<span class="sw-pill ' + (d > S.LONG_OPEN_DAYS ? 'red' : 'amber') + '">' + d + (d === 1 ? ' DAY' : ' DAYS') + '</span>' : '<span class="sw-pill blue">TODAY</span>';
}
// Where the issue stands with Plant Maintenance (being built: it picks up the ones marked to go).
export function maintText(issue) {
  if (issue.workOrderId) return 'Work order ' + escapeHtml(issue.workOrderId) + (issue.maintStatus ? ' · ' + escapeHtml(String(issue.maintStatus).toLowerCase()) : '');
  if (issue.sendToMaint) return 'Waiting for Plant Maintenance';
  return 'Not sent';
}
export const foundLine = (i) => escapeHtml(i.area || '') + ' · found ' + shortDate(i.foundOn) + (i.foundByName ? ' by ' + escapeHtml(i.foundByName) : '');
