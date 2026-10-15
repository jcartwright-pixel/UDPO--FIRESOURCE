/*
 * Reading a machine's own controller (PLC), READ-ONLY (Joe 10/14: the Blow Mold's jug count from its controller, never RedZone,
 * never a write to the machine). The line PC asks the controller for one number, the machine's running piece count, and the
 * app counts the pieces made since the last ask.
 *
 * Three ways in, which between them cover most plant controllers. Each one is built only from the protocol's READ request;
 * no write request exists in this file (test/unit/controllers.test.js checks the bytes):
 *   AB        Allen-Bradley ControlLogix / CompactLogix, EtherNet/IP port 44818: CIP Read Tag (service 0x4C) by tag name,
 *             routed through the backplane to the processor's slot (Unconnected Send).
 *   AB_MICRO  Allen-Bradley Micro800: the same Read Tag, sent straight to the controller (no slot).
 *   MODBUS    Modbus TCP port 502, any brand that speaks it: Read Holding Registers (function 3) or Read Input Registers (4).
 *   S7        Siemens S7-300/400/1200/1500, ISO-on-TCP port 102: S7 Read Var (function 0x04) from a data block or memory.
 *             An S7-1200/1500 needs PUT/GET allowed and the data block's optimized access off (the supplier sets that).
 *
 * readCount(cfg) -> Promise<number>. cfg: {brand, ip, port?, tag, slot?, size?, wordOrder?, unit?, rack?}.
 */
'use strict';

const net = require('net');

const BRANDS = ['AB', 'AB_MICRO', 'MODBUS', 'S7'];
const PORTS = { AB: 44818, AB_MICRO: 44818, MODBUS: 502, S7: 102 };
const TIMEOUT_MS = 5000;

class ControllerError extends Error {}

// One request and its answer over a fresh TCP connection. exchange(sock, send, want) runs the conversation: send(buf) writes,
// want() waits for the next whole answer (frame(buf) says how long an answer is once enough bytes have come).
function talk(host, port, frame, convo) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port });
    let buf = Buffer.alloc(0), waiting = null, done = false;
    const finish = (err, v) => { if (done) return; done = true; clearTimeout(timer); sock.destroy(); if (err) reject(err); else resolve(v); };
    const timer = setTimeout(() => finish(new ControllerError('No answer from the controller at ' + host + ':' + port + ' within ' + TIMEOUT_MS / 1000 + ' seconds.')), TIMEOUT_MS);
    const pump = () => {
      if (!waiting) return;
      const n = frame(buf);
      if (n && buf.length >= n) { const one = buf.subarray(0, n); buf = buf.subarray(n); const w = waiting; waiting = null; w(one); }
    };
    sock.on('data', d => { buf = Buffer.concat([buf, d]); pump(); });
    sock.on('error', e => finish(new ControllerError('Could not reach the controller at ' + host + ':' + port + ' (' + (e.code || e.message) + ').')));
    sock.on('close', () => finish(new ControllerError('The controller at ' + host + ':' + port + ' closed the connection.')));
    sock.on('connect', () => {
      const send = (b) => sock.write(b);
      const want = () => new Promise(r => { waiting = r; pump(); });
      convo(send, want).then(v => finish(null, v), e => finish(e));
    });
  });
}

// ---------- Modbus TCP ----------
// "40001" or "400001" = holding register 1 (address 0); "30001" = input register 1; "HR 100" / "IR 100" = address 100;
// a plain number is a holding register's address (0-based, as most manuals list them).
function modbusAddress(tag) {
  const t = String(tag || '').trim().toUpperCase();
  let m = /^(HR|IR)\s*:?\s*(\d{1,5})$/.exec(t);
  if (m) return { fc: m[1] === 'HR' ? 3 : 4, addr: Number(m[2]) };
  m = /^([34])(\d{4,5})$/.exec(t);
  if (m && Number(m[2]) >= 1) return { fc: m[1] === '4' ? 3 : 4, addr: Number(m[2]) - 1 };
  m = /^(\d{1,5})$/.exec(t);
  if (m) return { fc: 3, addr: Number(m[1]) };
  return null;
}
function modbusRequest(a, words, unit, id) {
  if (a.fc !== 3 && a.fc !== 4) throw new ControllerError('Only Modbus read functions 3 and 4 are allowed.');
  const b = Buffer.alloc(12);
  b.writeUInt16BE(id & 0xffff, 0); b.writeUInt16BE(0, 2); b.writeUInt16BE(6, 4); b.writeUInt8(unit & 0xff, 6);
  b.writeUInt8(a.fc, 7); b.writeUInt16BE(a.addr & 0xffff, 8); b.writeUInt16BE(words, 10);
  return b;
}
const MODBUS_ERRORS = { 1: 'the controller does not allow that read', 2: 'there is no register at that number', 3: 'the read was refused', 4: 'the controller had a fault', 11: 'the gateway got no answer from the device behind it' };
function modbusValue(res, words, wordOrder) {
  const fc = res.readUInt8(7);
  if (fc & 0x80) { const code = res.readUInt8(8); throw new ControllerError('Modbus error ' + code + ': ' + (MODBUS_ERRORS[code] || 'refused') + '.'); }
  if (res.readUInt8(8) < words * 2) throw new ControllerError('The controller sent too few bytes.');
  if (words === 1) return res.readUInt16BE(9);
  const a = res.readUInt16BE(9), b = res.readUInt16BE(11);
  return wordOrder === 'LOW_FIRST' ? b * 65536 + a : a * 65536 + b;
}
async function readModbus(cfg) {
  const a = modbusAddress(cfg.tag);
  if (!a) throw new ControllerError('Type the register like 40001, 30001 or HR 100.');
  const words = Number(cfg.size) === 16 ? 1 : 2, unit = cfg.unit === null || cfg.unit === undefined || cfg.unit === '' ? 1 : Number(cfg.unit);
  return talk(cfg.ip, Number(cfg.port) || 502, b => (b.length >= 6 ? 6 + b.readUInt16BE(4) : 0), async (send, want) => {
    send(modbusRequest(a, words, unit, 1));
    return modbusValue(await want(), words, cfg.wordOrder);
  });
}

// ---------- Allen-Bradley EtherNet/IP (CIP) ----------
function encap(command, session, data) {
  const h = Buffer.alloc(24);
  h.writeUInt16LE(command, 0); h.writeUInt16LE(data.length, 2); h.writeUInt32LE(session >>> 0, 4);
  return Buffer.concat([h, data]);
}
// "Line_Count", "Program:MainProgram.Jugs", "Counter1.ACC", "Counts[3]" -> the CIP request path.
function tagPath(tag) {
  const t = String(tag || '').trim();
  if (!t || t.length > 200 || !/^[A-Za-z_:][A-Za-z0-9_:.\[\]]*$/.test(t)) return null;
  const parts = [];
  const re = /(Program:[A-Za-z_][A-Za-z0-9_]*|[A-Za-z_][A-Za-z0-9_]*)((?:\[\d+\])*)\.?/g;
  let m, used = 0;
  while ((m = re.exec(t)) && m[0]) {
    if (m.index !== used) return null;
    used += m[0].length;
    const name = Buffer.from(m[1], 'ascii');
    const seg = [0x91, name.length, ...name];
    if (name.length % 2) seg.push(0);
    parts.push(...seg);
    (m[2].match(/\d+/g) || []).forEach(x => {
      const i = Number(x);
      if (i < 256) parts.push(0x28, i); else if (i < 65536) parts.push(0x29, 0, i & 0xff, i >> 8); else parts.push(0x2a, 0, i & 0xff, (i >> 8) & 0xff, (i >> 16) & 0xff, (i >>> 24) & 0xff);
    });
  }
  if (used !== t.length) return null;
  return Buffer.from(parts);
}
function readTagRequest(path) {
  const b = Buffer.alloc(2 + path.length + 2);
  b.writeUInt8(0x4c, 0); b.writeUInt8(path.length / 2, 1); path.copy(b, 2); b.writeUInt16LE(1, 2 + path.length);
  return b;
}
// Through the Connection Manager to the processor in a slot (ControlLogix / CompactLogix); Micro800 takes it directly.
function unconnectedSend(msg, slot) {
  const head = Buffer.from([0x52, 0x02, 0x20, 0x06, 0x24, 0x01, 0x0a, 0x0e, msg.length & 0xff, msg.length >> 8]);
  const pad = msg.length % 2 ? Buffer.from([0]) : Buffer.alloc(0);
  return Buffer.concat([head, msg, pad, Buffer.from([0x01, 0x00, 0x01, Number(slot) & 0xff])]);
}
function sendRR(session, cip) {
  const d = Buffer.alloc(16);
  d.writeUInt32LE(0, 0); d.writeUInt16LE(10, 4); d.writeUInt16LE(2, 6);
  d.writeUInt16LE(0x0000, 8); d.writeUInt16LE(0, 10); d.writeUInt16LE(0x00b2, 12); d.writeUInt16LE(cip.length, 14);
  return encap(0x006f, session, Buffer.concat([d, cip]));
}
const CIP_TYPES = { 0xc1: [1, 'readUInt8'], 0xc2: [1, 'readInt8'], 0xc3: [2, 'readInt16LE'], 0xc4: [4, 'readInt32LE'], 0xc6: [1, 'readUInt8'],
  0xc7: [2, 'readUInt16LE'], 0xc8: [4, 'readUInt32LE'], 0xca: [4, 'readFloatLE'], 0xd3: [4, 'readUInt32LE'] };
const CIP_STATUS = { 0x04: 'the tag name is not in the controller', 0x05: 'the tag name is not in the controller', 0x08: 'the controller does not allow reading that', 0x01: 'the connection was refused (check the slot)', 0x26: 'the tag path is wrong' };
function cipValue(res) {
  if (res.readUInt32LE(8) !== 0) throw new ControllerError('The controller refused the request (EtherNet/IP status ' + res.readUInt32LE(8) + ').');
  let o = 24 + 6;
  const items = res.readUInt16LE(o); o += 2;
  let data = null;
  for (let i = 0; i < items; i++) {
    const type = res.readUInt16LE(o), len = res.readUInt16LE(o + 2);
    if (type === 0x00b2) data = res.subarray(o + 4, o + 4 + len);
    o += 4 + len;
  }
  if (!data || data.length < 4) throw new ControllerError('The controller sent no data.');
  const status = data.readUInt8(2), ext = data.readUInt8(3);
  if (status !== 0) throw new ControllerError('The controller said ' + (CIP_STATUS[status] || 'no (CIP status ' + status + ')') + '.');
  const v = data.subarray(4 + ext * 2), type = v.readUInt16LE(0);
  if (type === 0x02a0) throw new ControllerError('That tag is a structure. Add the number inside it, like Counter1.ACC.');
  const t = CIP_TYPES[type];
  if (!t || v.length < 2 + t[0]) throw new ControllerError('That tag is not a number the app can count (type ' + type.toString(16) + ').');
  return v[t[1]](2);
}
async function readAB(cfg, micro) {
  const path = tagPath(cfg.tag);
  if (!path) throw new ControllerError('Type the tag name as it shows in the controller program, like Jug_Count or Counter1.ACC.');
  const frame = b => (b.length >= 24 ? 24 + b.readUInt16LE(2) : 0);
  return talk(cfg.ip, Number(cfg.port) || 44818, frame, async (send, want) => {
    send(encap(0x0065, 0, Buffer.from([1, 0, 0, 0])));
    const reg = await want();
    if (reg.readUInt32LE(8) !== 0) throw new ControllerError('The controller would not open a session.');
    const session = reg.readUInt32LE(4), msg = readTagRequest(path);
    send(sendRR(session, micro ? msg : unconnectedSend(msg, Number(cfg.slot) || 0)));
    const v = cipValue(await want());
    send(encap(0x0066, session, Buffer.alloc(0)));
    return v;
  });
}

// ---------- Siemens S7 ----------
// "DB10.DBD4" (4 bytes), "DB10.DBW2" (2 bytes), "MD20", "MW20".
function s7Address(tag) {
  const t = String(tag || '').trim().toUpperCase().replace(/\s+/g, '');
  let m = /^DB(\d{1,5})\.DB([DW])(\d{1,5})$/.exec(t);
  if (m) return { area: 0x84, db: Number(m[1]), start: Number(m[3]), bytes: m[2] === 'D' ? 4 : 2 };
  m = /^M([DW])(\d{1,5})$/.exec(t);
  if (m) return { area: 0x83, db: 0, start: Number(m[2]), bytes: m[1] === 'D' ? 4 : 2 };
  return null;
}
const tpkt = (body) => { const h = Buffer.from([3, 0, 0, 0]); h.writeUInt16BE(body.length + 4, 2); return Buffer.concat([h, body]); };
function s7Connect(rack, slot) {
  return tpkt(Buffer.from([0x11, 0xe0, 0, 0, 0, 1, 0, 0xc0, 1, 0x0a, 0xc1, 2, 1, 0, 0xc2, 2, 1, ((Number(rack) || 0) * 0x20 + (Number(slot) || 0)) & 0xff]));
}
const s7Setup = () => tpkt(Buffer.from([2, 0xf0, 0x80, 0x32, 1, 0, 0, 0, 1, 0, 8, 0, 0, 0xf0, 0, 0, 1, 0, 1, 0x03, 0xc0]));
function s7ReadRequest(a) {
  const b = Buffer.from([2, 0xf0, 0x80, 0x32, 1, 0, 0, 0, 2, 0, 14, 0, 0,
    0x04, 1, 0x12, 0x0a, 0x10, 0x02, 0, a.bytes, (a.db >> 8) & 0xff, a.db & 0xff, a.area, 0, 0, 0]);
  const bit = a.start * 8;
  b[24] = (bit >> 16) & 0xff; b[25] = (bit >> 8) & 0xff; b[26] = bit & 0xff;
  return tpkt(b);
}
const S7_RETURN = { 0x05: 'that address is not in the controller (check the data block number and offset)', 0x0a: 'that data block does not exist', 0x03: 'reading is not allowed (allow PUT/GET, and turn optimized access off on the data block)' };
function s7Value(res, a) {
  // TPKT 4 + COTP 3 + S7 header 12 (ack data) + params 2 + item: return code, transport size, length, data.
  const o = 4 + 3;
  if (res.readUInt8(o + 1) !== 3) throw new ControllerError('The controller did not answer the read.');
  const errClass = res.readUInt8(o + 10), errCode = res.readUInt8(o + 11);
  if (errClass || errCode) throw new ControllerError('The controller refused the read (S7 error ' + errClass + '/' + errCode + '). Allow PUT/GET in the controller.');
  const d = o + 12 + 2, rc = res.readUInt8(d);
  if (rc !== 0xff) throw new ControllerError('The controller said ' + (S7_RETURN[rc] || 'no (S7 return code ' + rc + ')') + '.');
  return a.bytes === 4 ? res.readUInt32BE(d + 4) : res.readUInt16BE(d + 4);
}
async function readS7(cfg) {
  const a = s7Address(cfg.tag);
  if (!a) throw new ControllerError('Type the address like DB10.DBD4 (a data block\'s 4 bytes) or MD20.');
  const frame = b => (b.length >= 4 ? b.readUInt16BE(2) : 0);
  const slot = cfg.slot === '' || cfg.slot === undefined || cfg.slot === null ? 1 : Number(cfg.slot);
  return talk(cfg.ip, Number(cfg.port) || 102, frame, async (send, want) => {
    send(s7Connect(cfg.rack, slot));
    const cc = await want();
    if (cc.readUInt8(5) !== 0xd0) throw new ControllerError('The controller would not connect (check the rack and slot).');
    send(s7Setup());
    await want();
    send(s7ReadRequest(a));
    return s7Value(await want(), a);
  });
}

function readCount(cfg) {
  const c = cfg || {};
  if (!c.ip) return Promise.reject(new ControllerError('Type the controller\'s IP address on Line Targets.'));
  if (c.brand === 'MODBUS') return readModbus(c);
  if (c.brand === 'AB' || c.brand === 'AB_MICRO') return readAB(c, c.brand === 'AB_MICRO');
  if (c.brand === 'S7') return readS7(c);
  return Promise.reject(new ControllerError('Pick the controller\'s brand on Line Targets.'));
}

module.exports = { BRANDS, PORTS, ControllerError, readCount, modbusAddress, modbusRequest, modbusValue, tagPath, readTagRequest, unconnectedSend, sendRR, encap, cipValue,
  s7Address, s7Connect, s7Setup, s7ReadRequest, s7Value };
