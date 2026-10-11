/*
 * United Dairy Distribution app: who may use it.
 *
 * Only Google accounts of United Dairy (@uniteddairy.com) with a verified address get in. The same rule is in
 * firestore.rules for reading and here for every call to the server.
 */
'use strict';

const ALLOWED_DOMAIN = 'uniteddairy.com';

function unitedDairyUser(auth) {
  const token = auth && auth.token;
  const email = String(token && token.email || '').toLowerCase();
  const domainOk = email.endsWith('@' + ALLOWED_DOMAIN);
  // Google sign-in also carries the Workspace domain ("hd"); when present it must match too.
  const hdOk = !token || token.hd === undefined || String(token.hd).toLowerCase() === ALLOWED_DOMAIN;
  if (!token || !email || token.email_verified !== true || !domainOk || !hdOk) return null;
  return { uid: auth.uid, email };
}

module.exports = { ALLOWED_DOMAIN, unitedDairyUser };
