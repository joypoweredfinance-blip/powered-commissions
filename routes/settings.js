const express = require('express');
const router = express.Router();
const { run, get, all } = require('../db/client');
const auditLog = require('../services/auditLog');

let _settingsCache = null;
let _settingsCacheTs = 0;
const SETTINGS_TTL = 5 * 60 * 1000;
function invalidateSettingsCache() { _settingsCache = null; }

router.get('/', async (req, res) => {
  try {
    if (_settingsCache && Date.now() - _settingsCacheTs < SETTINGS_TTL) {
      return res.json(_settingsCache);
    }
    const [commissionSettings, scales, allTiers] = await Promise.all([
      get(`SELECT * FROM commission_settings WHERE id = 1`),
      all(`SELECT * FROM pay_scales ORDER BY name`),
      all(`SELECT * FROM pay_scale_tiers ORDER BY pay_scale_id, net_ppw_threshold ASC`)
    ]);
    for (const scale of scales) {
      scale.tiers = allTiers.filter((t) => t.pay_scale_id === scale.id);
    }
    _settingsCache = { commissionSettings, payScales: scales };
    _settingsCacheTs = Date.now();
    res.json(_settingsCache);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/commission', async (req, res) => {
  try {
    const old = await get(`SELECT * FROM commission_settings WHERE id = 1`);
    const fields = [
      'default_pay_split', 'referral_pay_split', 'setter_split_pct', 'closer_split_pct', 'cashback_split_pct',
      'closer_clawback_pct_pss_socal', 'owner_etai_m1', 'owner_etai_m2', 'owner_noy_m1', 'owner_noy_m2',
      'joey_weekly_salary', 'joey_tier1_max', 'joey_tier1_amt', 'joey_tier2_max', 'joey_tier2_amt', 'joey_tier3_amt',
      'austin_base', 'austin_rate_per_kw'
    ].filter((f) => req.body[f] !== undefined);
    if (fields.length) {
      const setClause = fields.map((f) => `${f} = ?`).join(', ');
      await run(`UPDATE commission_settings SET ${setClause} WHERE id = 1`, fields.map((f) => req.body[f]));
      await auditLog.logDiff('commission_settings', 1, old, req.body, req.user.id);
    }
    invalidateSettingsCache();
    res.json(await get(`SELECT * FROM commission_settings WHERE id = 1`));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/pay-scales/:id', async (req, res) => {
  try {
    const old = await get(`SELECT * FROM pay_scales WHERE id = ?`, [req.params.id]);
    if (!old) return res.status(404).json({ error: 'Pay scale not found' });
    const fields = ['name', 'rounding_rule', 'hard_floor_ppw', 'active'].filter((f) => req.body[f] !== undefined);
    const setClause = fields.map((f) => `${f} = ?`).join(', ');
    await run(`UPDATE pay_scales SET ${setClause} WHERE id = ?`, [...fields.map((f) => req.body[f]), req.params.id]);
    await auditLog.logDiff('pay_scales', req.params.id, old, req.body, req.user.id);
    invalidateSettingsCache();
    res.json(await get(`SELECT * FROM pay_scales WHERE id = ?`, [req.params.id]));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/pay-scales/:id/tiers', async (req, res) => {
  try {
    const { net_ppw_threshold, dollar_per_kw } = req.body;
    if (net_ppw_threshold === undefined || dollar_per_kw === undefined) {
      return res.status(400).json({ error: 'net_ppw_threshold and dollar_per_kw are required' });
    }
    const maxOrder = await get(`SELECT MAX(sort_order) as m FROM pay_scale_tiers WHERE pay_scale_id = ?`, [req.params.id]);
    const result = await run(
      `INSERT INTO pay_scale_tiers (pay_scale_id, net_ppw_threshold, dollar_per_kw, sort_order) VALUES (?, ?, ?, ?)`,
      [req.params.id, net_ppw_threshold, dollar_per_kw, (maxOrder.m ?? -1) + 1]
    );
    await auditLog.logChange('pay_scale_tiers', req.params.id, '_tier_added', null, `${net_ppw_threshold} -> $${dollar_per_kw}`, req.user.id);
    invalidateSettingsCache();
    res.status(201).json(await get(`SELECT * FROM pay_scale_tiers WHERE id = ?`, [Number(result.lastInsertRowid)]));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/tiers/:tierId', async (req, res) => {
  try {
    const old = await get(`SELECT * FROM pay_scale_tiers WHERE id = ?`, [req.params.tierId]);
    if (!old) return res.status(404).json({ error: 'Tier not found' });
    const fields = ['net_ppw_threshold', 'dollar_per_kw', 'sort_order'].filter((f) => req.body[f] !== undefined);
    const setClause = fields.map((f) => `${f} = ?`).join(', ');
    await run(`UPDATE pay_scale_tiers SET ${setClause} WHERE id = ?`, [...fields.map((f) => req.body[f]), req.params.tierId]);
    await auditLog.logDiff('pay_scale_tiers', req.params.tierId, old, req.body, req.user.id);
    invalidateSettingsCache();
    res.json(await get(`SELECT * FROM pay_scale_tiers WHERE id = ?`, [req.params.tierId]));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/tiers/:tierId', async (req, res) => {
  try {
    const old = await get(`SELECT * FROM pay_scale_tiers WHERE id = ?`, [req.params.tierId]);
    await run(`DELETE FROM pay_scale_tiers WHERE id = ?`, [req.params.tierId]);
    await auditLog.logChange('pay_scale_tiers', req.params.tierId, '_tier_removed', old ? `${old.net_ppw_threshold} -> $${old.dollar_per_kw}` : null, null, req.user.id);
    invalidateSettingsCache();
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
