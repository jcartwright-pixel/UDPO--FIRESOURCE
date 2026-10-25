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
// An email with pictures goes to Gmail's upload address (whole messages up to 35 MB; the plain address takes far less).
const UPLOAD_URL = 'https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media';

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

// Joe 10/25: an email sent with text only (repair emails, the access link) showed a subject and a blank body, since
// mail programs show the HTML version and it went out empty. With no HTML given, the HTML version is the text itself.
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const textHtml = t => '<div style="font-family:Arial,sans-serif;font-size:14px;white-space:pre-wrap">' + esc(t || '').replace(/\r?\n/g, '<br>') + '</div>';

// The message as Gmail takes it: text and HTML versions of the same email, both UTF-8. Joe 10/23: with attachments
// (walkthrough pictures, [{filename, contentType, base64}]) the two versions go first and each attachment after them.
function buildMime({ from, fromName, to, subject, text, html, boundary, attachments }) {
  const b = boundary || 'udpo_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
  const files = (attachments || []).filter(a => a && a.base64);
  const sender = fromName ? headerText(fromName) + ' <' + from + '>' : from;
  const body = [
    '--' + b,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(b64(text || '')),
    '--' + b,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(b64(html || textHtml(text))),
    '--' + b + '--'
  ];
  const head = ['From: ' + sender, 'To: ' + to.join(', '), 'Subject: ' + headerText(subject), 'MIME-Version: 1.0'];
  if (!files.length) return head.concat(['Content-Type: multipart/alternative; boundary="' + b + '"', ''], body, ['']).join('\r\n');
  // A picture with a contentId shows in the email itself (the HTML's <img src="cid:...">), so the email is multipart/related;
  // Gmail still offers each one to download.
  const inline = files.some(a => a.contentId), m = (inline ? 'rel_' : 'mix_') + b;
  const lines = head.concat([inline ? 'Content-Type: multipart/related; type="multipart/alternative"; boundary="' + m + '"' : 'Content-Type: multipart/mixed; boundary="' + m + '"', '', '--' + m, 'Content-Type: multipart/alternative; boundary="' + b + '"', ''], body);
  files.forEach(a => {
    const name = String(a.filename || 'picture.jpg').replace(/["\\\r\n]+/g, ' ');
    const id = a.contentId ? String(a.contentId).replace(/[^A-Za-z0-9_.@-]/g, '') : '';
    lines.push('--' + m, 'Content-Type: ' + (a.contentType || 'application/octet-stream') + '; name="' + name + '"', (id ? 'Content-Disposition: inline' : 'Content-Disposition: attachment') + '; filename="' + name + '"');
    if (id) lines.push('Content-ID: <' + id + '>');
    lines.push('Content-Transfer-Encoding: base64', '', wrap(String(a.base64).replace(/\s+/g, '')));
  });
  lines.push('--' + m + '--', '');
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

// A one-hour Gmail token for `sub` (a United Dairy mailbox) with one scope, through domain-wide delegation.
async function gmailToken(sub, scope, d) {
  const fetchFn = d.fetch || fetch;
  const signer = d.signer || await googleSigner();
  const now = Math.floor((d.now || Date.now()) / 1000);
  const assertion = await signer.signJwt({ iss: signer.account, sub, scope, aud: TOKEN_URL, iat: now, exp: now + 3600 });
  const tokenRes = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + encodeURIComponent(assertion)
  });
  const token = await readJson(tokenRes);
  if (!tokenRes.ok || !token.access_token) {
    if (token.error === 'unauthorized_client') throw new MailError('NOT_DELEGATED', 'Google Workspace has not yet allowed the app this Gmail access for ' + sub);
    if (token.error === 'invalid_grant') throw new MailError('BAD_SENDER', sub + ' is not a United Dairy Google account Gmail can use');
    throw new MailError('TOKEN', 'Google refused the email sign-in (' + (token.error_description || token.error || tokenRes.status) + ')');
  }
  return token.access_token;
}

const GMAIL_READ = 'https://www.googleapis.com/auth/gmail.readonly';
const LIST_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';
const unb64 = (s) => Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
function bodyText(part) {
  if (!part) return '';
  if (part.mimeType === 'text/plain' && part.body && part.body.data) return unb64(part.body.data);
  for (const p of part.parts || []) { const t = bodyText(p); if (t) return t; }
  if (part.mimeType === 'text/html' && part.body && part.body.data) return unb64(part.body.data).replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  return '';
}

/*
 * Driver Check-In Email (admintools.js): reads `owner`'s mailbox, read only (gmail.readonly), for the messages a Gmail search
 * finds. Needs the same domain-wide delegation as sending, with the gmail.readonly scope added.
 * Returns [{id, internalDate, from, to, subject, body}].
 */
async function readMail({ owner, query, max }, deps) {
  const d = deps || {}, fetchFn = d.fetch || fetch;
  const sub = addresses([owner])[0];
  if (!sub) throw new MailError('NO_OWNER', 'No mailbox owner is set; turn the check on and Save first');
  const token = await gmailToken(sub, GMAIL_READ, d);
  const get = async (url) => {
    const res = await fetchFn(url, { headers: { Authorization: 'Bearer ' + token } });
    const body = await readJson(res);
    if (!res.ok) throw new MailError(res.status === 403 ? 'GMAIL_OFF' : 'READ', 'Gmail did not answer (' + ((body.error && body.error.message) || res.status) + ')');
    return body;
  };
  const ids = [];
  let page = '';
  do {
    const list = await get(LIST_URL + '?maxResults=100&q=' + encodeURIComponent(query) + (page ? '&pageToken=' + encodeURIComponent(page) : ''));
    (list.messages || []).forEach(m => ids.push(m.id));
    page = list.nextPageToken || '';
  } while (page && ids.length < (max || 500));
  const out = [];
  for (const id of ids.slice(0, max || 500)) {
    const m = await get(LIST_URL + '/' + encodeURIComponent(id) + '?format=full');
    const h = {};
    ((m.payload && m.payload.headers) || []).forEach(x => { h[String(x.name).toLowerCase()] = x.value; });
    out.push({ id: m.id, internalDate: Number(m.internalDate) || 0, from: h.from || '', to: [h.to, h.cc, h['delivered-to']].filter(Boolean).join(', '), subject: h.subject || '', body: bodyText(m.payload) });
  }
  return out;
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
  const token = await gmailToken(from, GMAIL_SEND, d);
  const files = (message.attachments || []).filter(a => a && a.base64);
  const raw = buildMime({ from, fromName: message.fromName, to, subject: message.subject, text: message.text, html: message.html, attachments: files });
  const sendRes = files.length
    ? await fetchFn(UPLOAD_URL, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'message/rfc822' }, body: raw })
    : await fetchFn(SEND_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: b64url(raw) })
    });
  const sent = await readJson(sendRes);
  if (!sendRes.ok) {
    const why = (sent.error && sent.error.message) || sent.raw || sendRes.status;
    throw new MailError(sendRes.status === 403 ? 'GMAIL_OFF' : 'SEND', 'Gmail did not send it (' + why + ')');
  }
  return { id: sent.id || '', to };
}

module.exports = { sendMail, readMail, bodyText, buildMime, textHtml, addresses, headerText, MailError, GMAIL_SEND, GMAIL_READ };
