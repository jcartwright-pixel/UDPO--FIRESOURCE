#!/usr/bin/env node
/*
 * A reading device's PC program (Joe 10/11): passes each piece a reader, camera or scanner sees to the app. Today a Plant
 * Production line's label reader; later a Receiving station's handheld scanner (room to grow), the same program and door.
 *
 * Most fixed barcode readers and smart cameras (Cognex, Keyence, Datalogic, Zebra, Hikrobot) can send each read as one line of
 * plain text over the network. Set the reader to send "UPC" or "UPC,DATE" (the code date it read) followed by a new line, as a
 * TCP server on a port; this program connects to it, gathers the reads, and every few seconds posts them to the app:
 *
 *   POST <address>   Authorization: Bearer <device key>   {"device": "<device id>", "reads": [{"upc": "070852503050", "date": "OCT 25"}]}
 *
 * The address, the device id (a line reader's is its line id) and the key are on Line Targets (Label reader, administrators).
 * Needs Node 18 or newer; nothing to install. Reads that could not be sent wait and go with the next send.
 *
 *   node bridge.cjs --address https://us-east4-ud-distribution.cloudfunctions.net/deviceReads --device ut_prod_gallon_filler \
 *                   --key <device key> --reader 192.168.1.50:23
 *   node bridge.cjs ... --stdin      reads typed or piped in (one per line): a USB handheld scanner types this way too
 *
 * A machine's own controller (Joe 10/14, the Blow Mold), READ-ONLY: --controller in place of --reader. The controller's brand,
 * IP address and the tag or register of each reading (jug count, speed, temperature) are set on Line Targets; this program
 * fetches them with its key, reads the controller every few seconds (controllers.cjs only has read requests) and posts
 *
 *   {"device": "<line id>", "controller": {"count": 1284330, "speed": 42, "temp": 4312, "errors": {}}}
 *
 * and answers Line Targets' Test read. Nothing is ever written to the machine.
 *
 *   node bridge.cjs --address <deviceReads address> --device ut_prod_blow_mold --key <device key> --controller
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

// The controller loop: read every reading set up on Line Targets, send them, pick up setup changes and Test reads.
function startController(o, deps) {
  const C = (deps && deps.controllers) || require('./controllers.cjs');
  const post = async (body) => {
    const res = await fetch(o.address, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + o.key }, body: JSON.stringify(Object.assign({ device: o.device }, body)) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || ('HTTP ' + res.status));
    return out;
  };
  let config = null, answered = '', busy = false, lastNote = '';
  const say = (t) => { if (t !== lastNote) { console.log(new Date().toLocaleTimeString(), t); lastNote = t; } };
  const readOne = (k) => C.readCount(Object.assign({}, config, config.readings[k], { port: config.port || undefined }));
  async function cycle() {
    if (busy) return;
    busy = true;
    try {
      const reading = {}, errors = {};
      if (config) {
        for (const k of Object.keys(config.readings || {})) {
          try { reading[k] = await readOne(k); } catch (e) { errors[k] = e.message; }
        }
      }
      const out = await post(config ? { controller: Object.assign(reading, { errors }) } : { op: 'config' });
      config = out.config || null;
      if (!config) say('Waiting for the setup on Line Targets, or Administration > Case Counters for a case counter (brand, IP address and the tags).');
      else say('Reading ' + config.brand + ' at ' + config.ip + (Object.keys(errors).length ? ': ' + Object.values(errors).join(' ') : ', count ' + out.count));
      // A Test read asked on Line Targets: read that one reading now and send back the number (or why not).
      if (out.testAsk && out.testAsk.at !== answered) {
        answered = out.testAsk.at;
        const k = out.testAsk.reading, test = { askAt: out.testAsk.at, reading: k };
        try {
          if (!config || !config.readings[k]) throw new Error('That reading is not set up on Line Targets yet.');
          test.value = await readOne(k);
        } catch (e) { test.error = e.message; }
        await post({ test });
        console.log(new Date().toLocaleTimeString(), 'Test read of', k + ':', test.error || test.value);
      }
    } catch (e) {
      console.error(new Date().toLocaleTimeString(), 'not sent, will retry:', e.message);
    } finally { busy = false; }
  }
  cycle();
  return setInterval(cycle, (Number(o.every) || 5) * 1000);
}

function start(o) {
  const pending = [];
  let sending = false;
  async function send() {
    if (sending || !pending.length) return;
    sending = true;
    const batch = pending.splice(0, 2000);
    try {
      const res = await fetch(o.address, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + o.key }, body: JSON.stringify({ device: o.device, reads: batch }) });
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
  if (!o.device) o.device = o.line;
  if (!o.address || !o.device || !o.key || (!o.reader && !o.stdin && !o.controller)) {
    console.error('Usage: node bridge.cjs --address <deviceReads address> --device <device id> --key <device key> (--reader <ip:port> | --stdin | --controller) [--every 5]');
    process.exit(1);
  }
  if (o.controller) startController(o); else start(o);
}

module.exports = { parseRead, args, startController };
