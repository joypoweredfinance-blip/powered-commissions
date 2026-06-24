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
 * @param {object} deal - contract_value, system_size_kw, pay_split, cashback_amount, has setter (setter_rep_id)
 * @param {array} adders - [{amount, counts_as_hard_cost}]
 * @param {object} payScale - { hard_floor_ppw, tiers: [{net_ppw_threshold, dollar_per_kw}] (sorted asc) }
 * @param {object} settings - commission_settings row (setter_split_pct, closer_split_pct, cashback_split_pct)
 * @param {number} advanceAlreadyTaken
 * @param {number} clawbackAmount
 */
function calculateRepCommission({ deal, adders, payScale, settings, advanceAlreadyTaken = 0, clawbackAmount = 0 }) {
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
  const closerPayNet = round2(closerPayGross - cashbackDeduction);

  const closerNetPayable = round2(closerPayNet - advanceAlreadyTaken - clawbackAmount);
  const setterNetPayable = setterPay; // setter is never touched by cashback, advance, or clawback

  return {
    hardCosts: round2(hardCosts),
    netPPW: netPPW === null ? null : round2(netPPW),
    belowFloor,
    payScaleRate,
    repPool,
    setterPay,
    closerPayGross,
    cashbackDeduction,
    closerPayNet,
    closerNetPayable,
    setterNetPayable
  };
}

function calculateOwnerDistribution({ settings, m1Approved, m2Approved }) {
  const etaiTotal = (m1Approved ? settings.owner_etai_m1 : 0) + (m2Approved ? settings.owner_etai_m2 : 0);
  const noyTotal = (m1Approved ? settings.owner_noy_m1 : 0) + (m2Approved ? settings.owner_noy_m2 : 0);
  return { etaiTotal: round2(etaiTotal), noyTotal: round2(noyTotal) };
}

// Joey's M2 bonus fires only once a deal reaches M2, tiered by the deal's Net PPW.
function calculateJoeyM2Bonus({ netPPW, m2Approved, settings }) {
  if (!m2Approved || netPPW === null) return 0;
  if (netPPW >= settings.joey_tier2_max) return settings.joey_tier3_amt;
  if (netPPW >= settings.joey_tier1_max) return settings.joey_tier2_amt;
  if (netPPW >= 3.15) return settings.joey_tier1_amt;
  return 0;
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
  computeNetPPW,
  lookupTierRate,
  calculateRepCommission,
  calculateOwnerDistribution,
  calculateJoeyM2Bonus,
  calculateAustinPay,
  round2
};
