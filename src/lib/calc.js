import { convertCurrency } from './fx';

async function averageProcessorFee({ processors, aov, productCurrency, displayCurrency }) {
  const active = processors.filter(p => p.active);
  if (!active.length || !Number(aov)) return 0;
  let total = 0;
  for (const p of active) {
    const aovDisplay = await convertCurrency(aov, productCurrency, displayCurrency);
    const fixedDisplay = await convertCurrency(Number(p.fixed_fee || 0), p.fixed_fee_currency || displayCurrency, displayCurrency);
    const processing = aovDisplay * (Number(p.percent_fee || 0) / 100) + fixedDisplay;
    const conversion = productCurrency !== displayCurrency
      ? aovDisplay * (Number(p.conversion_fee_percent || 0) / 100)
      : 0;
    total += processing + conversion;
  }
  return total / active.length;
}

export async function calculateProduct(product, processors, displayCurrency) {
  const adSpend = Number(product.daily_ad_spend || 0);
  const roas = Number(product.roas || 0);
  const cogsPct = Number(product.cogs_pct || 0) / 100;
  const aov = Number(product.aov || 0);
  const opexLocal = Number(product.opex_share || 0);
  const currency = product.currency || 'USD';

  const netSalesLocal = roas * adSpend;
  const cogsLocal = cogsPct * netSalesLocal;
  const dailyOrders = aov > 0 ? netSalesLocal / aov : 0;

  const feePerOrder = await averageProcessorFee({ processors, aov, productCurrency: currency, displayCurrency });
  const totalFeesDisplay = feePerOrder * dailyOrders;

  const [adSpendD, netSalesD, cogsD, opexD] = await Promise.all([
    convertCurrency(adSpend, currency, displayCurrency),
    convertCurrency(netSalesLocal, currency, displayCurrency),
    convertCurrency(cogsLocal, currency, displayCurrency),
    convertCurrency(opexLocal, currency, displayCurrency),
  ]);

  const netProfit = netSalesD - adSpendD - cogsD - totalFeesDisplay - opexD;
  const ber = (netSalesD - cogsD - totalFeesDisplay - opexD) > 0
    ? netSalesD / (netSalesD - cogsD - totalFeesDisplay - opexD)
    : 0;

  return {
    adSpend: adSpendD, roas, cogsPct, aov,
    cogs: cogsD, fees: totalFeesDisplay, opex: opexD,
    netSales: netSalesD, netProfit, ber, currency,
    dailyOrders: Math.round(dailyOrders * 10) / 10,
  };
}

// Build scenario columns from dynamic kill profile rules
// Each rule: { id, name, spend_threshold, condition, outcome }
// outcome 'kill'     → daily burden = spend_threshold (burn, no revenue)
// outcome 'continue' → daily burden = 0 (self-funding or profitable, not a drag)
export function calculateScenarios(totalProfit, killProfile) {
  if (!killProfile) return [];
  const rules = Array.isArray(killProfile.rules) ? killProfile.rules : [];
  if (!rules.length) return [];

  const CONDITIONS = {
    no_atc: 'No ATC',
    no_purchase: 'No purchase',
    no_sales: 'No sales',
    profitable: 'Profitable',
    roas_below: 'ROAS below threshold',
  };

  return rules.map(rule => {
    const threshold = Number(rule.spend_threshold || 0);
    const isKill = rule.outcome === 'kill';
    // For kill rules: daily burden = threshold (assumes spent in 1 day or averaged)
    // For continue rules: burden = 0, test is self-funding
    const burn = isKill ? threshold : 0;

    return {
      id: rule.id,
      label: rule.name || `${CONDITIONS[rule.condition] || rule.condition} at $${threshold}`,
      threshold,
      condition: CONDITIONS[rule.condition] || rule.condition,
      outcome: rule.outcome,
      isKill,
      burn,
      note: isKill
        ? (rule.condition === 'roas_below'
            ? `Kill at $${threshold} spend — ROAS < ${rule.roas_threshold ?? 'BEROAS'}`
            : `Kill at $${threshold} spend — ${CONDITIONS[rule.condition] || rule.condition}`)
        : `Continue — ${CONDITIONS[rule.condition] || rule.condition} at $${threshold}`,
      description: isKill
        ? (rule.condition === 'roas_below'
            ? `Test killed at $${threshold} spend when ROAS drops below ${rule.roas_threshold ?? 'BEROAS'}. Full spend counted as daily loss.`
            : `Test killed at $${threshold} spend. ${CONDITIONS[rule.condition] || rule.condition}. Full amount counted as daily loss.`)
        : `Test continues running. ${CONDITIONS[rule.condition] || rule.condition} at $${threshold}. Assumed self-funding — no drag on winners.`,
      maxTests: burn > 0 ? Math.floor(totalProfit / burn) : Infinity,
      storeNets: [0, 1, 2, 3, 4, 5].map(n => totalProfit - n * burn),
    };
  });
}
