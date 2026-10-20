'use strict';
// Runs only inside `firebase emulators:exec` (npm run test:emulator): FIRESTORE_EMULATOR_HOST points at the local
// test database, so nothing here can reach a real Firebase project.
const admin = require('firebase-admin');

const PROJECT = 'demo-ud-distribution';
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run these tests with npm run test:emulator');

function db() {
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  return admin.firestore();
}

// The emulator answers 409 while a write is still going on (the run-day trigger, src/rundays.js, writes just after a run
// changes), so a clear waits a moment and tries again.
async function clear() {
  for (let tries = 0; ; tries++) {
    const res = await fetch('http://' + process.env.FIRESTORE_EMULATOR_HOST + '/emulator/v1/projects/' + PROJECT + '/databases/(default)/documents', { method: 'DELETE' });
    if (res.ok) return;
    if (res.status !== 409 || tries >= 20) throw new Error('could not clear the emulator: ' + res.status);
    await new Promise(r => setTimeout(r, 250));
  }
}

module.exports = { PROJECT, db, clear };
