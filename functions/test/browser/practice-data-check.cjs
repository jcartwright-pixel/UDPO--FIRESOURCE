'use strict';
/*
 * Part of the full practice-copy test (Joe 10/22): reads the practice copy's database (a copy of live) and lists what does
 * not add up across this week and next: a driver or truck on two loads leaving at the same time, running loads with no
 * driver or no leaving time, inactive drivers or units on a load, drivers on a load on a vacation day, plant loads whose load
 * is gone, loads marked loaded with no end time. Read only. Usage: KEY=key.json node practice-data-check.cjs <out.json>
 */
const fs = require('fs');
const path = require('path');
const r = require('module').createRequire(path.join(__dirname, '..', '..', 'package.json'));
const admin = r('firebase-admin');
const { getFirestore } = r('firebase-admin/firestore');
const L = require('../../src/logic');

const key = JSON.parse(fs.readFileSync(process.env.KEY, 'utf8'));
if (key.project_id !== 'ud-distribution-sandbox') throw new Error('practice copy only');
const db = getFirestore(admin.initializeApp({ credential: admin.credential.cert(key), projectId: key.project_id }));
const OUT = process.argv[2] || 'data-check.json';

(async () => {
  const today = L.operatingDay(new Date()), wk = L.weekStart(today);
  const weeks = [wk, L.addDays(wk, 7)];
  const runs = [];
  for (const w of weeks) (await db.collection('runs').where('weekStart', '==', w).get()).docs.forEach(d => runs.push(Object.assign({ _id: d.id }, d.data())));
  const drivers = {}, units = {}, routes = {};
  (await db.collection('drivers').get()).docs.forEach(d => { drivers[d.id] = d.data(); });
  (await db.collection('equipment').get()).docs.forEach(d => { units[d.id] = d.data(); });
  (await db.collection('routes').get()).docs.forEach(d => { routes[d.id] = d.data(); });
  const vacs = (await db.collection('vacations').get()).docs.map(d => d.data());
  const found = { today, weeks, runs: runs.length, problems: [] };
  const add = (kind, what) => found.problems.push({ kind, what });

  const slots = [];
  runs.forEach(run => L.DAYS.forEach((p, i) => {
    const d = (run.days || {})[p] || {};
    if (!d.runs) return;
    const date = d.deliveryDate || L.addDays(run.weekStart, i);
    if (date < today) return;
    const name = (run.route || '?') + (run.run ? ' ' + run.run : '') + ' ' + date + ' (' + p + ')';
    const carrier = /CARRIER|PICKUP|CUSTOMER/i.test(String(run.coverageType || '') + ' ' + String(run.movementType || ''));
    if (!carrier && !d.driverId && !d.driver && d.driverExceptionStatus !== 'COVERED') add('Running load with no driver', name);
    if (d.dispatchTime === null || d.dispatchTime === undefined) add('Running load with no leaving time', name);
    if (d.driverId && drivers[d.driverId] && String(drivers[d.driverId].status || '').toUpperCase() !== 'ACTIVE') add('Driver on a load is not active in Driver Master', name + ': ' + (d.driver || d.driverId));
    if (d.truckId && units[d.truckId] && String(units[d.truckId].status || '').toUpperCase() !== 'ACTIVE') add('Truck on a load is not active in Equipment Master', name + ': ' + (d.truck || d.truckId));
    const off = d.driverId && vacs.find(v => (v.driverId === d.driverId) && /APPROVED|ACTIVE|^$/i.test(String(v.status || '')) && v.startDate <= date && date <= (v.endDate || v.startDate));
    if (off) add('Driver on a load on a vacation day', name + ': ' + (d.driver || d.driverId));
    const rt = routes[run.runId] || routes[run.routeId] || null;
    const std = rt && rt.days && rt.days[p] ? rt.days[p].dispatchTime : null;
    if (std !== null && std !== undefined && d.dispatchTime !== null && d.dispatchTime !== undefined && std !== d.dispatchTime) add('Leaving time differs from Route Master', name + ': load ' + L.timeText(d.dispatchTime) + ', Route Master ' + L.timeText(std));
    slots.push({ name, date, leave: d.departureDate || date, time: d.dispatchTime, hours: d.routeHours || (rt && rt.days && rt.days[p] && rt.days[p].routeHours) || 10, driverId: d.driverId, truckId: d.truckId, trailerId: d.trailerId });
  }));
  // The same driver or truck on two loads that overlap (leaving date + time, for the route's hours).
  const at = (s) => s.time === null || s.time === undefined ? null : Date.parse(s.leave + 'T00:00:00Z') / 60000 + s.time;
  ['driverId', 'truckId'].forEach(k => {
    const by = {};
    slots.filter(s => s[k] && !/PLANT/i.test(s[k])).forEach(s => (by[s[k]] = by[s[k]] || []).push(s));
    Object.keys(by).forEach(id => {
      const list = by[id].filter(s => at(s) !== null).sort((a, b) => at(a) - at(b));
      for (let i = 1; i < list.length; i++) {
        const a = list[i - 1], b = list[i];
        if (at(b) < at(a) + a.hours * 60) add((k === 'driverId' ? 'Driver' : 'Truck') + ' on two loads at the same time', a.name + ' and ' + b.name + ' (' + ((k === 'driverId' ? (drivers[id] || {}).name : (units[id] || {}).unit) || id) + ')');
      }
    });
  });
  // Plant loads whose run is gone, and loads marked loaded with no end time.
  const plant = (await db.collection('plantLoads').where('date', '>=', L.addDays(today, -1)).get().catch(() => ({ docs: [] }))).docs.map(d => Object.assign({ _id: d.id }, d.data()));
  const ids = new Set(runs.map(x => x._id));
  plant.forEach(pl => {
    const runKey = pl.runKey || pl.runDocId || '';
    if (runKey && !ids.has(runKey) && /^\d{4}-\d{2}-\d{2}__/.test(runKey)) add('Plant load whose dispatch load is gone', (pl.route || '?') + ' ' + (pl.date || '') + ' (' + pl._id + ')');
    if (/COMPLETE|LOADED|DONE/i.test(String(pl.status || '')) && !pl.endedAt && !pl.endTime && !pl.completedAt) add('Load marked loaded with no end time', (pl.route || '?') + ' ' + (pl.date || ''));
  });
  found.plantLoads = plant.length;
  const counts = {};
  found.problems.forEach(p => { counts[p.kind] = (counts[p.kind] || 0) + 1; });
  found.counts = counts;
  fs.writeFileSync(OUT, JSON.stringify(found, null, 1));
  console.log(JSON.stringify({ today, runs: runs.length, plantLoads: plant.length, counts }, null, 1));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
