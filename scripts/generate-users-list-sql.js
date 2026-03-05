#!/usr/bin/env node
/**
 * Reads a members list file (e.g. userslist.md) with lines like:
 *   {{number}}. {{display name}} @{{username}}
 * and outputs SQL to insert/update users (display_name, username, from_id NULL).
 * Run: node scripts/generate-users-list-sql.js [path/to/userslist.md]
 * Default path: ../../userslist.md (from dashboard/scripts)
 */

const fs = require('fs');
const path = require('path');

const inputPath = process.argv[2] || path.join(__dirname, '../../userslist.md');

function escapeSql(s) {
  if (s == null) return 'NULL';
  return "'" + String(s).replace(/'/g, "''") + "'";
}

const content = fs.readFileSync(inputPath, 'utf-8');
const lineRe = /^\s*(\d+)\.\s+(.+?)\s+@(\S+)\s*$/;
const rows = [];

for (const line of content.split(/\r?\n/)) {
  const m = line.match(lineRe);
  if (!m) continue;
  const [, _num, displayName, username] = m;
  const name = displayName.trim();
  const handle = username.trim();
  if (!handle) continue;
  rows.push({ display_name: name, username: handle });
}

console.log('-- Insert/update users from members list (from_id NULL; match by display_name on future ingest)');
console.log('-- Generated from', inputPath, '-', rows.length, 'rows');
console.log('');

for (const r of rows) {
  const display = escapeSql(r.display_name);
  const user = escapeSql(r.username);
  console.log(
    `INSERT INTO users (from_id, display_name, username, updated_at) VALUES (NULL, ${display}, ${user}, NOW()) ON CONFLICT (username) WHERE (username IS NOT NULL) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = NOW();`
  );
}

console.log('');
console.log('-- Total:', rows.length, 'rows');
