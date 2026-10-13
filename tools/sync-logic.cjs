// Copies the shared rule files from the server (functions/src) to the screens (public/js), so the server and the
// screens never disagree. Review item 78 (Joe 10/13): it used to copy only logic.js while the other seven were copied
// by hand; now it copies all eight. functions/test/unit/logic-copy.test.js fails if any copy is out of date.
const fs = require('fs');
const path = require('path');

const SHARED_FILES = [
  'logic.js',            // dispatch
  'board-rules.js',      // station boards
  'otr-core.js',         // over-the-road fleet
  'sc-core.js',          // service center fleet
  'plant-rules.js',      // plant checks
  'pmaint-rules.js',     // preventive maintenance
  'production-rules.js', // production
  'safety-rules.js',     // safety
];
const SRC = path.join(__dirname, '..', 'functions', 'src');
const DEST = path.join(__dirname, '..', 'public', 'js');

module.exports = { SHARED_FILES, SRC, DEST };

// Copy only when run (npm run sync-logic), not when the unit test reads the list.
if (require.main === module) {
  for (const name of SHARED_FILES) {
    fs.writeFileSync(path.join(DEST, name), fs.readFileSync(path.join(SRC, name)));
    console.log('public/js/' + name + ' updated');
  }
}
