'use strict';
/*
 * Diagnostic only (11-10-26): counts the browser's messages to this test program by kind and, once the program passes
 * 1.5 GB, prints the counts (lines starting TRACE) and stops it. Loaded with node -r.
 */
const path = require('path');
const core = path.dirname(require.resolve('playwright-core/package.json'));
const CR = require(path.join(core, 'lib/server/chromium/crConnection.js'));
const CL = require(path.join(core, 'lib/client/connection.js'));
const cdp = new Map(), client = new Map();
const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
const crOn = CR.CRConnection.prototype._onMessage;
CR.CRConnection.prototype._onMessage = function (message) { bump(cdp, message.method || 'reply'); return crOn.call(this, message); };
const clDispatch = CL.Connection.prototype.dispatch;
CL.Connection.prototype.dispatch = function (message) { bump(client, message.method || 'reply'); return clDispatch.call(this, message); };
const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => k + '=' + v).join(', ');
let last = 0;
setInterval(() => {
  const rss = process.memoryUsage().rss;
  const sum = [...cdp.values()].reduce((a, b) => a + b, 0);
  if (sum - last > 5000 || rss > 1.5e9 || process.env.TRACE_ALL) console.log('TRACE ' + Math.round(rss / 1048576) + ' MB; browser: ' + top(cdp) + ' | test: ' + top(client));
  last = sum;
  if (rss > 1.5e9) process.exit(3);
}, 1000).unref();
