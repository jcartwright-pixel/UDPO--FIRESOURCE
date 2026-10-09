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

async function clear() {
  const res = await fetch('http://' + process.env.FIRESTORE_EMULATOR_HOST + '/emulator/v1/projects/' + PROJECT + '/databases/(default)/documents', { method: 'DELETE' });
  if (!res.ok) throw new Error('could not clear the emulator: ' + res.status);
}

module.exports = { PROJECT, db, clear };
