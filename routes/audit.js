const express = require('express');
const router = express.Router();
const { all } = require('../db/client');

router.get('/', async (req, res) => {
  try {
    const { table, limit = 200 } = req.query;
    let sql = `
      SELECT a.*, u.email as changed_by_email
      FROM audit_log a LEFT JOIN users u ON u.id = a.changed_by
      WHERE 1=1
    `;
    const args = [];
    if (table) { sql += ` AND a.table_name = ?`; args.push(table); }
    sql += ` ORDER BY a.changed_at DESC LIMIT ?`;
    args.push(Number(limit));
    res.json(await all(sql, args));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
