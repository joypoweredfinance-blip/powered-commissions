const { client } = require('./client');
const schema = require('./schema');
const { seedIfEmpty } = require('./seed');

async function initDatabase() {
  for (const stmt of schema) {
    await client.execute(stmt);
  }
  await seedIfEmpty();
}

module.exports = { initDatabase };
