/*
 * Joe 11-9-26: "There should be a sandbox copy that you work on to test everything, and then there should be the live copy,
 * and that's the only thing it should open unless I want to open the test." The practice hub opens only when someone
 * chooses it (the address ends ?practice=1, kept for that tab or window). Anything else that lands on the practice hub,
 * like an installed app, a shortcut or a saved link, goes to the same screen on the live hub.
 * No imports, so the unit tests can load it.
 */
export const LIVE_HUB = 'https://ud-distribution-hub.web.app';
export const PRACTICE_HUB = 'https://ud-distribution-sandbox-hub.web.app/?practice=1';
const KEY = 'udHubPracticeChosen';

/** The live address to go to instead, or '' to stay. loc is like location; store is like sessionStorage. */
export function practiceGate(loc, store) {
  if (!/sandbox/.test(loc.hostname)) return '';
  const qs = new URLSearchParams(loc.search || '');
  let chosen = qs.get('practice') === '1';
  try {
    if (chosen) store.setItem(KEY, '1');
    else chosen = store.getItem(KEY) === '1';
  } catch (e) { /* no storage: only the ?practice=1 address opens it */ }
  if (chosen) return '';
  qs.delete('practice');
  const search = qs.toString();
  return LIVE_HUB + (loc.pathname || '/') + (search ? '?' + search : '') + (loc.hash || '');
}
