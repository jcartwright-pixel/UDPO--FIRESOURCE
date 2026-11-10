'use strict';
/*
 * Loaded with node -r by the two Plant Station screen tests (plant-station-boxing, plant-load-numbers), 11-10-26.
 * On GitHub's test machines the test program, at the Plant Station step, locked up and filled the machine's memory (13 GB in
 * 20 seconds, with no timer or report able to run), so the whole job was killed and no check finished. Here, one message
 * from the test browser that grows past 50 MB stops the test at once with the start of that message, so a lock-up shows
 * as a plain failure that says what the browser was sending. With this loaded the lock-up has not come back on GitHub's
 * machines (4 runs); tools/memory-guard.sh still stops any screen test past 3 GB.
 */
const path = require('path');
const core = path.dirname(require.resolve('playwright-core/package.json'));
const { PipeTransport } = require(path.join(core, 'lib/server/pipeTransport.js'));
const dispatch = PipeTransport.prototype._dispatch;
const LIMIT = 50e6;
PipeTransport.prototype._dispatch = function (buffer) {
  if (buffer.indexOf('\0') === -1) {
    const size = this._pendingBuffers.reduce((a, b) => a + b.length, 0) + buffer.length;
    if (size > LIMIT) {
      const head = Buffer.concat(this._pendingBuffers.slice(0, 2)).slice(0, 1500).toString();
      console.error('STUCK one message from the test browser is over ' + Math.round(size / 1e6) + ' MB and still coming. It starts: ' + head);
      process.exit(3);
    }
  }
  return dispatch.call(this, buffer);
};
