// Which apps a person can open from the hub: the same rules as the hub's tiles (functions/src/hub.js; a test keeps the two
// the same). No imports, so the server's tests can read it too.
export const roleKey = (r) => String(r || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
export const isAdminRole = (roles) => (roles || []).some(r => ['ADMINISTRATOR', 'ADMIN'].indexOf(roleKey(r)) >= 0);
export const APPS = [
  { key: 'operations', name: 'Plant & Distribution' }, { key: 'customers', name: 'Customers & Routes' },
  { key: 'fuel', name: 'Fuel Tracking' }, { key: 'udms', name: 'Employees & Compliance' }, { key: 'routes', name: 'Route & Trip Costs' },
  { key: 'routecost', name: 'Route Cost Analysis' }, { key: 'statements', name: 'Customer Statements' }, { key: 'accident', name: 'Accident & Injury Reporting' }
];
// ticks = the apps saved for this person in People & Access (appAccess), or null for the standard rule. Plant & Distribution
// always stays on for an Enabled person.
export function appKeysFor(p, ticks) {
  if (!p || String(p.status || '').trim().toUpperCase() !== 'ACTIVE') return [];
  if (!Array.isArray(ticks)) return ['operations', 'customers'].concat(isAdminRole(p.roles) ? ['fuel', 'udms', 'routes', 'routecost', 'statements'] : []).concat(['accident']);
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
  routes: { color: '#9c2a3a', icon: path('<circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="5.5" r="2.5"/><path d="M8 18.5h7.5a3.5 3.5 0 0 0 0-7h-7a3.5 3.5 0 0 1 0-7H16"/>') },
  routecost: { color: '#2f6f8f', icon: path('<path d="M3 20h18"/><path d="M6 20V11M11 20V6M16 20v-6M21 20V9"/>') },
  statements: { color: '#7b3f6e', icon: path('<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 12h7M9 15.5h7M9 19h4"/>') },
  accident: { color: '#b3261e', icon: path('<path d="M12 3l9 16H3z"/><path d="M12 10v4"/><path d="M12 17h.01"/>') },
  roles: { color: '#7a4b12', icon: path('<circle cx="8" cy="8" r="3"/><path d="M2.5 19c0-3 2.5-5.5 5.5-5.5"/><path d="M14 11h7M14 15h7M14 19h7"/><path d="M11.5 11l.8.8 1.4-1.6"/>') },
  links: { color: '#0f6b5c', icon: path('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>') },
  email: { color: '#a3570f', icon: path('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5l8.5 6.5 8.5-6.5"/>') },
  'plant-setup': { color: '#4a6b1f', icon: path('<path d="M3 21V10l6-4v4l6-4v4l6-4v15z"/><path d="M7 17h2M12 17h2M17 17h1"/>') },
  keys: { color: '#8a2d3b', icon: path('<circle cx="8" cy="14" r="4"/><path d="M11 11l9-9M17 5l2 2M15 7l2 2"/>') },
  bol: { color: '#8a4b14', icon: path('<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/>') },
  changes: { color: '#1d7a46', icon: path('<path d="M12 21s-6.5-5.6-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z"/><path d="M9.5 10.5l2 2 3.5-3.5"/>') },
  accounting: { color: '#2f6f4e', icon: path('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h2M12 11h2M16 11h0M8 15h2M12 15h2M8 18h2M12 18h2"/>') },
  // Joe 11-5-26: Plant & Distribution is two cards on Home, Plant Operations (the plant) and Route Distribution (the truck).
  plant: { color: '#2f6e3a', icon: path('<path d="M3 21V10l6-4v4l6-4v4l6-4v15z"/><path d="M7 17h2M12 17h2M17 17h1"/>') },
  // Joe 11-10-26: a card just for Inventory under Plant (Lucide "package").
  inventory: { color: '#6b4f1d', icon: path('<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><path d="M3.29 7 12 12l8.71-5"/><path d="m7.5 4.27 9 5.15"/>') },
  sales: { color: '#b8860b', icon: path('<path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z"/><circle cx="7.5" cy="7.5" r="1.5"/>') },
  distribution: { color: '#075b9c', icon: path('<path d="M2 7h12v9H2z"/><path d="M14 10h4l3.5 3.5V16H14"/><circle cx="6.5" cy="17.5" r="2"/><circle cx="17.5" cy="17.5" r="2"/>') },
  // Lucide "list".
  customerlist: { color: '#1d7a46', icon: path('<path d="M3 5h.01M3 12h.01M3 19h.01M8 5h13M8 12h13M8 19h13"/>') },
  people: { color: '#3a5068', icon: path('<path d="M12 3l8 3v5.5c0 5-3.5 8.3-8 9.5-4.5-1.2-8-4.5-8-9.5V6z"/><path d="M9 12l2 2 4-4"/>') }
};

// Joe 11-6-26: "an action button to list all of the mobile app direct links ... group them ... so everything's all in one place
// for people." Home's All app links list: links only, never codes (codes stay in Links & Codes, administrators only).
// ops = Plant & Distribution's own site for this hub (live or practice); the accident app and the apply page have one address.
export const ACCIDENT_URL = 'https://united-dairy-accident-app.web.app/';
export const APPLY_URL = 'https://udms-apply.web.app/';
export function linkGroups(ops) {
  const o = (path) => ops.replace(/\/$/, '') + '/' + path;
  return [
    { name: 'Everyone', links: [
      { name: 'Plant Operations on a phone', note: 'The full app; your role decides what you see', url: o('index.html'), how: 'United Dairy sign-in' },
      { name: 'Accident & Injury Reporting', note: 'Report an accident or injury right away', url: ACCIDENT_URL, how: 'Open to report' }
    ] },
    { name: 'Managers', links: [
      { name: 'Plant Managers App', note: 'The plant managers\' phones and tablets', url: o('walkthrough.html?view=home&app=1'), how: 'United Dairy sign-in, then the Plant Managers code once' },
      { name: 'Distribution Manager', note: 'Dispatch, routes, trucks and drivers', url: o('distribution.html'), how: 'United Dairy sign-in' }
    ] },
    { name: 'Sales', links: [
      { name: 'Sales App', note: 'Salespeople on their phones; it only shows, nothing changes', url: o('sales.html'), how: 'United Dairy sign-in' }
    ] },
    { name: 'Drivers', links: [
      { name: 'Drivers\' phones (Route Distribution)', note: 'View Loadout, DVIR, Check-In and My Schedule', url: o('route.html'), how: 'The Route Distribution code' },
      { name: 'Driver Station', note: 'The Driver Room TV and the drivers\' tablet', url: o('driver-station.html'), how: 'The station\'s code' }
    ] },
    { name: 'Plant floor', links: [
      { name: 'Plant Station', note: 'A plant tablet', url: o('plant-station.html'), how: 'United Dairy sign-in, then the station\'s code once' },
      { name: 'Plant Station with no United Dairy account', note: 'A tablet or phone with only its station\'s code', url: o('plant-station.html?noaccount=1'), how: 'The station\'s code' },
      { name: 'Line Tablet', note: 'The tablet at a production line', url: o('line.html?tablet=1'), how: 'United Dairy sign-in, then the Line Tablet code once' }
    ] },
    { name: 'Garage & Maintenance', links: [
      { name: 'Garage Station', note: 'The garage tablet', url: o('garage-station.html'), how: 'The station\'s code, then each mechanic\'s login ID' },
      { name: 'Maintenance Station', note: 'The maintenance shop tablet', url: o('maint-station.html'), how: 'The station\'s code, then name and login ID' }
    ] },
    { name: 'Hiring', links: [
      { name: 'Job application', note: 'For people applying to work at United Dairy', url: APPLY_URL, how: 'Anyone with the link' }
    ] }
  ];
}

// The Home screen's areas (Joe 11-5-26: "have a menu option to divide areas of the program"). Each app and each
// Administration screen sits in one area; the menu on Home shows one area at a time, or Everything.
export const AREAS = [
  { key: 'plant', name: 'Plant', note: 'Production, the plant floor, loadout, quality and inventory', apps: ['plant', 'inventory'] },
  // Joe 11-10-26: Route & Trip Costs under Distribution; a Customer List card under Sales. Route Cost Analysis under Fleet & Costs (Joe 11-11-26) ("it can lead
  // to our complete customer list"). Customer Changes stays in the hub's menu for administrators.
  { key: 'distribution', name: 'Distribution', note: 'Dispatch, drivers, trucks, customers, delivery routes and what each trip costs', apps: ['distribution', 'customers', 'routes'] },
  // copies: a second card in this area that opens another app's card's address, shown only to people who have that card.
  { key: 'sales', name: 'Sales', note: 'The salespeople\'s own app and the complete customer list', apps: ['sales'],
    copies: [{ key: 'customerlist', of: 'customers', name: 'Customer List', note: 'The complete customer list: every customer, its route and day, in Customers & Routes' }] },
  { key: 'fleet', name: 'Fleet & Costs', note: 'Fuel use, fuel prices, tank deliveries and the cost of each route', apps: ['fuel', 'routecost'] },
  { key: 'office', name: 'Office', note: 'Customer statements', apps: ['statements'] },
  { key: 'people', name: 'People & Safety', note: 'Employee records, drivers, hiring, and reporting an accident or injury', apps: ['udms', 'accident'] },
  { key: 'admin', name: 'Administration', note: 'Who gets in and how everything is set up', admin: true, groups: [
    { name: 'Who gets in', items: ['people', 'roles'] },
    { name: 'Messages and links', items: ['email', 'links'] },
    { name: 'Plants and connections', items: ['plant-setup', 'keys'] },
    { name: 'Numbers from the office', items: ['accounting', 'bol'] }
  ] }
];
// The area pictures for the menu.
export const AREA_ICON = {
  all: path('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
  plant: LOOK['plant-setup'].icon, distribution: LOOK.distribution.icon, sales: LOOK.sales.icon, fleet: LOOK.fuel.icon, office: LOOK.statements.icon, people: LOOK.udms.icon, admin: LOOK.people.icon
};
