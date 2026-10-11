#!/usr/bin/env node
/*
 * The line PC's program (Plant Production label reader, Joe 10/11): passes each jug the reader sees to the app.
 *
 * Most fixed barcode readers and smart cameras (Cognex, Keyence, Datalogic, Zebra, Hikrobot) can send each read as one line of
 * plain text over the network. Set the reader to send "UPC" or "UPC,DATE" (the code date it read) followed by a new line, as a
 * TCP server on a port; this program connects to it, gathers the reads, and every few seconds posts them to the app:
 *
 *   POST <address>   Authorization: Bearer <line key>   {"line": "<line id>", "reads": [{"upc": "070852503050", "date": "OCT 25"}]}
 *
 * The address, the line id and the key are on Line Targets (Label reader, administrators). Needs Node 18 or newer; nothing to
 * install. Reads that could not be sent wait and go with the next send.
 *
 *   node bridge.cjs --address https://us-east4-ud-distribution.cloudfunctions.net/lineReads --line ut_prod_gallon_filler \
 *                   --key <line key> --reader 192.168.1.50:23
 *   node bridge.cjs ... --stdin      reads typed or piped in (one per line), to try it without a reader
 */
'use strict';

const net = require('net');
const readline = require('readline');

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z-]+)$/.exec(argv[i]);
    if (!m) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[m[1]] = true; else { out[m[1]] = next; i++; }
  }
  return out;
}

// One line from the reader -> {upc, date}. "070852503050", "070852503050,OCT 25" or "070852503050;10/25"; a no-read
// (NOREAD, ERROR, an empty line) counts as a jug the reader could not read.
function parseRead(line) {
  const t = String(line || '').trim();
  if (!t) return null;
  if (/^(NOREAD|NO READ|ERROR|FAIL)/i.test(t)) return { upc: '', date: '' };
  const [upc, date] = t.split(/[,;\t|]/);
  return { upc: String(upc || '').replace(/\D/g, ''), date: String(date || '').trim() };
}

function start(o) {
  const pending = [];
  let sending = false;
  async function send() {
    if (sending || !pending.length) return;
    sending = true;
    const batch = pending.splice(0, 2000);
    try {
      const res = await fetch(o.address, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + o.key }, body: JSON.stringify({ line: o.line, reads: batch }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
      console.log(new Date().toLocaleTimeString(), 'sent', batch.length, 'jugs; shift count', body.count, body.product ? '(' + body.product + ')' : '');
    } catch (e) {
      pending.unshift(...batch);
      console.error(new Date().toLocaleTimeString(), 'not sent, will retry:', e.message);
    } finally { sending = false; }
  }
  setInterval(send, (Number(o.every) || 5) * 1000);
  const take = (line) => { const r = parseRead(line); if (r) pending.push(r); };
  if (o.stdin) {
    readline.createInterface({ input: process.stdin }).on('line', take);
    return;
  }
  const [host, port] = String(o.reader).split(':');
  const connect = () => {
    const sock = net.connect(Number(port) || 23, host);
    sock.setKeepAlive(true, 10000);
    readline.createInterface({ input: sock }).on('line', take);
    sock.on('connect', () => console.log('Connected to the reader at', o.reader));
    sock.on('error', e => console.error('Reader:', e.message));
    sock.on('close', () => { console.error('Reader connection closed; trying again in 5 seconds'); setTimeout(connect, 5000); });
  };
  connect();
}

if (require.main === module) {
  const o = args(process.argv.slice(2));
  if (!o.address || !o.line || !o.key || (!o.reader && !o.stdin)) {
    console.error('Usage: node bridge.cjs --address <lineReads address> --line <line id> --key <line key> (--reader <ip:port> | --stdin) [--every 5]');
    process.exit(1);
  }
  start(o);
}

module.exports = { parseRead, args };
