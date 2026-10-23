// Joe 10/10: everything the current app's Administration did, nothing left out, grouped the way it works. A screen the new
// app has opens here; one not built yet opens the "being built" page inside the new app (never the old program).
// [key, title, what it does, page (blank = being built), icon, 'practice' = practice copy only / 'moved' = on another page's cards]
export const ADMIN_GROUPS = [
  ['People & Access', 'Who signs in, their role, which plants they see and their rights', [
    ['people', 'People & Roles', 'Add a person; set their role, account status, allowed plants (All plants or each plant) and each right (use role, allow, deny).', '', 'people'],
    ['role-templates', 'Role Templates', 'Pick a role and tick the rights it gets. The Administrator role is protected and has every right.', '', 'check'],
    ['access-codes', 'Access & QR Codes', 'A revocable phone link and QR code for each employee: Generate, Regenerate (press twice) and Text the link (texting is off).', '', 'pin']
  ]],
  ['Links & Codes', 'Every link and code people use to reach the app, each where it belongs', [
    ['app-links', 'Manager Links', 'The links for managers and office staff: Plant Operations (the full app), the phone link, the Plant Managers App, the Distribution Manager and personal phone links: copy, print a QR, Launch (opens in a new window); and each plant\'s manager release code to move a tablet or Exit a kiosk.', '', 'swap'],
    ['station-codes', 'Plant Station Codes', 'The one Plant Station link (copy, print a QR, open), then the stations: + Add Station, each station\'s code (typed on the tablet to open that station), New code, Remove. (The manager release codes are in Manager Links.)', '', 'factory'],
    ['garage-codes', 'Garage Station Codes', 'The Garage Station and Maintenance Station links (copy, print a QR, Launch in a new window), then the garage stations: + Add Station, each station\'s code, New code, Remove.', '', 'gear'],
    ['driver-codes', 'Driver Station Codes', 'The Driver Station link, for the Driver\'s Kiosk Station (the TV) and the Driver Room Check-In Station (the drivers\' tablet, its code opens the drivers\' Check-In, like their phones): copy, print a QR, open; then the stations: + Add Station, each tablet, TV or kiosk\'s code (typed on it once), New code, Remove; and the drivers\' phone link with its Route Distribution code: new code, turn it off (press twice).', '', 'people'],
    // Joe 10/18: "send them the link and have a code".
    ['manager-app-codes', 'Plant Managers App', 'The Plant Managers link for the managers\' phones, iPads and tablets (copy, print a QR, Launch): they sign in with their United Dairy account and type the Plant Managers code once; then each plant\'s Plant Managers code: Create code, New code.', '', 'people']
  ]],
  ['Email & Schedules', 'Where email goes, how often, and how often the app refreshes', [
    ['repair-email', 'Repair Email', 'Where repair email goes (Idealease, Penske, owned units), on or off, how often for each lessor, the digest hour, and Send now.', '', 'alert'],
    ['email-senders', 'Email Senders', 'Who email comes from: the person who presses Send (their own United Dairy email), and each plant\'s address for automatic email.', '', 'swap'],
    ['report-recipients', 'Manager Report Recipients', 'Who gets the plant report at each location: add and remove people (press twice to remove).', '', 'star'],
    ['sent-log', 'Sent Email Log', 'Every email the app sent, newest first.', '', 'day'],
    ['checkin-email', 'Driver Check-In Email', 'The mailbox check for driver check-in email: on or off, sender, recipient, subject, Check now, and Use the standard addresses.', '', 'people'],
    ['refresh-rates', 'Refresh Rates', 'How often each background job runs (each saves when it is picked), and Archive now for completed work. Two retired jobs stay read-only.', '', 'week']
  ]],
  // Batch 8, mock-up 2 (10/23): dispatch set-up lives on the Dispatch Administration page; this list keeps one line for it.
  // The other dispatch items stay here (Find a setting and ?item= still open them) but are left off the list ('moved').
  ['Dispatch', 'Dispatch set-up is on the Dispatch Administration page', [
    ['dispatch-admin', 'Dispatch Administration', 'Dispatch rules, carriers and the dispatch administration cards.', 'admin.html', 'distribution-truck-v1-560.webp'],
    ['ops', 'Operational Assignments', 'Branch, carrier and CVG assignments drivers can be given on Daily Dispatch.', 'ops.html', 'people', 'moved'],
    ['print', 'Print Layouts', 'How the dispatch sheets print.', 'print.html', 'day', 'moved'],
    ['settings', 'Dispatch Settings', 'Dispatch defaults and options.', 'settings.html', 'gear', 'moved'],
    ['routes', 'Route Editor', 'Routes, runs, times and which days each run goes.', 'routes.html', 'map', 'moved'],
    // Joe 10/12: switching screens lives here, not on the cards' tags (they can no longer be clicked).
    ['switch', 'Go-Live Switches', 'Which screens are switched on, Pause / Resume writing to the sheets, Mark fully live, and one button to turn on everything that is ready.', '', 'swap', 'moved']
  ]],
  ['Plant Setup', 'Set-up for the plant side', [
    // Joe 10/18: a new plant's data (Charleston, Martins Ferry) from one workbook, each person filling their own tabs; every row is
    // checked (new, changed, problem) before anything is saved.
    ['upload-center', 'Upload Center', "Bring in a new plant's data (Charleston, Martins Ferry) from one Excel workbook: routes, drivers, the plant, people and email. Download it, fill it in, upload it, check every row, then save.", 'uploads.html', 'swap'],
    ['machine-products', 'Product Sheet', "Every product at the plant, one line each, with a check for each machine it runs on (each machine's checks are the Product drop-down on its Quality Check). Add or edit a product, download the whole list, or upload it back.", 'products.html', 'production.webp'],
    // Joe 10/13: pick a machine (HTST #1, say) and set the products run on it; the same lists as the Product Sheet's checks.
    ['machine-setup', 'Machine Setup', "Each machine's products: pick a machine, add or remove the products run on it, and drag them into the order of its Quality Check drop-down.", 'machine-setup.html', 'production.webp'],
    ['plant-shifts', 'Plant Shifts', 'Each plant\'s Distribution and Plant Production shifts (Uniontown distribution: 6:00 AM-2:30 PM, 2:00-10:30 PM, 10:00 PM-5:30 AM). Plant Reports compare the shifts by these times.', 'shifts.html', 'week'],
    // Joe 10/12: one list of each plant's areas and sub-areas; the Safety Walkthrough walks it, other screens can use it later.
    ['location-areas', 'Location Areas', "Each plant's areas (Plant, Garage, Office, Yard) and their sub-areas: add, rename, reorder, turn off. The Safety Walkthrough walks them in this order; other screens can use them later.", 'location-areas.html', 'map']
  ]],
  // Joe 10/10: every API key the app uses is pasted and replaced here, never in a chat. MOCREO first; Verizon GPS later.
  ['Connections & Keys', 'The API keys the app uses: paste, replace and test them here', [
    ['mocreo', 'MOCREO & Sensors', 'The MOCREO API key (never shown again once saved) and asset ID, Test Connection, and the thermometers: location, cooler, sensor, low and high limits, on or off.', 'mocreo.html', 'temperatures.webp'],
    // Joe 10/15: built ready and kept Off; the drivers' mobile phones are typed on the Driver Roster.
    ['schedule-texts', 'Schedule Texts', 'Texts each driver when a new week is posted. Off until turned On here; the Twilio texting account is typed here and never shown again.', 'texts.html', 'gear'],
    // Joe 10/11: RedZone's API sign-in (token, or client ID and secret), Test Connection; Products then gets Get from RedZone.
    ['redzone', 'RedZone', 'The RedZone API sign-in (never shown again once saved), Test Connection, and where to find it in RedZone. Read only: nothing is changed in RedZone.', 'redzone.html', 'production.webp']
  ]],
  ['Fleet & GPS Setup', 'Set-up for the maintenance side', [
    ['gps', 'GPS Setup', 'The Verizon Connect sign-in and a plain pass or fail test.', 'gps.html', 'pin'],
    ['fleet-setup', 'Fleet Service Setup', 'Service rules: PM miles, reefer months, annual inspection and plate warnings.', 'fleet.html?view=setup', 'maintenance-trailer-v1-560.webp']
  ]],
  ['System Tools', 'Checks', [
    // Joe 10/12: Driver Station and Plant Station moved to Links & Codes, where Launch opens them in a new window. Review item 54
    // (Joe 10/13): Phone Screens is gone; it listed the same links as Links & Codes.
    ['window-test', 'Window Test Center', 'Opens every screen at each window size to check nothing is cut off.', '', 'check']
  ]],
  ['Diagnostics', 'Checks and repairs for the data behind the app', [
    ['preflight', 'Run Runtime Pre-Flight', 'Checks every sheet, column and setting the app needs and lists anything missing.', '', 'check'],
    // Joe 10/13 ("where is the sheet conflicts?"): Sheet Conflicts is in the list, so Find a setting finds it.
    ['sheet-conflicts', 'Sheet Conflicts', 'Saves the Operations app did not write because someone changed the same cell in the sheet.', 'conflicts.html', 'alert'],
    ['update-live', 'Update Live Sheets', 'Rebuilds the Current and Next weeks from Route Master and the drivers\' standard runs, and adds missing runs (press twice).', '', 'swap'],
    ['refresh-home', 'Refresh Home Summary Now', 'Rebuilds the all-plants overview numbers right away.', '', 'factory'],
    ['plant-fresh', 'Start Plant Fresh From Today', 'Starts the plant screens over from today\'s loads.', '', 'factory'],
    // Audit batch 6: the date tools work on the practice copy's sheets only, so the live app leaves them off the list.
    ['date-inventory', 'Date Inventory', 'Lists the dates each sheet holds.', '', 'day', 'practice'],
    ['date-convert', 'Date Column Dry Run / Convert', 'Tries a date-column fix on one sheet and column (Dry Run), then Convert Column once the dry run passes.', '', 'week', 'practice'],
    ['repair-items', 'Remaining Repair Items', 'The list of repairs still to do, and Add Item.', '', 'alert']
  ]]
];

// On the live app (ud-distribution.web.app) the practice-copy-only items are left off.
const LIVE = typeof location !== 'undefined' && /^ud-distribution\.(web\.app|firebaseapp\.com)$/.test(location.hostname);
if (LIVE) ADMIN_GROUPS.forEach(g => { g[2] = g[2].filter(it => it[5] !== 'practice'); });

export function adminItem(key) {
  for (const [group, , items] of ADMIN_GROUPS) for (const it of items) if (it[0] === key) return { group, key: it[0], title: it[1], what: it[2], page: it[3], icon: it[4], moved: it[5] === 'moved' };
  return null;
}
