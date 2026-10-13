/*
 * Google's Firebase web code (sign-in, database, server calls), loaded from www.gstatic.com. Review item 82 (Joe 10/13):
 * the version is written in this one file. Every screen and script imports Firebase from here, never from gstatic itself.
 * To move to another version, change the four lines below and FIREBASE_VERSION together, and functions/package.json's
 * "firebase" (the copy the browser checks serve in gstatic's place); functions/test/unit/firebase-version.test.js fails if
 * any of them differ or a file outside this one names a version.
 */
export * from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
export * from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
export * from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
export * from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-functions.js';

export const FIREBASE_VERSION = '12.18.0';

// The four files' addresses, for the screens kept on the device with no signal (js/offline-saves.js, js/phone-queue.js, sw.js).
export const FIREBASE_FILES = ['app', 'auth', 'firestore', 'functions']
  .map(n => 'https://www.gstatic.com/firebasejs/' + FIREBASE_VERSION + '/firebase-' + n + '.js');
