'use strict';
// The signed-in United Dairy person: a verified @uniteddairy.com Google account (the same rule as Operations).
const DOMAIN = 'uniteddairy.com';

/** The signed-in United Dairy person ({ uid, email }), or null. */
function unitedDairyUser(auth) {
  const token = auth && auth.token;
  const email = String(token && token.email || '').toLowerCase();
  const hdOk = !token || token.hd === undefined || String(token.hd).toLowerCase() === DOMAIN;
  if (!token || !email || token.email_verified !== true || !email.endsWith('@' + DOMAIN) || !hdOk) return null;
  return { uid: auth.uid, email };
}

module.exports = { DOMAIN, unitedDairyUser };
