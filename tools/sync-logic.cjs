// Copies the shared dispatch rules (functions/src/logic.js) to the screens (public/js/logic.js), so the server
// and the screens never disagree. functions/test/unit/logic-copy.test.js fails if the copy is out of date.
const fs = require('fs');
const path = require('path');
const from = path.join(__dirname, '..', 'functions', 'src', 'logic.js');
const to = path.join(__dirname, '..', 'public', 'js', 'logic.js');
fs.writeFileSync(to, fs.readFileSync(from));
console.log('public/js/logic.js updated');
