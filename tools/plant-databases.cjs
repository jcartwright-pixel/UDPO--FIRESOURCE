#!/usr/bin/env node
'use strict';
/*
 * Joe 10/26: "All three locations have completely separate". Each plant keeps everything in its own database
 * (functions/src/logic.js PLANTS[].db): Uniontown in the first one, Charleston and Martins Ferry each in their own.
 *
 *   node tools/plant-databases.cjs list            the other plants' database names, one a line (the deploy makes any missing)
 *   node tools/plant-databases.cjs use a,b [file]  writes firebase.json so the same rules and indexes guard Uniontown's
 *                                                  database and each named one that exists on the project
 */
const fs = require('fs');
const path = require('path');
const L = require('../functions/src/logic');

const others = () => L.PLANTS.map(p => p.db).filter(d => d && d !== '(default)');

// firebase.json with the same rules and indexes for Uniontown's database and each of `names` (only plant databases).
function withDatabases(config, names) {
  const one = Array.isArray(config.firestore) ? config.firestore.find(f => !f.database || f.database === '(default)') || config.firestore[0] : config.firestore;
  const base = { rules: one.rules, indexes: one.indexes };
  const known = new Set(others());
  const list = [Object.assign({ database: '(default)' }, base)].concat(names.filter(n => known.has(n)).map(n => Object.assign({ database: n }, base)));
  return Object.assign({}, config, { firestore: list.length === 1 ? base : list });
}

module.exports = { others, withDatabases };

if (require.main === module) {
  const [cmd, arg, file] = process.argv.slice(2);
  if (cmd === 'list') { console.log(others().join('\n')); process.exit(0); }
  if (cmd === 'use') {
    const target = file || path.join(__dirname, '..', 'firebase.json');
    const names = String(arg || '').split(',').map(s => s.trim()).filter(Boolean);
    fs.writeFileSync(target, JSON.stringify(withDatabases(JSON.parse(fs.readFileSync(target, 'utf8')), names), null, 2) + '\n');
    console.log('Database rules and indexes for: (default)' + names.map(n => ', ' + n).join(''));
    process.exit(0);
  }
  console.error('Use: plant-databases.cjs list | use name,name [firebase.json]');
  process.exit(2);
}
