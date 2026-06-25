const express = require('express');
const router = express.Router();
const payRunService = require('../services/payRunService');

router.get('/', async (req, res) => {
  try { res.json(await payRunService.listPayRuns()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try { res.status(201).json(await payRunService.createPayRun(req.body, req.user.id)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const data = await payRunService.getPayRun(req.params.id);
    if (!data) return res.status(404).json({ error: 'Pay run not found' });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try { res.json(await payRunService.updatePayRun(req.params.id, req.body, req.user.id)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try { await payRunService.deletePayRun(req.params.id, req.user.id); res.json({ ok: true }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/:id/deals/:dealId', async (req, res) => {
  try { res.json(await payRunService.setDealInclusion(req.params.id, req.params.dealId, req.body, req.user.id)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/:id/adhoc', async (req, res) => {
  try { res.status(201).json(await payRunService.addAdhocItem(req.params.id, req.body, req.user.id)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/:id/adhoc/:itemId', async (req, res) => {
  try { res.json(await payRunService.deleteAdhocItem(req.params.itemId, req.params.id, req.user.id)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/:id/approval', async (req, res) => {
  try { res.json(await payRunService.addApprovalEntry(req.params.id, req.body, req.user.id)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/:id/finalize', async (req, res) => {
  try { res.json(await payRunService.finalizePayRun(req.params.id, req.user.id)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
