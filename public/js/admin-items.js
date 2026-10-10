// Joe 10/10: everything the current app's Administration did, nothing left out, grouped the way it works. A screen the new
// app has opens here; one not built yet opens the "being built" page inside the new app (never the old program).
// [key, title, what it does, page (blank = being built), icon]
export const ADMIN_GROUPS = [
  ['People & Access', 'Who signs in, their role, which plants they see and their rights', [
    ['people', 'People & Roles', 'Add a person; set their role, account status, allowed plants (All plants or each plant) and each right (use role, allow, deny).', '', 'people'],
    ['role-templates', 'Role Templates', 'Pick a role and tick the rights it gets. The Administrator role is protected and has every right.', '', 'check'],
    ['access-codes', 'Access & QR Codes', 'A revocable phone link and QR code for each employee: Generate, Regenerate (press twice) and Text the link (texting is off).', '', 'pin']
  ]],
  ['App Links & Codes', 'Every link and code people use to reach the app', [
    ['app-links', 'App Links & Codes', 'Web app, phone, tablet, company and browser links, plant-station and driver-board codes: copy, print a QR, open, change a link, and turn a public link off (press twice).', '', 'swap'],
    ['station-codes', 'Plant Station Codes', 'The manager release code for each plant station: New code (press twice to replace).', '', 'factory']
  ]],
  ['Email & Schedules', 'Where email goes, how often, and how often the app refreshes', [
    ['repair-email', 'Repair Email', 'Where repair email goes (Idealease, Penske, owned units), on or off, how often for each lessor, the digest hour, and Send now.', '', 'alert'],
    ['report-recipients', 'Manager Report Recipients', 'Who gets the plant report at each location: add and remove people (press twice to remove).', '', 'star'],
    ['sent-log', 'Sent Email Log', 'Every email the app sent, newest first.', '', 'day'],
    ['checkin-email', 'Driver Check-In Email', 'The mailbox check for driver check-in email: on or off, sender, recipient, subject, Check now, and Use the standard addresses.', '', 'people'],
    ['refresh-rates', 'Refresh Rates', 'How often each background job runs, Save rate for each, and Archive now for completed work. Two retired jobs stay read-only.', '', 'week']
  ]],
  ['Dispatch Administration', 'Already in the new app', [
    ['dispatch-admin', 'Dispatch Administration', 'Dispatch rules, carriers and the dispatch administration cards.', 'admin.html', 'distribution-truck-v1-560.webp'],
    ['ops', 'Operational Assignments', 'Branch, carrier and CVG assignments drivers can be given on Daily Dispatch.', 'ops.html', 'people'],
    ['print', 'Print Layouts', 'How the dispatch sheets print.', 'print.html', 'day'],
    ['settings', 'Dispatch Settings', 'Dispatch defaults and options.', 'settings.html', 'gear'],
    ['routes', 'Route Editor', 'Routes, runs, times and which days each run goes.', 'routes.html', 'map'],
    ['switch', 'Which App Runs Each Screen', 'On the Route Distribution page, an administrator clicks a screen\'s tag twice to run it from the new app, and turns the write-back on or off.', 'distribution.html', 'swap']
  ]],
  ['Plant Setup', 'Set-up for the plant side', [
    ['machine-products', 'Machine Products', 'The products each machine runs (RedZone, Uniontown): the Product drop-down on Quality Checks. Add, change or remove a product and its SKU.', 'products.html', 'production.webp']
  ]],
  ['Fleet & GPS Setup', 'Set-up for the maintenance side', [
    ['gps', 'GPS Setup', 'The Verizon Connect sign-in and a plain pass or fail test.', 'gps.html', 'pin'],
    ['fleet-setup', 'Fleet Service Setup', 'Service rules: PM miles, reefer months, DOT and plate warnings.', 'fleet.html?view=setup', 'maintenance-trailer-v1-560.webp']
  ]],
  ['System Tools', 'Stations and sensors', [
    ['window-test', 'Window Test Center', 'Opens every screen at each window size to check nothing is cut off.', '', 'check'],
    ['driver-station', 'Driver Station', 'The driver board and check-in station.', 'driver-station.html', 'distribution-truck-v1-560.webp'],
    ['mocreo', 'MOCREO & Sensors', 'The cooler sensors: which sensor is which cooler, and the MOCREO connection. Coolers are entered by hand until the key is set.', '', 'temperatures.webp']
  ]],
  ['Diagnostics', 'Checks and repairs for the data behind the app', [
    ['preflight', 'Run Runtime Pre-Flight', 'Checks every sheet, column and setting the app needs and lists anything missing.', '', 'check'],
    ['update-live', 'Update Live Sheets', 'Writes the latest changes to the Live sheets (press twice).', '', 'swap'],
    ['refresh-home', 'Refresh Home Summary Now', 'Rebuilds the all-plants overview numbers right away.', '', 'factory'],
    ['plant-fresh', 'Start Plant Fresh From Today', 'Starts the plant screens over from today\'s loads.', '', 'factory'],
    ['date-inventory', 'Date Inventory', 'Lists the dates each sheet holds.', '', 'day'],
    ['date-convert', 'Date Column Dry Run / Convert', 'Tries a date-column fix on one sheet and column (Dry Run), then Convert Column once the dry run passes.', '', 'week'],
    ['repair-items', 'Remaining Repair Items', 'The list of repairs still to do, and Add Item.', '', 'alert']
  ]]
];

export function adminItem(key) {
  for (const [group, , items] of ADMIN_GROUPS) for (const it of items) if (it[0] === key) return { group, key: it[0], title: it[1], what: it[2], page: it[3], icon: it[4] };
  return null;
}
