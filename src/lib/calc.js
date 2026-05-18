import { convertCurrency } from './fx';

export async function calculateProduct(product, displayCurrency) {
  const adSpend = Number(product.daily_ad_spend || 0);
  const roas = Number(product.roas || 0);
  const costPct = Number(product.variable_cost_pct || 0) / 100;
  const opexLocal = Number(product.opex_share || 0);
  const currency = product.currency || 'USD';

  const netSalesLocal = roas * adSpend;
  const varCostsLocal = costPct * netSalesLocal;
  const netProfitLocal = netSalesLocal - adSpend - varCostsLocal - opexLocal;
  const berLocal = (netSalesLocal - varCostsLocal - opexLocal) > 0
    ? netSalesLocal / (netSalesLocal - varCostsLocal - opexLocal)
    : 0;

  if (!displayCurrency || currency === displayCurrency) {
    return { adSpend, roas, costPct, opex: opexLocal, netSales: netSalesLocal, varCosts: varCostsLocal, netProfit: netProfitLocal, ber: berLocal, currency };
  }

  const [adSpendD, opexD, netSalesD, varCostsD, netProfitD] = await Promise.all([
    convertCurrency(adSpend, currency, displayCurrency),
    convertCurrency(opexLocal, currency, displayCurrency),
    convertCurrency(netSalesLocal, currency, displayCurrency),
    convertCurrency(varCostsLocal, currency, displayCurrency),
    convertCurrency(netProfitLocal, currency, displayCurrency),
  ]);

  const berD = (netSalesD - varCostsD - opexD) > 0 ? netSalesD / (netSalesD - varCostsD - opexD) : 0;

  return { adSpend: adSpendD, roas, costPct, opex: opexD, netSales: netSalesD, varCosts: varCostsD, netProfit: netProfitD, ber: berD, currency };
}

export function calculateScenarios(totalProfit, killProfile) {
  if (!killProfile) return [];

  const testBudget = Number(killProfile.test_budget_per_day || 0);
  const kill1 = Number(killProfile.kill1_no_atc || 0);
  const kill2 = Number(killProfile.kill2_no_purchase || 0);
  const kill3 = Number(killProfile.kill3_day2_no_sales || 0);

  const scenarios = [
    { label: 'Best case', burn: kill1, note: `Kill Day 1 at $${kill1} — no ATC`, description: 'Killed on Day 1 before ATC. Lowest possible exposure per test.' },
    { label: 'Typical', burn: kill2, note: `Kill Day 1 at $${kill2} — no purchase`, description: 'Killed on Day 1 after spend but no conversion. Most common outcome.' },
    { label: 'Worst case', burn: (testBudget + kill3) / 2, note: `2-day avg: $${testBudget} Day 1 + $${kill3} Day 2`, description: `Full Day 1 run ($${testBudget}) then killed Day 2 ($${kill3} additional). Averaged over 2 days.` },
  ];

  return scenarios.map(s => ({
    ...s,
    maxTests: s.burn > 0 ? Math.floor(totalProfit / s.burn) : Infinity,
    storeNets: [0, 1, 2, 3, 4, 5].map(n => totalProfit - n * s.burn),
  }));
}
