const express = require('express');
const router = express.Router();
const dealService = require('../services/dealService');
const addersReportService = require('../services/addersReportService');

router.get('/', async (req, res) => {
  try {
    const { statusId, statusIds, fundingStatuses, repId, installerId, search, phase, startDate, endDate } = req.query;
    const deals = await dealService.listDeals({ statusId, statusIds, fundingStatuses, repId, installerId, search, phase, startDate, endDate });
    res.json(deals);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Registered before /:id so "reports" is never swallowed as a deal id.
router.get('/reports/adders', async (req, res) => {
  try {
    const { statusId, statusIds, fundingStatuses, repId, installerId, search, phase, startDate, endDate } = req.query;
    const report = await addersReportService.getAddersReport({ statusId, statusIds, fundingStatuses, repId, installerId, search, phase, startDate, endDate });
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const deal = await dealService.getDeal(req.params.id);
    if (!deal) return res.status(404).json({ error: 'Deal not found' });
    res.json(deal);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const deal = await dealService.createDeal(req.body, req.user.id);
    res.status(201).json(deal);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const deal = await dealService.updateDeal(req.params.id, req.body, req.user.id, req.body._reason);
    res.json(deal);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await dealService.deleteDeal(req.params.id, req.user.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/recalculate', async (req, res) => {
  try {
    const deal = await dealService.recalculate(req.params.id, req.user.id, { force: !!req.body.force });
    res.json(deal);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/adders', async (req, res) => {
  try {
    const deal = await dealService.addAdder(req.params.id, req.body, req.user.id);
    res.status(201).json(deal);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id/adders/:adderId', async (req, res) => {
  try {
    const deal = await dealService.updateAdder(req.params.adderId, req.body, req.user.id);
    res.json(deal);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id/adders/:adderId', async (req, res) => {
  try {
    const deal = await dealService.deleteAdder(req.params.adderId, req.user.id);
    res.json(deal);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/approve', async (req, res) => {
  try {
    const { role, approved } = req.body;
    if (!['closer', 'setter'].includes(role)) return res.status(400).json({ error: 'role must be closer or setter' });
    const deal = await dealService.setApproval(req.params.id, role, !!approved, req.user.id);
    res.json(deal);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/payment', async (req, res) => {
  try {
    const { recipient, paid, date } = req.body;
    const deal = await dealService.setPaymentFlag(req.params.id, recipient, !!paid, date, req.user.id);
    res.json(deal);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/override', async (req, res) => {
  try {
    const deal = await dealService.setOverride(req.params.id, req.body, req.user.id);
    res.json(deal);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
