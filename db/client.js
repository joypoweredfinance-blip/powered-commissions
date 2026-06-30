const { createClient } = require('@libsql/client');
const path = require('path');

const url = process.env.TURSO_DATABASE_URL || `file:${path.join(__dirname, 'local.db')}`;
const authToken = process.env.TURSO_AUTH_TOKEN || undefined;

const client = createClient({ url, authToken });

async function run(sql, args = []) {
  return client.execute({ sql, args });
}

async function get(sql, args = []) {
  const res = await client.execute({ sql, args });
  return res.rows[0] || null;
}

async function all(sql, args = []) {
  const res = await client.execute({ sql, args });
  return res.rows;
}

// Executes multiple independent SQL strings as a single network round-trip to Turso.
// Use for DDL batches (CREATE TABLE, CREATE INDEX) and write batches (INSERT, UPDATE)
// where statements don't need each other's results. N round-trips become 1.
async function batchRun(statements) {
  return client.batch(statements.map((sql) => ({ sql, args: [] })), 'write');
}

module.exports = { client, run, get, all, batchRun };
