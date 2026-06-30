const { batchRun } = require('./client');
const schema = require('./schema');
const { runMigrations } = require('./migrate');
const { seedIfEmpty } = require('./seed');

async function initDatabase() {
  // All CREATE TABLE / CREATE INDEX statements in one round-trip instead of N sequential ones.
  await batchRun(schema);
  await runMigrations();
  await seedIfEmpty();
}

module.exports = { initDatabase };
