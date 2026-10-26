'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const L = require('../../src/logic');
const R = require('../../src/rights');
const { ACTIONS } = require('../../src/actions');

// Joe 10/14 (People & Roles, mock-up A): screens ticked per person and per plant.
const person = (roles, facilities) => ({ status: 'ACTIVE', roles, facilities });
const maint = person(['MANAGER'], ['fac_uniontown']);
const ticks = { fac_uniontown: ['pmCenter', 'machinery', 'pmWorkOrders', 'pmSchedule', 'maintStation', 'plantReports', 'shiftReports'] };

test('every screen in the side menu is in the screen list, so none can be missed in People & Roles', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../../public/js/app.js'), 'utf8');
  const menu = app.slice(app.indexOf('export const MENU = ['), app.indexOf('export const SIDES = ['));
  const pages = [...menu.matchAll(/'([a-z-]+\.html)[^']*'/g)].map(m => m[1]).filter(p => p !== 'index.html');
  assert.ok(pages.length > 40);
  pages.forEach(p => assert.equal(L.pageGated(p), true, p + ' is in the menu but not in SCREEN_AREAS'));
  // The SIDES list only (the home's group cards after it, GROUPS, are not screens).
  const sides = app.slice(app.indexOf('export const SIDES = ['), app.indexOf('export const GROUPS = ['));
  [...sides.matchAll(/key: '([a-z]+)'/g)].map(m => m[1]).forEach(k => assert.ok(L.SCREEN_AREAS.some(a => a.key === k), 'Home card ' + k));
  assert.equal(new Set(L.SCREEN_KEYS).size, L.SCREEN_KEYS.length, 'screen keys are unique');
});

test('every save names the screens it is made from', () => {
  Object.keys(ACTIONS).forEach(a => assert.ok(Array.isArray(R.ACTION_SCREENS[a]), a + ' has no screens in rights.js ACTION_SCREENS'));
  Object.values(R.ACTION_SCREENS).forEach(list => list.forEach(k => assert.ok(L.SCREEN_KEYS.indexOf(k) >= 0, k)));
});

test('nothing ticked yet: every screen, as before; an Administrator always sees everything', () => {
  assert.equal(L.pageAllowed(maint, null, 'fac_uniontown', 'scheduler.html'), true);
  assert.equal(L.pageAllowed(person(['ADMINISTRATOR'], ['*']), ticks, 'fac_uniontown', 'scheduler.html'), true);
  assert.equal(R.screenSaveAllowed(maint, 'savePlantSchedule', { grants: [] }, 'fac_uniontown'), true);
});

test('a maintenance manager sees only Plant Maintenance and two reports', () => {
  assert.equal(L.pageAllowed(maint, ticks, 'fac_uniontown', 'pmaint.html'), true);
  assert.equal(L.pageAllowed(maint, ticks, 'fac_uniontown', 'reports.html?day=1'), true);
  assert.equal(L.pageAllowed(maint, ticks, 'fac_uniontown', 'reportcenter.html'), true, 'the Reports card\'s first page');
  assert.equal(L.pageAllowed(maint, ticks, 'fac_uniontown', 'scheduler.html'), false);
  assert.equal(L.pageAllowed(maint, ticks, 'fac_uniontown', 'daily.html'), false);
  assert.equal(L.pageAllowed(maint, ticks, 'fac_uniontown', 'distribution.html'), false);
  assert.equal(L.pageAllowed(maint, ticks, 'fac_uniontown', 'index.html'), true, 'Home is never decided by the ticks');
  assert.equal(L.pageAllowed(maint, ticks, 'fac_uniontown', 'administration.html'), true, 'Administration has its own check');
  assert.equal(L.pageAllowed(maint, ticks, 'fac_charleston', 'pmaint.html'), false, 'another plant');
  assert.equal(L.areaAllowed(maint, ticks, 'fac_uniontown', 'pmaint'), true);
  assert.equal(L.areaAllowed(maint, ticks, 'fac_uniontown', 'reports'), true);
  assert.equal(L.areaAllowed(maint, ticks, 'fac_uniontown', 'plant'), false);
  assert.equal(L.areaAllowed(maint, ticks, 'fac_uniontown', 'distribution'), false);
  assert.equal(R.screenSaveAllowed(maint, 'saveMachine', { screenAccess: ticks }, 'fac_uniontown'), true);
  assert.equal(R.screenSaveAllowed(maint, 'savePlantSchedule', { screenAccess: ticks }, 'fac_uniontown'), false);
  assert.equal(R.screenSaveAllowed(maint, 'saveMachine', { screenAccess: ticks }, 'fac_charleston'), false);
  assert.equal(R.screenSaveAllowed(maint, 'saveProductSetup', { screenAccess: ticks }, 'fac_uniontown'), true, 'Administration setup pages are not decided by the ticks');
});

test('a screen on two cards opens from either', () => {
  const t = { fac_uniontown: ['rScorecard'] };
  assert.equal(L.pageAllowed(maint, t, 'fac_uniontown', 'scorecard.html'), true);
  assert.equal(R.screenSaveAllowed(maint, 'rateTruckClean', { screenAccess: t }, 'fac_uniontown'), true);
});

test('People & Roles saves only known plants and screens', () => {
  const plants = L.PLANTS.map(p => p.id);
  assert.equal(R.cleanScreenAccess(null, plants), null);
  assert.deepEqual(R.cleanScreenAccess({ fac_uniontown: ['machinery', 'pmCenter'] }, plants), { fac_uniontown: ['pmCenter', 'machinery'] });
  assert.equal(R.cleanScreenAccess({ fac_nowhere: [] }, plants), undefined);
  assert.equal(R.cleanScreenAccess({ fac_uniontown: ['nope'] }, plants), undefined);
  assert.equal(R.cleanScreenAccess(['x'], plants), undefined);
  L.SCREEN_JOBS.forEach(j => j.screens.forEach(k => assert.ok(L.SCREEN_KEYS.indexOf(k) >= 0, j.name + ': ' + k)));
});

// Joe 10/26: the Home screen choices are the screens this person can see, grouped by Home card, each page once.
test('Home screen choices follow the ticked screens', () => {
  const all = L.homeChoices(maint, null), pages = all.map(c => c.page);
  assert.equal(new Set(pages).size, pages.length, 'each page once');
  ['manager.html', 'daily.html', 'crew.html', 'production-home.html', 'pmaint.html'].forEach(p => assert.ok(pages.indexOf(p) >= 0, p));
  assert.deepEqual(all.find(c => c.page === 'manager.html'), { page: 'manager.html', name: 'Plant Distribution', group: 'Plant Distribution' });
  pages.forEach(p => assert.equal(L.pageAllowed(maint, null, 'fac_uniontown', p), true, p));
  const mine = L.homeChoices(maint, ticks);
  assert.deepEqual([...new Set(mine.map(c => c.group))], ['Plant Maintenance', 'Reports']);
  mine.forEach(c => assert.equal(L.pageAllowed(maint, ticks, 'fac_uniontown', c.page), true, c.page));
  assert.equal(mine.some(c => c.page === 'daily.html'), false);
  assert.deepEqual(L.homeChoices(maint, { fac_uniontown: [] }), []);
});
