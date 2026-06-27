// Re-derives 6 real Project Breakdown PDFs through the commission engine and checks the
// output against what was actually paid. Run with: npm run verify-engine
const { calculateRepCommission } = require('./commissionEngine');

const STANDARD_TIERS = [
  [3.00, 375], [3.25, 400], [3.40, 450], [3.55, 500], [3.70, 525],
  [3.85, 675], [4.00, 725], [4.15, 775], [4.30, 825], [4.45, 875],
  [4.60, 900], [4.75, 925], [4.90, 950], [5.05, 975], [5.20, 1000],
  [5.35, 1025], [5.50, 1050], [5.65, 1075], [5.80, 1100], [5.95, 1125],
  [6.10, 1150], [6.25, 1175], [6.50, 1200], [6.75, 1225], [7.00, 1250]
].map(([net_ppw_threshold, dollar_per_kw]) => ({ net_ppw_threshold, dollar_per_kw }));

const V1_TIERS = [
  [3.25, 500], [3.40, 550], [3.55, 600], [3.70, 650], [3.85, 700],
  [4.00, 800], [4.15, 850], [4.30, 900], [4.45, 950], [4.60, 1000],
  [4.75, 1050], [4.90, 1100], [5.05, 1150], [5.20, 1200], [5.35, 1250],
  [5.50, 1300], [5.65, 1350], [5.80, 1400], [5.95, 1450], [6.10, 1500],
  [6.25, 1550]
].map(([net_ppw_threshold, dollar_per_kw]) => ({ net_ppw_threshold, dollar_per_kw }));

const STANDARD_SCALE = { hard_floor_ppw: 3.20, tiers: STANDARD_TIERS };
const V1_SCALE = { hard_floor_ppw: 3.20, tiers: V1_TIERS };

const SETTINGS = { setter_split_pct: 0.35, closer_split_pct: 0.65, cashback_split_pct: 0.50 };

// Adders reconstructed from each PDF's "Hardware Adders" + "Reroof Cost" tables.
const CASES = [
  {
    name: 'John Kaufman (Roy Fattal — v1 scale, solo closer)',
    deal: { contract_value: 57182.40, system_size_kw: 7.92, pay_split: 0.50, cashback_amount: 0, setter_rep_id: null, advance_deduction: 400 },
    adders: [{ amount: 800, counts_as_hard_cost: true }, { amount: 13000, counts_as_hard_cost: true }, { amount: 3532.32, counts_as_hard_cost: true }],
    payScale: V1_SCALE,
    expect: { netPPW: 5.03, payScaleRate: 1100, closerPayNet: 3956.00 }
  },
  {
    name: 'George Floyd (Roy Fattal — v1 scale, solo closer)',
    deal: { contract_value: 35965.20, system_size_kw: 4.92, pay_split: 0.50, cashback_amount: 0, setter_rep_id: null },
    adders: [{ amount: 5900, counts_as_hard_cost: true }, { amount: 4071.54, counts_as_hard_cost: true }],
    payScale: V1_SCALE,
    expect: { netPPW: 5.28, payScaleRate: 1200, closerPayNet: 2952.00 }
  },
  {
    name: 'Diana Nguyen (Edan Baram setter / Ron Kaminski closer — standard scale)',
    deal: { contract_value: 28126.00, system_size_kw: 4.10, pay_split: 0.50, cashback_amount: 0, setter_rep_id: 1 },
    adders: [{ amount: 4025, counts_as_hard_cost: true }, { amount: 6500, counts_as_hard_cost: true }, { amount: 3000, counts_as_hard_cost: true }],
    payScale: STANDARD_SCALE,
    expect: { netPPW: 3.56, payScaleRate: 500, setterPay: 358.75 }
  },
  {
    name: 'Sarah Newman (Edan Baram setter / Ron Kaminski closer — standard scale)',
    deal: { contract_value: 46708.00, system_size_kw: 8.74, pay_split: 0.50, cashback_amount: 0, setter_rep_id: 1 },
    adders: [{ amount: 6500, counts_as_hard_cost: true }, { amount: 4000, counts_as_hard_cost: true }],
    payScale: STANDARD_SCALE,
    expect: { netPPW: 4.14, payScaleRate: 725, setterPay: 1108.89 }
  },
  {
    name: 'Ray Robledo (Jackson Zicklin setter / Ron Kaminski closer — standard scale)',
    deal: { contract_value: 36722.40, system_size_kw: 5.72, pay_split: 0.50, cashback_amount: 0, setter_rep_id: 1 },
    adders: [{ amount: 13000, counts_as_hard_cost: true }, { amount: 1580.32, counts_as_hard_cost: true }],
    payScale: STANDARD_SCALE,
    expect: { netPPW: 3.87, payScaleRate: 675, setterPay: 675.68 }
  },
  {
    name: 'Mark Kline (Noam Ohayon — standard scale, solo closer) [KNOWN HISTORICAL OUTLIER]',
    deal: { contract_value: 46675.20, system_size_kw: 7.04, pay_split: 0.50, cashback_amount: 0, setter_rep_id: null },
    adders: [{ amount: 700, counts_as_hard_cost: true }, { amount: 6300, counts_as_hard_cost: true }, { amount: 3574, counts_as_hard_cost: true }],
    payScale: STANDARD_SCALE,
    expect: { netPPW: 5.13, payScaleRate: 1000, closerPayNet: 3520.00 },
    note: 'PDF shows $1,000/kW, which is the ROUND-UP tier (5.20). Round-down per the confirmed rule gives the 5.05 tier ($975). Flagging as a pre-existing document, not an engine bug — every other case matches exactly under round-down.'
  }
];

let allPass = true;
for (const c of CASES) {
  const result = calculateRepCommission({
    deal: c.deal,
    adders: c.adders,
    payScale: c.payScale,
    settings: SETTINGS
  });

  const checks = [];
  for (const key of Object.keys(c.expect)) {
    const actual = result[key];
    const expected = c.expect[key];
    const pass = Math.abs(actual - expected) < 0.01;
    checks.push({ key, actual, expected, pass });
    if (!pass) allPass = false;
  }

  console.log(`\n${checks.every((x) => x.pass) ? '✅' : '❌'} ${c.name}`);
  for (const ch of checks) {
    console.log(`   ${ch.pass ? 'OK ' : 'XX '} ${ch.key}: got ${ch.actual}, expected ${ch.expected}`);
  }
  if (c.note) console.log(`   note: ${c.note}`);
}

console.log(`\n${allPass ? 'All cases passed.' : 'One or more cases did not match — see above.'}`);
