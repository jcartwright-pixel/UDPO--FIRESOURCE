/*
 * Email from the United Dairy Google account, with no key or password stored anywhere.
 *
 * The app's own server account signs a short request ("send as MAIL_FROM, Gmail send only") through Google's IAM
 * signJwt service, trades it for a one-hour Gmail token, and hands the message to Gmail, which sends it from MAIL_FROM's
 * mailbox (it shows in that person's Sent folder, like the current app's MailApp email).
 *
 * Google allows this only after a Google Workspace administrator lets the server account send Gmail as United Dairy
 * users (Admin console > Security > API controls > Domain-wide delegation: the account's client ID with the scope
 * GMAIL_SEND). Until then Google answers "unauthorized_client" and the report says the Workspace step is still needed.
 */
'use strict';

const { GoogleAuth } = require('google-auth-library');

const GMAIL_SEND = 'https://www.googleapis.com/auth/gmail.send';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

class MailError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const b64 = s => Buffer.from(s, 'utf8').toString('base64');
const b64url = s => b64(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const wrap = s => s.replace(/(.{76})/g, '$1\r\n');

// A header value: plain ASCII as is, anything else as a UTF-8 encoded word. Line breaks are never allowed in a header.
function headerText(v) {
  const s = String(v || '').replace(/[\r\n]+/g, ' ').trim();
  return /^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + b64(s) + '?=';
}

const EMAIL = /^[^\s@<>(),;:"\[\]\\]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
function addresses(list) {
  const out = [];
  (Array.isArray(list) ? list : String(list || '').split(/[,;\s]+/)).forEach(a => {
    const s = String(a || '').trim().toLowerCase();
    if (EMAIL.test(s) && out.indexOf(s) < 0) out.push(s);
  });
  return out;
}

// The message as Gmail takes it: text and HTML versions of the same email, both UTF-8.
function buildMime({ from, fromName, to, subject, text, html, boundary }) {
  const b = boundary || 'udpo_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
  const sender = fromName ? headerText(fromName) + ' <' + from + '>' : from;
  const lines = [
    'From: ' + sender,
    'To: ' + to.join(', '),
    'Subject: ' + headerText(subject),
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="' + b + '"',
    '',
    '--' + b,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(b64(text || '')),
    '--' + b,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(b64(html || '')),
    '--' + b + '--',
    ''
  ];
  return lines.join('\r\n');
}

// The server account's own email, and a signer that signs as it (IAM Credentials signJwt; no key file).
async function googleSigner() {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const account = (await auth.getCredentials()).client_email;
  if (!account) throw new MailError('NO_ACCOUNT', 'The server account could not be found');
  const client = await auth.getClient();
  return {
    account,
    async signJwt(payload) {
      const url = 'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/' + encodeURIComponent(account) + ':signJwt';
      try {
        const res = await client.request({ url, method: 'POST', data: { payload: JSON.stringify(payload) } });
        return res.data.signedJwt;
      } catch (e) {
        const status = e.response && e.response.status;
        throw new MailError('SIGN', status === 403 ? 'The server account may not sign for itself yet (Service Account Token Creator)' : 'Signing failed: ' + (e.message || e));
      }
    }
  };
}

async function readJson(res) {
  const body = await res.text();
  try { return JSON.parse(body); } catch (e) { return { raw: body.slice(0, 300) }; }
}

// Sends one email as `from`. deps.signer / deps.fetch are swapped for fakes in the tests.
async function sendMail(message, deps) {
  const d = deps || {};
  const fetchFn = d.fetch || fetch;
  const to = addresses(message.to);
  if (!to.length) throw new MailError('NO_RECIPIENTS', 'No email address to send to');
  const from = addresses([message.from])[0];
  if (!from) throw new MailError('NO_SENDER', 'No sender address is set (MAIL_FROM)');
  const signer = d.signer || await googleSigner();
  const now = Math.floor((d.now || Date.now()) / 1000);
  const assertion = await signer.signJwt({ iss: signer.account, sub: from, scope: GMAIL_SEND, aud: TOKEN_URL, iat: now, exp: now + 3600 });
  const tokenRes = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + encodeURIComponent(assertion)
  });
  const token = await readJson(tokenRes);
  if (!tokenRes.ok || !token.access_token) {
    if (token.error === 'unauthorized_client') throw new MailError('NOT_DELEGATED', 'Google Workspace has not yet allowed the app to send Gmail as ' + from);
    if (token.error === 'invalid_grant') throw new MailError('BAD_SENDER', from + ' is not a United Dairy Google account Gmail can send from');
    throw new MailError('TOKEN', 'Google refused the email sign-in (' + (token.error_description || token.error || tokenRes.status) + ')');
  }
  const raw = buildMime({ from, fromName: message.fromName, to, subject: message.subject, text: message.text, html: message.html });
  const sendRes = await fetchFn(SEND_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token.access_token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: b64url(raw) })
  });
  const sent = await readJson(sendRes);
  if (!sendRes.ok) {
    const why = (sent.error && sent.error.message) || sent.raw || sendRes.status;
    throw new MailError(sendRes.status === 403 ? 'GMAIL_OFF' : 'SEND', 'Gmail did not send it (' + why + ')');
  }
  return { id: sent.id || '', to };
}

module.exports = { sendMail, buildMime, addresses, headerText, MailError, GMAIL_SEND };
