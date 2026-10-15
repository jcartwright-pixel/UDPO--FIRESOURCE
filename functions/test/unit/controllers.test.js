'use strict';
// Reading a machine's own controller (Joe 10/14, the Blow Mold): the line PC's three ways in (Allen-Bradley EtherNet/IP,
// Modbus TCP, Siemens S7), each against a pretend controller on this computer, and only ever a READ request.
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const C = require('../../../tools/device-bridge/controllers.cjs');
const B = require('../../../tools/device-bridge/bridge.cjs');

// A pretend controller: handle(buf) returns [answer, bytesUsed] once a whole request has come, or null to wait.
function fake(handle) {
  const seen = [];
  const server = net.createServer(sock => {
    let buf = Buffer.alloc(0);
    sock.on('data', d => {
      buf = Buffer.concat([buf, d]);
      for (let r = handle(buf, seen); r; r = handle(buf, seen)) { seen.push(Buffer.from(buf.subarray(0, r[1]))); buf = buf.subarray(r[1]); if (r[0]) sock.write(r[0]); }
    });
    sock.on('error', () => {});
  });
  return new Promise(res => server.listen(0, '127.0.0.1', () => res({ port: server.address().port, seen, close: () => new Promise(r => server.close(r)) })));
}

// Modbus TCP: holding and input registers.
function modbusServer(regs) {
  return fake(buf => {
    if (buf.length < 12) return null;
    const id = buf.readUInt16BE(0), unit = buf[6], fc = buf[7], addr = buf.readUInt16BE(8), qty = buf.readUInt16BE(10);
    if (fc !== 3 && fc !== 4) { const e = Buffer.from([0, 0, 0, 0, 0, 3, unit, fc | 0x80, 1]); e.writeUInt16BE(id, 0); return [e, 12]; }
    const table = regs[fc] || {};
    if (!(addr in table)) { const e = Buffer.from([0, 0, 0, 0, 0, 3, unit, fc | 0x80, 2]); e.writeUInt16BE(id, 0); return [e, 12]; }
    const out = Buffer.alloc(9 + qty * 2);
    out.writeUInt16BE(id, 0); out.writeUInt16BE(0, 2); out.writeUInt16BE(3 + qty * 2, 4); out[6] = unit; out[7] = fc; out[8] = qty * 2;
    for (let i = 0; i < qty; i++) out.writeUInt16BE(table[addr + i] || 0, 9 + i * 2);
    return [out, 12];
  });
}

// EtherNet/IP: RegisterSession, then Read Tag by name (through Unconnected Send for ControlLogix, or straight for Micro800).
function abServer(tags) {
  return fake(buf => {
    if (buf.length < 24 || buf.length < 24 + buf.readUInt16LE(2)) return null;
    const cmd = buf.readUInt16LE(0), len = 24 + buf.readUInt16LE(2);
    if (cmd === 0x65) { const r = Buffer.alloc(28); r.writeUInt16LE(0x65, 0); r.writeUInt16LE(4, 2); r.writeUInt32LE(0x1234, 4); r.writeUInt16LE(1, 24); return [r, len]; }
    if (cmd === 0x66) return [null, len];
    let cip = buf.subarray(24 + 16, len);
    if (cip[0] === 0x52) cip = cip.subarray(10, 10 + cip.readUInt16LE(8));
    assert.equal(cip[0], 0x4c, 'only Read Tag');
    const words = cip[1], path = cip.subarray(2, 2 + words * 2), names = [];
    for (let o = 0; o < path.length;) { if (path[o] === 0x91) { names.push(path.subarray(o + 2, o + 2 + path[o + 1]).toString()); o += 2 + path[o + 1] + (path[o + 1] % 2); } else if (path[o] === 0x28) { names[names.length - 1] += '[' + path[o + 1] + ']'; o += 2; } else o += 2; }
    const name = names.join('.'), v = tags[name];
    const reply = v === undefined ? Buffer.from([0xcc, 0, 0x04, 0]) : Buffer.concat([Buffer.from([0xcc, 0, 0, 0, 0xc4, 0]), (() => { const b = Buffer.alloc(4); b.writeInt32LE(v); return b; })()]);
    const head = Buffer.alloc(24 + 16);
    head.writeUInt16LE(0x6f, 0); head.writeUInt16LE(16 + reply.length, 2); head.writeUInt32LE(0x1234, 4);
    head.writeUInt16LE(2, 24 + 6); head.writeUInt16LE(0, 24 + 8); head.writeUInt16LE(0, 24 + 10); head.writeUInt16LE(0xb2, 24 + 12); head.writeUInt16LE(reply.length, 24 + 14);
    return [Buffer.concat([head, reply]), len];
  });
}

// Siemens S7: connect, set up, Read Var from a data block.
function s7Server(dbs) {
  return fake(buf => {
    if (buf.length < 4 || buf.length < buf.readUInt16BE(2)) return null;
    const len = buf.readUInt16BE(2);
    if (buf[5] === 0xe0) return [Buffer.from([3, 0, 0, 22, 0x11, 0xd0, 0, 1, 0, 1, 0, 0xc0, 1, 0x0a, 0xc1, 2, 1, 0, 0xc2, 2, 1, 1]), len];
    const s7 = buf.subarray(7);
    if (s7[10] === 0xf0) return [Buffer.from([3, 0, 0, 27, 2, 0xf0, 0x80, 0x32, 3, 0, 0, 0, 1, 0, 8, 0, 0, 0, 0, 0xf0, 0, 0, 1, 0, 1, 0, 0xf0]), len];
    assert.equal(s7[10], 0x04, 'only Read Var');
    const db = s7.readUInt16BE(18), area = s7[20], start = ((s7[21] << 16) | (s7[22] << 8) | s7[23]) / 8, bytes = s7.readUInt16BE(16);
    const v = area === 0x84 ? (dbs[db] || {})[start] : undefined;
    const data = v === undefined ? Buffer.from([0x0a, 0, 0, 0]) : Buffer.concat([Buffer.from([0xff, 4, 0, bytes * 8]), (() => { const b = Buffer.alloc(bytes); if (bytes === 4) b.writeUInt32BE(v); else b.writeUInt16BE(v); return b; })()]);
    const head = Buffer.from([3, 0, 0, 0, 2, 0xf0, 0x80, 0x32, 3, 0, 0, 0, 2, 0, 2, 0, data.length, 0, 0, 4, 1]);
    head.writeUInt16BE(head.length + data.length, 2);
    return [Buffer.concat([head, data]), len];
  });
}

test('Modbus TCP: a 32-bit jug count over two registers, a 16-bit temperature, the register numbers people type', async () => {
  const s = await modbusServer({ 3: { 0: 19, 1: 39978, 100: 4312 }, 4: { 9: 42 } });
  try {
    assert.equal(await C.readCount({ brand: 'MODBUS', ip: '127.0.0.1', port: s.port, tag: '40001' }), 19 * 65536 + 39978);
    assert.equal(await C.readCount({ brand: 'MODBUS', ip: '127.0.0.1', port: s.port, tag: '40001', wordOrder: 'LOW_FIRST' }), 39978 * 65536 + 19);
    assert.equal(await C.readCount({ brand: 'MODBUS', ip: '127.0.0.1', port: s.port, tag: 'HR 100', size: 16 }), 4312);
    assert.equal(await C.readCount({ brand: 'MODBUS', ip: '127.0.0.1', port: s.port, tag: '30010', size: 16 }), 42);
    await assert.rejects(C.readCount({ brand: 'MODBUS', ip: '127.0.0.1', port: s.port, tag: '40501' }), /no register at that number/);
    assert.ok(s.seen.every(r => r[7] === 3 || r[7] === 4), 'only read functions 3 and 4 were sent');
  } finally { await s.close(); }
  assert.deepEqual(C.modbusAddress('40001'), { fc: 3, addr: 0 });
  assert.deepEqual(C.modbusAddress('300010'), { fc: 4, addr: 9 });
  assert.equal(C.modbusAddress('jugs'), null);
  assert.throws(() => C.modbusRequest({ fc: 6, addr: 0 }, 1, 1, 1), /Only Modbus read functions/, 'a write function cannot be built');
});

test('Allen-Bradley: a tag read by name through the slot (ControlLogix) and straight (Micro800); a wrong name says so', async () => {
  const s = await abServer({ 'Jug_Count': 1284330, 'Counter1.ACC': 77, 'Program:MainProgram.Speed': 42, 'Temps[3]': 431 });
  try {
    assert.equal(await C.readCount({ brand: 'AB', ip: '127.0.0.1', port: s.port, tag: 'Jug_Count', slot: 0 }), 1284330);
    assert.equal(await C.readCount({ brand: 'AB', ip: '127.0.0.1', port: s.port, tag: 'Counter1.ACC' }), 77);
    assert.equal(await C.readCount({ brand: 'AB_MICRO', ip: '127.0.0.1', port: s.port, tag: 'Program:MainProgram.Speed' }), 42);
    assert.equal(await C.readCount({ brand: 'AB', ip: '127.0.0.1', port: s.port, tag: 'Temps[3]' }), 431);
    await assert.rejects(C.readCount({ brand: 'AB', ip: '127.0.0.1', port: s.port, tag: 'No_Such_Tag' }), /not in the controller/);
  } finally { await s.close(); }
  assert.equal(C.tagPath('bad tag!'), null);
  assert.equal(C.readTagRequest(C.tagPath('Jug_Count'))[0], 0x4c, 'Read Tag service only');
});

test('Siemens S7: a data block\'s 4 bytes and 2 bytes; a missing data block says so', async () => {
  const s = await s7Server({ 10: { 4: 1284330, 8: 431 } });
  try {
    assert.equal(await C.readCount({ brand: 'S7', ip: '127.0.0.1', port: s.port, tag: 'DB10.DBD4' }), 1284330);
    assert.equal(await C.readCount({ brand: 'S7', ip: '127.0.0.1', port: s.port, tag: 'db10.dbw8' }), 431);
    await assert.rejects(C.readCount({ brand: 'S7', ip: '127.0.0.1', port: s.port, tag: 'DB99.DBD0' }), /data block does not exist/);
  } finally { await s.close(); }
  assert.equal(C.s7ReadRequest(C.s7Address('DB10.DBD4'))[4 + 13], 0x04, 'Read Var only');
});

test('No answer: a controller that is off says so in plain words', async () => {
  await assert.rejects(C.readCount({ brand: 'MODBUS', ip: '127.0.0.1', port: 1, tag: '40001' }), /Could not reach the controller/);
  await assert.rejects(C.readCount({ brand: '', ip: '127.0.0.1', tag: '40001' }), /Pick the controller's brand/);
});

test('The line PC: fetches its setup, sends each reading, answers a Test read', async () => {
  const s = await modbusServer({ 3: { 0: 0, 1: 500, 10: 42, 11: 4312 } });
  const posts = [];
  let ask = null;
  const real = global.fetch;
  global.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    posts.push(body);
    const config = { brand: 'MODBUS', ip: '127.0.0.1', port: s.port, readings: { count: { tag: '40001', size: 32 }, speed: { tag: '40011', size: 16 }, temp: { tag: '40012', size: 16 } } };
    return { ok: true, json: async () => ({ ok: true, count: 0, config, testAsk: ask }) };
  };
  const quiet = console.log;
  console.log = () => {};
  const timer = B.startController({ address: 'http://x', device: 'ut_prod_blow_mold', key: 'k', every: 0.2 });
  try {
    for (let i = 0; i < 50 && !posts.some(p => p.controller); i++) await new Promise(r => setTimeout(r, 50));
    const sent = posts.find(p => p.controller).controller;
    assert.deepEqual([sent.count, sent.speed, sent.temp], [500, 42, 4312]);
    assert.equal(posts[0].op, 'config', 'the first call only asks for the setup');
    ask = { at: '2026-10-14T22:40:00.000Z', reading: 'temp' };
    for (let i = 0; i < 50 && !posts.some(p => p.test); i++) await new Promise(r => setTimeout(r, 50));
    assert.deepEqual(posts.find(p => p.test).test, { askAt: '2026-10-14T22:40:00.000Z', reading: 'temp', value: 4312 });
  } finally { clearInterval(timer); console.log = quiet; global.fetch = real; await s.close(); }
});

// Joe 10/14 (Gallon Filler add-on sensors, B): the motor current switch is an on/off input on a small I/O module.
function modbusBits(bits) {
  return fake(buf => {
    if (buf.length < 12) return null;
    const id = buf.readUInt16BE(0), unit = buf[6], fc = buf[7], addr = buf.readUInt16BE(8);
    const table = bits[fc] || {};
    if (fc > 4 || !(addr in table)) { const e = Buffer.from([0, 0, 0, 0, 0, 3, unit, fc | 0x80, 2]); e.writeUInt16BE(id, 0); return [e, 12]; }
    const out = Buffer.from([0, 0, 0, 0, 0, 4, unit, fc, 1, table[addr] ? 1 : 0]);
    out.writeUInt16BE(id, 0);
    return [out, 12];
  });
}
test('Modbus TCP: an on/off input (discrete input 10001 or DI 0, coil 00001), read only', async () => {
  const s = await modbusBits({ 2: { 0: 1, 3: 0 }, 1: { 4: 1 } });
  try {
    assert.equal(await C.readCount({ brand: 'MODBUS', ip: '127.0.0.1', port: s.port, tag: '10001' }), 1);
    assert.equal(await C.readCount({ brand: 'MODBUS', ip: '127.0.0.1', port: s.port, tag: 'DI 3' }), 0);
    assert.equal(await C.readCount({ brand: 'MODBUS', ip: '127.0.0.1', port: s.port, tag: '00005' }), 1);
    assert.ok(s.seen.every(r => r[7] === 1 || r[7] === 2), 'only read functions 1 and 2 were sent');
  } finally { await s.close(); }
  assert.deepEqual(C.modbusAddress('10001'), { fc: 2, addr: 0, bit: true });
  assert.deepEqual(C.modbusAddress('COIL 7'), { fc: 1, addr: 7, bit: true });
  assert.throws(() => C.modbusRequest({ fc: 5, addr: 0 }, 1, 1, 1), /Only Modbus read functions/, 'write single coil cannot be built');
  assert.throws(() => C.modbusRequest({ fc: 15, addr: 0 }, 1, 1, 1), /Only Modbus read functions/);
});

test('Siemens S7: one bit of an input byte or a data block (a switch)', () => {
  assert.deepEqual(C.s7Address('I0.3'), { area: 0x81, db: 0, start: 0, bytes: 1, bit: 3 });
  assert.deepEqual(C.s7Address('DB10.DBX4.1'), { area: 0x84, db: 10, start: 4, bytes: 1, bit: 1 });
  assert.equal(C.s7ReadRequest(C.s7Address('I0.3'))[4 + 13], 0x04, 'Read Var only');
  // An answer with the byte 0b00001000: bit 3 is on.
  const a = C.s7Address('I0.3'), res = Buffer.from([3, 0, 0, 26, 2, 0xf0, 0x80, 0x32, 3, 0, 0, 0, 2, 0, 2, 0, 5, 0, 0, 4, 1, 0xff, 4, 0, 8, 0x08]);
  assert.equal(C.s7Value(res, a), 1);
  assert.equal(C.s7Value(res, C.s7Address('I0.2')), 0);
});
