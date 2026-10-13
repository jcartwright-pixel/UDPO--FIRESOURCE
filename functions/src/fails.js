'use strict';
/*
 * Wrong-code counts per device (review item 62, Joe 10/13). A code typed wrong too often locks out only the device that
 * typed it, never every phone or tablet in the company. index.js names the device on input.who (a short hash of its
 * network address, never the address itself); whatever the browser sent there is replaced.
 */
const crypto = require('crypto');

function deviceKey(request) {
  const raw = request && request.rawRequest;
  const forwarded = raw && raw.headers ? String(raw.headers['x-forwarded-for'] || '').split(',')[0].trim() : '';
  const ip = forwarded || (raw && raw.ip) || '';
  return ip ? crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16) : 'unknown';
}

// The call's input with the device named by the server.
function withDevice(request, input) { return Object.assign({}, input || {}, { who: deviceKey(request) }); }

// The device a count belongs to ('unknown' when the call did not come through index.js, as in the tests).
function who(input) { const w = String((input && input.who) || ''); return /^[0-9a-f]{16}$/.test(w) ? w : 'unknown'; }

// A per-device map kept small: only the entries `keep` says are still current survive the next write.
function current(map, keep) {
  const out = {};
  Object.keys(map || {}).forEach(k => { const v = map[k]; if (v && typeof v === 'object' && keep(v)) out[k] = v; });
  return out;
}

module.exports = { deviceKey, withDevice, who, current };
