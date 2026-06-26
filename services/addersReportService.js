const { all } = require('../db/client');
const dealService = require('./dealService');

const FIXED_CATEGORIES = ['reroof_sow', 'battery', 'permit', 'mpu', 'other'];
const CATEGORY_LABELS = { reroof_sow: 'Roof Costs', battery: 'Battery', permit: 'Permit', mpu: 'MPU', other: 'Other' };

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

// Reuses listDeals' own filter-building (date/CRM status/funding status/rep/installer/phase/
// search) so this report and the Deals Board always agree on what "matches the filters" means.
async function getAddersReport(filters) {
  const deals = await dealService.listDeals(filters);
  if (deals.length === 0) return { rows: [], miscLabels: [], totals: null };

  const dealIds = deals.map((d) => d.id);
  const placeholders = dealIds.map(() => '?').join(',');
  const adders = await all(
    `SELECT deal_id, category, label, amount FROM deal_adders WHERE deal_id IN (${placeholders})`,
    dealIds
  );

  const byDeal = {};
  const miscLabelSet = new Set();
  for (const a of adders) {
    byDeal[a.deal_id] = byDeal[a.deal_id] || { categoryTotals: {}, miscByLabel: {} };
    if (a.category === 'misc') {
      const label = a.label || 'Misc';
      byDeal[a.deal_id].miscByLabel[label] = round2((byDeal[a.deal_id].miscByLabel[label] || 0) + (a.amount || 0));
      miscLabelSet.add(label);
    } else {
      byDeal[a.deal_id].categoryTotals[a.category] = round2((byDeal[a.deal_id].categoryTotals[a.category] || 0) + (a.amount || 0));
    }
  }
  const miscLabels = [...miscLabelSet].sort();

  const rows = deals.map((d) => {
    const entry = byDeal[d.id] || { categoryTotals: {}, miscByLabel: {} };
    const categoryTotals = {};
    FIXED_CATEGORIES.forEach((c) => { categoryTotals[c] = entry.categoryTotals[c] || 0; });
    const miscByLabel = {};
    miscLabels.forEach((l) => { miscByLabel[l] = entry.miscByLabel[l] || 0; });
    const miscTotal = round2(Object.values(miscByLabel).reduce((s, v) => s + v, 0));
    return {
      id: d.id, customerName: d.customer_name, customerAddress: d.customer_address,
      installerName: d.installer_name, financierName: d.financier_name,
      contractValue: round2(d.contract_value || 0), epcCost: round2(d.epc_cost || 0),
      categoryTotals, miscByLabel, miscTotal
    };
  });

  const totals = {
    contractValue: round2(rows.reduce((s, r) => s + r.contractValue, 0)),
    epcCost: round2(rows.reduce((s, r) => s + r.epcCost, 0)),
    categoryTotals: {},
    miscByLabel: {},
    miscTotal: round2(rows.reduce((s, r) => s + r.miscTotal, 0))
  };
  FIXED_CATEGORIES.forEach((c) => { totals.categoryTotals[c] = round2(rows.reduce((s, r) => s + r.categoryTotals[c], 0)); });
  miscLabels.forEach((l) => { totals.miscByLabel[l] = round2(rows.reduce((s, r) => s + r.miscByLabel[l], 0)); });

  return { rows, miscLabels, totals, categoryLabels: CATEGORY_LABELS };
}

module.exports = { getAddersReport, CATEGORY_LABELS };
