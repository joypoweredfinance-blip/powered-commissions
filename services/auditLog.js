const { run, all } = require('../db/client');

async function logChange(tableName, recordId, fieldName, oldValue, newValue, changedBy, reason = null) {
  await run(
    `INSERT INTO audit_log (table_name, record_id, field_name, old_value, new_value, changed_by, reason) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [tableName, recordId, fieldName, oldValue === undefined || oldValue === null ? null : String(oldValue),
      newValue === undefined || newValue === null ? null : String(newValue), changedBy || null, reason]
  );
}

// Compares oldRow to a partial set of new field values and logs only what actually changed.
// All inserts fire in parallel — a save with many changed fields used to do N sequential
// Turso round-trips here (one per field), which dominated deal-save latency.
async function logDiff(tableName, recordId, oldRow, newFields, changedBy, reason = null) {
  const writes = [];
  for (const key of Object.keys(newFields)) {
    const oldVal = oldRow ? oldRow[key] : undefined;
    const newVal = newFields[key];
    if (String(oldVal) !== String(newVal)) {
      writes.push(logChange(tableName, recordId, key, oldVal, newVal, changedBy, reason));
    }
  }
  if (writes.length) await Promise.all(writes);
}

async function getLogFor(tableName, recordId, { limit } = {}) {
  return all(
    `SELECT a.*, u.email as changed_by_email FROM audit_log a LEFT JOIN users u ON u.id = a.changed_by
     WHERE a.table_name = ? AND a.record_id = ? ORDER BY a.changed_at DESC${limit ? ` LIMIT ${Number(limit)}` : ''}`,
    [tableName, recordId]
  );
}

module.exports = { logChange, logDiff, getLogFor };
