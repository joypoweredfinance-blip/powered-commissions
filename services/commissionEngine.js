// Pure commission calculation logic. No DB access here — callers pass in plain data
// (deal fields, its adders, the rep's pay scale + tiers, and commission_settings) and get
// back computed numbers. Keeping this pure makes it easy to unit-test and to re-run the
// exact same math from a route handler, a script, or a future test.

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function sumHardCosts(adders) {
  return adders
    .filter((a) => a.counts_as_hard_cost)
    .reduce((sum, a) => sum + Number(a.amount || 0), 0);
}

// Gross (POWERED's real cash margin) deducts EVERY line item, regardless of whether it
// counts toward the rep's Net PPW — a cost that's excluded from the commission calc is
// still a real dollar the company spent.
function sumAllAdders(adders) {
  return adders.reduce((sum, a) => sum + Number(a.amount || 0), 0);
}

// EPC cost is what POWERED pays the installer — excluded from the rep commission calc
// (see computeNetPPW) but it's a real cost for the company's own margin (see computeGross).
function computeEpcCost(epcRatePerWatt, systemSizeKw) {
  return (epcRatePerWatt || 0) * systemSizeKw * 1000;
}

function computeGross(contractValue, epcCost, allAddersTotal) {
  return contractValue - epcCost - allAddersTotal;
}

// What POWERED expects to receive from the installer at each milestone, per that
// installer's payment schedule (e.g. SWS 50/50, PSS/SoCal 80/20).
function computeExpectedFunding(gross, installer) {
  const m1Pct = installer ? Number(installer.m1_pct || 0) : 0;
  const m2Pct = installer ? Number(installer.m2_pct || 0) : 0;
  return {
    expectedM1: round2(gross * m1Pct),
    expectedM2: round2(gross * m2Pct)
  };
}

function computeNetPPW(contractValue, hardCosts, systemSizeKw) {
  const totalWatts = systemSizeKw * 1000;
  if (!totalWatts) return null;
  return (contractValue - hardCosts) / totalWatts;
}

// tiers must be sorted ascending by net_ppw_threshold. Round DOWN: pick the highest
// threshold that is <= netPPW (an exact match uses that tier directly).
function lookupTierRate(netPPW, tiers) {
  let result = null;
  for (const tier of tiers) {
    if (tier.net_ppw_threshold <= netPPW) {
      result = tier;
    } else {
      break;
    }
  }
  return result ? result.dollar_per_kw : null;
}

/**
 * @param {object} deal - contract_value, system_size_kw, pay_split, cashback_amount, has setter
 *   (setter_rep_id), advance_deduction, deduction_other
 * @param {array} adders - [{amount, counts_as_hard_cost}]
 * @param {object} payScale - { hard_floor_ppw, tiers: [{net_ppw_threshold, dollar_per_kw}] (sorted asc) }
 * @param {object} settings - commission_settings row (setter_split_pct, closer_split_pct, cashback_split_pct)
 */
function calculateRepCommission({ deal, adders, payScale, settings }) {
  const hardCosts = sumHardCosts(adders);
  const netPPW = computeNetPPW(deal.contract_value, hardCosts, deal.system_size_kw);

  const belowFloor = netPPW === null || netPPW < payScale.hard_floor_ppw;
  const payScaleRate = belowFloor ? null : lookupTierRate(netPPW, payScale.tiers);

  const hasSetter = !!deal.setter_rep_id;
  let repPool = 0;
  if (payScaleRate !== null) {
    repPool = round2(payScaleRate * deal.system_size_kw * deal.pay_split);
  }

  const setterSplit = settings.setter_split_pct;
  const closerSplit = settings.closer_split_pct;

  let setterPay = 0;
  let closerPayGross = 0;
  if (payScaleRate !== null) {
    if (hasSetter) {
      setterPay = round2(repPool * setterSplit);
      closerPayGross = round2(repPool * closerSplit);
    } else {
      closerPayGross = round2(repPool * 1.0);
    }
  }

  const cashbackDeduction = round2((deal.cashback_amount || 0) * settings.cashback_split_pct);
  // closer_pay_net is the rep's true final approved pay — every deduction that applies to the
  // closer comes out here, never just as a separate display-only figure. Setter is never
  // touched by cashback, advance, or any other deduction.
  const closerPayNet = round2(closerPayGross - cashbackDeduction - (deal.advance_deduction || 0) - (deal.deduction_other || 0));

  return {
    hardCosts: round2(hardCosts),
    netPPW: netPPW === null ? null : round2(netPPW),
    belowFloor,
    payScaleRate,
    repPool,
    setterPay,
    closerPayGross,
    cashbackDeduction,
    closerPayNet
  };
}

/**
 * Setters are paid about a week after install — before the deal is funded and before real
 * costs are final — so their pay is computed from a separate, manually-entered preliminary
 * estimate (Joy's own numbers, frozen at entry), reusing the exact same formula as the real
 * calculation but never touching the deal's actual contract_value/adders/system_size_kw.
 * @param {object} inputs - contractValue, mpuAmount, roofAmount, batteryAmount, miscAmount,
 *   systemSizeKw, paySplit
 * @param {object} payScale - same shape as calculateRepCommission's payScale
 * @param {object} settings - commission_settings row (setter_split_pct)
 */
function calculateSetterPreliminaryPay({ contractValue, mpuAmount, roofAmount, batteryAmount, miscAmount, systemSizeKw, paySplit, payScale, settings }) {
  const hardCosts = (mpuAmount || 0) + (roofAmount || 0) + (batteryAmount || 0) + (miscAmount || 0);
  const netPPW = computeNetPPW(contractValue || 0, hardCosts, systemSizeKw || 0);
  const belowFloor = netPPW === null || netPPW < payScale.hard_floor_ppw;
  const payScaleRate = belowFloor ? null : lookupTierRate(netPPW, payScale.tiers);
  const repPool = payScaleRate !== null ? round2(payScaleRate * (systemSizeKw || 0) * (paySplit || 0.5)) : 0;
  const setterPay = payScaleRate !== null ? round2(repPool * settings.setter_split_pct) : 0;
  return {
    netPPW: netPPW === null ? null : round2(netPPW),
    belowFloor,
    payScaleRate,
    repPool,
    setterPay
  };
}

function calculateOwnerDistribution({ settings, m1Approved, m2Approved }) {
  const etaiM1 = m1Approved ? settings.owner_etai_m1 : 0;
  const etaiM2 = m2Approved ? settings.owner_etai_m2 : 0;
  const noyM1 = m1Approved ? settings.owner_noy_m1 : 0;
  const noyM2 = m2Approved ? settings.owner_noy_m2 : 0;
  return {
    etaiM1: round2(etaiM1), etaiM2: round2(etaiM2), etaiTotal: round2(etaiM1 + etaiM2),
    noyM1: round2(noyM1), noyM2: round2(noyM2), noyTotal: round2(noyM1 + noyM2)
  };
}

// The full per-job bonus, tiered by Net PPW — Joey is then paid half at M1 and half at M2
// (see calculateJoeyBonus below), not the whole thing in one lump sum at M2.
function lookupJoeyTierAmount(netPPW, settings) {
  if (netPPW === null || netPPW === undefined) return 0;
  if (netPPW >= settings.joey_tier2_max) return settings.joey_tier3_amt;
  if (netPPW >= settings.joey_tier1_max) return settings.joey_tier2_amt;
  if (netPPW >= 3.15) return settings.joey_tier1_amt;
  return 0;
}

function calculateJoeyBonus({ netPPW, m1Approved, m2Approved, settings }) {
  const tierAmount = lookupJoeyTierAmount(netPPW, settings);
  const half = round2(tierAmount * 0.5);
  return {
    m1: m1Approved ? half : 0,
    m2: m2Approved ? half : 0
  };
}

// Austin's pay is company-wide per month, not per-deal.
function calculateAustinPay({ monthlyInstalledKw, settings }) {
  const topUp = monthlyInstalledKw * settings.austin_rate_per_kw;
  const total = Math.max(settings.austin_base, topUp);
  return {
    base: settings.austin_base,
    topUp: round2(Math.max(0, topUp - settings.austin_base)),
    total: round2(total)
  };
}

module.exports = {
  sumHardCosts,
  sumAllAdders,
  computeEpcCost,
  computeGross,
  computeExpectedFunding,
  computeNetPPW,
  lookupTierRate,
  calculateRepCommission,
  calculateSetterPreliminaryPay,
  calculateOwnerDistribution,
  calculateJoeyBonus,
  calculateAustinPay,
  round2
};
