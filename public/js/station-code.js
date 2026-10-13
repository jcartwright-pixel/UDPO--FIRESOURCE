/*
 * The station code on a tablet (Joe 10/12, as the current app's Plant Station): the Plant Station, Garage Station and
 * Driver Room kiosk ask for their station's code once, remember the station, and open it each time after. A new code or a
 * removed station sends the tablet back to the code screen. call(op, fields) is the page's server call for station steps.
 */
const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
export const remember = (k, v) => { try { if (v) localStorage.setItem(k, JSON.stringify(v)); else localStorage.removeItem(k); } catch (e) { /* private window: asked again next time */ } };

/*
 * What the tablet opens: {station} (a station from its code), {needCode, message} (codes are in use and this tablet has
 * none, or its code changed), or {free: true} (no codes at this plant yet: the page works as before).
 */
const noSignal = (e) => !navigator.onLine || /internal|unavailable|deadline|network|failed to fetch|offline/i.test(String(e && (e.code + ' ' + e.message)));
export async function resolveStation(kind, storeKey, call) {
  const mine = read(storeKey);
  if (mine && mine.key) {
    // Joe 10/13: with no signal the tablet keeps the station it had (checked again once the signal is back).
    let r;
    try { r = await call('check', { kind, key: mine.key, version: mine.version || '' }); } catch (e) {
      if (noSignal(e)) return { station: mine, offline: true };
      throw e;
    }
    if (r.ok) { remember(storeKey, r.station); return { station: r.station }; }
    remember(storeKey, null);
    return { needCode: true, message: r.message };
  }
  // With no signal, the last answer this tablet had (a station with no codes opens as before; unknown asks for the code).
  const HAS = 'udStationHas.' + kind;
  let has;
  try { has = await call('has', { kind, facilityId: 'fac_uniontown' }); try { localStorage.setItem(HAS, has.required ? '1' : '0'); } catch (e) { /* private window */ } } catch (e) {
    if (!noSignal(e)) throw e;
    let last = null;
    try { last = localStorage.getItem(HAS); } catch (x) { /* private window */ }
    return last === '0' ? { free: true, offline: true } : { needCode: true, message: 'No signal. The station code can be checked once the signal is back.' };
  }
  return has.required ? { needCode: true, message: '' } : { free: true };
}

// The code screen inside box; resolves with the station once a right code is typed.
export function askCode(box, { kind, storeKey, call, title, hint, message }) {
  return new Promise(resolve => {
    box.innerHTML = '<form class="st-code"><h2>' + title + '</h2><p>' + hint + '</p>' +
      '<label>Station code <input name="code" maxlength="20" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text"></label>' +
      '<button type="submit">Open station</button><p class="st-code-msg" role="status"></p></form>';
    const form = box.querySelector('form'), msg = box.querySelector('.st-code-msg');
    msg.textContent = message || '';
    form.code.focus();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      msg.textContent = 'Checking…';
      try {
        const r = await call('enter', { kind, code: form.code.value });
        if (!r.ok) { msg.textContent = r.message; form.code.select(); return; }
        remember(storeKey, r.station);
        box.innerHTML = '';
        resolve(r.station);
      } catch (err) { msg.textContent = String(err.message || err).replace(/\s*\[\d{3}\]\s*$/, ''); }
    });
  });
}

/*
 * Release: once the plant has a manager release code (Administration > Manager Links), a manager types it
 * first. Resolves true when the tablet may leave its station, false on Cancel or when the check could not be made.
 */
export async function askRelease(box, { status, release, onError, why, mustHave }) {
  let required = false;
  try { required = (await status()).required; } catch (err) {
    // No answer: the station stays as it is, so a dropped network cannot get past the code.
    onError('Could not check whether a manager release code is needed (' + (err.message || err) + '). Check the network and try again.');
    return false;
  }
  // Joe 10/12: a driver must never get from the Driver Room tablet or TV into the app. Those screens (mustHave) stay put until
  // the plant has a manager release code.
  if (!required && mustHave) { onError('This screen stays here until the plant has a manager release code (Administration > Manager Links).'); return false; }
  if (!required) return true;
  return new Promise(resolve => {
    box.hidden = false;
    box.innerHTML = '<form class="ps-release"><p>' + (why || 'A manager must type the manager release code to change this tablet\'s station.') + '</p>' +
      '<label>Manager release code <input name="code" maxlength="48" autocomplete="off" autocapitalize="characters"></label>' +
      '<button type="submit">RELEASE THIS STATION</button><button type="button" data-cancel>CANCEL</button><span class="ps-release-msg" role="status"></span></form>';
    const form = box.querySelector('form'), msg = box.querySelector('.ps-release-msg');
    const done = (v) => { box.innerHTML = ''; box.hidden = true; resolve(v); };
    form.code.focus();
    box.querySelector('[data-cancel]').addEventListener('click', () => done(false));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      msg.textContent = 'Checking…';
      try { const out = await release(form.code.value); if (out.ok) done(true); else msg.textContent = out.message; } catch (err) { msg.textContent = String(err.message || err); }
    });
  });
}

// Joe 10/12 "there will be no back buttons ... the only way to get out of that screen should be the manager release button":
// a station with a code has no Back, Home or Sign out (stations.css hides them under body.station-locked). Its own change
// button becomes the one "Release" bar at the very bottom of the screen, which asks for the plant's manager release code.
export function lockStation(button, on) {
  document.body.classList.toggle('station-locked', !!on);
  if (button.parentNode !== document.body) document.body.appendChild(button);
  button.textContent = 'Release';
  button.title = 'A manager types the manager release code to take this tablet off its station';
  button.classList.add('station-release');
  button.hidden = !on;
}
