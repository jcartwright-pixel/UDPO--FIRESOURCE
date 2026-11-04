// Which apps a person can open from the hub: the same rules as the hub's tiles (functions/src/hub.js; a test keeps the two
// the same). No imports, so the server's tests can read it too.
export const roleKey = (r) => String(r || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
export const isAdminRole = (roles) => (roles || []).some(r => ['ADMINISTRATOR', 'ADMIN'].indexOf(roleKey(r)) >= 0);
export const APPS = [
  { key: 'operations', name: 'Plant & Distribution' }, { key: 'customers', name: 'Customers & Routes' },
  { key: 'fuel', name: 'Fuel Tracking' }, { key: 'udms', name: 'Employees & Compliance' }
];
// ticks = the apps saved for this person in People & Access (appAccess), or null for the standard rule. Plant & Distribution
// always stays on for an Enabled person.
export function appKeysFor(p, ticks) {
  if (!p || String(p.status || '').trim().toUpperCase() !== 'ACTIVE') return [];
  if (!Array.isArray(ticks)) return ['operations', 'customers'].concat(isAdminRole(p.roles) ? ['fuel', 'udms'] : []);
  return APPS.map(a => a.key).filter(k => k === 'operations' || ticks.indexOf(k) >= 0);
}
export const appsFor = (p, ticks) => appKeysFor(p, ticks).map(k => APPS.find(a => a.key === k).name);

// Each app's picture and colour on its tile (Joe 11-2-26: "I want my cards to look more professional ... they don't have any icons").
const path = (d) => '<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
export const LOOK = {
  operations: { color: '#075b9c', icon: path('<path d="M2 7h12v9H2z"/><path d="M14 10h4l3.5 3.5V16H14"/><circle cx="6.5" cy="17.5" r="2"/><circle cx="17.5" cy="17.5" r="2"/>') },
  customers: { color: '#1d7a46', icon: path('<path d="M12 21s-6.5-5.6-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.4"/>') },
  fuel: { color: '#c05a00', icon: path('<path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16"/><path d="M2.5 21h13"/><path d="M6.5 8h5"/><path d="M14 10h2a2 2 0 0 1 2 2v4a1.5 1.5 0 0 0 3 0V8.5L18 5.5"/>') },
  udms: { color: '#5a3d9e', icon: path('<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.4 2.7-6 6-6s6 2.6 6 6"/><path d="M15.5 11.5l2 2 4-4"/>') },
  roles: { color: '#7a4b12', icon: path('<circle cx="8" cy="8" r="3"/><path d="M2.5 19c0-3 2.5-5.5 5.5-5.5"/><path d="M14 11h7M14 15h7M14 19h7"/><path d="M11.5 11l.8.8 1.4-1.6"/>') },
  links: { color: '#0f6b5c', icon: path('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>') },
  email: { color: '#a3570f', icon: path('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5l8.5 6.5 8.5-6.5"/>') },
  'plant-setup': { color: '#4a6b1f', icon: path('<path d="M3 21V10l6-4v4l6-4v4l6-4v15z"/><path d="M7 17h2M12 17h2M17 17h1"/>') },
  keys: { color: '#8a2d3b', icon: path('<circle cx="8" cy="14" r="4"/><path d="M11 11l9-9M17 5l2 2M15 7l2 2"/>') },
  people: { color: '#3a5068', icon: path('<path d="M12 3l8 3v5.5c0 5-3.5 8.3-8 9.5-4.5-1.2-8-4.5-8-9.5V6z"/><path d="M9 12l2 2 4-4"/>') }
};
