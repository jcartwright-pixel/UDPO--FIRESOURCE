// Writes public/version.json before each hosting deploy (firebase.json predeploy): the commit being deployed and when.
// Every screen reads it again every few minutes; a different commit shows the "Update ready" banner (public/js/shell.js).
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
let commit = process.env.GITHUB_SHA || '';
if (!commit) { try { commit = execSync('git rev-parse HEAD', { cwd: __dirname }).toString().trim(); } catch (e) { commit = 'local-' + Date.now(); } }
const at = new Date().toISOString();
const out = { commit: commit.slice(0, 12), at, label: 'Hub · ' + at.slice(0, 16).replace('T', ' ') + ' UTC' };
fs.writeFileSync(path.join(__dirname, '..', 'public', 'version.json'), JSON.stringify(out) + '\n');
console.log('version.json: ' + out.commit);
