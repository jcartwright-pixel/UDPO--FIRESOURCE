// Which apps a person can open from the hub: the same rules as the hub's tiles (functions/src/hub.js; a test keeps the two
// the same). No imports, so the server's tests can read it too.
export const roleKey = (r) => String(r || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
export const isAdminRole = (roles) => (roles || []).some(r => ['ADMINISTRATOR', 'ADMIN'].indexOf(roleKey(r)) >= 0);
export function appsFor(p) {
  if (!p || String(p.status || '').trim().toUpperCase() !== 'ACTIVE') return [];
  return ['Operations', 'Customer List'].concat(isAdminRole(p.roles) ? ['Fuel Reporting', 'UDMS'] : []);
}
