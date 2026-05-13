// Shared formatters — kept tiny on purpose. Anything more complex belongs in lib/.
const _USD0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const _INT  = new Intl.NumberFormat('en-US');
const _DEC1 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const _DEC2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtMoney  = (v) => v == null ? '—' : _USD0.format(Math.round(v));
export const fmtMoney1 = (v) => v == null ? '—' : _USD0.format(Math.round(v / 1000) * 1000);
export const fmtInt    = (v) => v == null ? '—' : _INT.format(Math.round(v));
export const fmtPct    = (v) => v == null ? '—' : `${_DEC1.format(v)}%`;
export const fmtRatio  = (v) => v == null ? '—' : _DEC2.format(v);
export const fmtRange  = (lo, hi, fmt = fmtMoney) => `${fmt(lo)} – ${fmt(hi)}`;

// Plain-language deltas (county vs comparison)
export function deltaText(county, comparison, { higher = 'higher', lower = 'lower', units = '' } = {}) {
  if (county == null || comparison == null) return '';
  const diff = county - comparison;
  if (Math.abs(diff) < 0.5) return 'in line with';
  if (diff > 0) return `${units ? Math.abs(diff).toFixed(1) + units : '+' + Math.abs(diff).toFixed(1)} ${higher} than`;
  return `${units ? Math.abs(diff).toFixed(1) + units : '−' + Math.abs(diff).toFixed(1)} ${lower} than`;
}

// Affordability calculator — standard 30%-of-income / 30-year-mortgage formula.
//   monthly_cost_max = monthly_income * 0.30
//   P&I portion = monthly_cost_max - (taxes/insurance/12) - PMI
//   solve for principal at given rate/term.
export function affordableHomePrice({
  annualIncome,
  interestRate = 0.07,
  termYears    = 30,
  downPaymentPct = 0.05,
  annualTaxesInsurance = 2500,
  pmiRate      = 0.005,
  housingBudgetPct = 0.30,
} = {}) {
  if (annualIncome == null) return null;
  const monthlyBudget = (annualIncome * housingBudgetPct) / 12;
  const monthlyTaxIns = annualTaxesInsurance / 12;

  // Solve for loan principal s.t. monthly P&I + tax/ins + PMI <= monthlyBudget
  // Use a numeric solver to incorporate PMI (which is proportional to loan amount).
  const monthlyRate = interestRate / 12;
  const n = termYears * 12;
  const piFactor = monthlyRate === 0 ? (1 / n) : (monthlyRate * Math.pow(1 + monthlyRate, n)) / (Math.pow(1 + monthlyRate, n) - 1);
  const pmiMonthlyRate = pmiRate / 12;

  // monthlyBudget = principal * piFactor + monthlyTaxIns + principal * pmiMonthlyRate
  // principal * (piFactor + pmiMonthlyRate) = monthlyBudget - monthlyTaxIns
  const principal = (monthlyBudget - monthlyTaxIns) / (piFactor + pmiMonthlyRate);
  if (principal <= 0) return { monthlyBudget, principal: 0, homePrice: 0 };
  const homePrice = principal / (1 - downPaymentPct);
  return {
    monthlyBudget,
    principal,
    homePrice,
  };
}

export function workforceRange(medianIncome) {
  if (medianIncome == null) return null;
  return {
    low:  medianIncome * 0.80,
    mid:  medianIncome,
    high: medianIncome * 1.20,
  };
}
