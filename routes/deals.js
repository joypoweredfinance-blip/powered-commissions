const express = require('express');
const router = express.Router();
const multer = require('multer');
const dealService = require('../services/dealService');
const addersReportService = require('../services/addersReportService');

// Memory storage only — Render's filesystem is wiped on every redeploy/restart (the same
// reason this app's database lives in Turso, not a local file), so anything uploaded here
// goes straight into the database instead of ever touching local disk.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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

// Receipt/Proof per line item — admin-only, any format. Never exposed to any rep-facing
// route (those only ever return computeAdderCategoryTotals() output, never these rows).
router.post('/:id/adders/:adderId/file', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large — max 10MB.' : err.message;
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: 'No file was uploaded.' });
    try {
      const deal = await dealService.setAdderFile(req.params.adderId, {
        fileName: req.file.originalname, fileType: req.file.mimetype, fileSize: req.file.size, fileData: req.file.buffer
      }, req.user.id);
      res.status(201).json(deal);
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
});

router.get('/:id/adders/:adderId/file', async (req, res) => {
  try {
    const file = await dealService.getAdderFileBlob(req.params.adderId);
    if (!file) return res.status(404).json({ error: 'No file attached.' });
    res.setHeader('Content-Type', file.file_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.file_name)}"`);
    res.send(Buffer.from(file.file_data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id/adders/:adderId/file', async (req, res) => {
  try {
    const deal = await dealService.deleteAdderFile(req.params.adderId, req.user.id);
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
    const { recipient, paid, date, na } = req.body;
    const deal = await dealService.setPaymentFlag(req.params.id, recipient, !!paid, date, req.user.id, !!na);
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

// Any format, as requested — slot is "estimate" or "final", one file per slot per deal
// (uploading a new one into the same slot replaces what was there before).
router.post('/:id/files/:slot', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large — max 10MB.' : err.message;
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: 'No file was uploaded.' });
    try {
      const deal = await dealService.setEstimateFile(req.params.id, req.params.slot, {
        fileName: req.file.originalname, fileType: req.file.mimetype, fileSize: req.file.size, fileData: req.file.buffer
      }, req.user.id);
      res.status(201).json(deal);
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
});

router.get('/:id/files/:slot', async (req, res) => {
  try {
    const file = await dealService.getEstimateFileBlob(req.params.id, req.params.slot);
    if (!file) return res.status(404).json({ error: 'No file attached.' });
    res.setHeader('Content-Type', file.file_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.file_name)}"`);
    res.send(Buffer.from(file.file_data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id/files/:slot', async (req, res) => {
  try {
    const deal = await dealService.deleteEstimateFile(req.params.id, req.params.slot, req.user.id);
    res.json(deal);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
