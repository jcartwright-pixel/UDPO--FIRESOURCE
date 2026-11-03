/*
 * What a person can see and do in Plant & Distribution, worked out in the hub the same way Operations does it
 * (functions/src/logic.js plantsFor, screensFor, homeChoices; public/js/admin-pages.js rightsResult). The screen list, the
 * jobs, the rights list and the role templates all come from Operations' own `people` answer, so nothing here is a second
 * copy of them; only these few rules are, and hub.test.js checks them against Operations' own.
 * Plain JavaScript with no imports, so it runs in the browser and in the hub's tests.
 */
const ADMIN_ROLES = ['ADMINISTRATOR', 'ADMIN'];
export const isAdmin = (p) => (p && p.roles || []).some(r => ADMIN_ROLES.indexOf(String(r).toUpperCase()) >= 0);

/** The plants a person works at (the same as Operations: All plants, the ones ticked, or Uniontown when none). */
export function plantsFor(person, plants) {
  if (!person || person.status !== 'ACTIVE') return [];
  const list = (person.facilities || []).map(String), ids = plants.map(p => p.id);
  if (list.indexOf('*') >= 0 || (!list.length && isAdmin(person))) return ids;
  const known = ids.filter(id => list.indexOf(id) >= 0);
  return known.length ? known : ['fac_uniontown'];
}

export const screenKeys = (areas) => areas.reduce((all, a) => all.concat(a.screens.map(s => s[0])), []);

/** The screens a person may see at one plant (every one when nothing is limited, or for an Administrator). */
export function screensFor(person, access, plantId, areas, plants) {
  const keys = screenKeys(areas);
  if (!access || typeof access !== 'object' || isAdmin(person)) return keys;
  if (plantsFor(person, plants).indexOf(plantId) < 0) return [];
  const list = Array.isArray(access[plantId]) ? access[plantId] : [];
  return keys.filter(k => list.indexOf(k) >= 0);
}

/** The pages a person may pick as their Home screen, grouped by Home card, each page once. */
export function homeChoices(person, access, areas, plants) {
  const limited = !!(access && typeof access === 'object' && !isAdmin(person));
  const mine = {}, seen = {}, out = [];
  (limited ? plantsFor(person, plants) : ['']).forEach(pl => screensFor(person, access, pl, areas, plants).forEach(k => { mine[k] = 1; }));
  areas.forEach(a => {
    const rows = a.screens.filter(s => mine[s[0]]);
    if (!rows.length) return;
    [[a.home, a.name]].concat(rows.map(s => [s[2][0], s[1]])).forEach(r => {
      if (seen[r[0]]) return;
      seen[r[0]] = 1;
      out.push({ page: r[0], name: r[1], group: a.name });
    });
  });
  return out;
}

/** Rights only an Administrator has; they cannot be given to one person. */
export const adminOnly = (code) => /^admin\./.test(code) || code === 'audit.full';

/** Whether a person (as drafted) may do one thing: their role's rights, plus Allow, minus Deny. */
export function rightAllowed(person, code, templates, defaults) {
  if (!person || person.status !== 'ACTIVE') return false;
  if (isAdmin(person)) return true;
  if (adminOnly(code)) return false;
  if ((person.denials || []).indexOf(code) >= 0) return false;
  if ((person.grants || []).indexOf(code) >= 0) return true;
  return (person.roles || []).some(r => ((templates || {})[r] || (defaults || {})[r] || []).indexOf(code) >= 0);
}
