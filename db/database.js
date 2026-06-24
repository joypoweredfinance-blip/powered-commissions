const { client } = require('./client');
const schema = require('./schema');
const { runMigrations } = require('./migrate');
const { seedIfEmpty } = require('./seed');

async function initDatabase() {
  for (const stmt of schema) {
    await client.execute(stmt);
  }
  await runMigrations();
  await seedIfEmpty();
}

module.exports = { initDatabase };
