const memoryCache = new Map();

export async function convertCurrency(amount, from, to) {
  const value = Number(amount || 0);
  if (!Number.isFinite(value)) return 0;
  if (!from || !to || from === to) return value;

  const cleanFrom = String(from).toUpperCase();
  const cleanTo = String(to).toUpperCase();
  const key = `${cleanFrom}_${cleanTo}`;

  if (memoryCache.has(key)) return value * memoryCache.get(key);

  const res = await fetch(`/api/fx?from=${encodeURIComponent(cleanFrom)}&to=${encodeURIComponent(cleanTo)}`);
  if (!res.ok) throw new Error(`FX lookup failed for ${cleanFrom} to ${cleanTo}`);

  const data = await res.json();
  const rate = Number(data?.rate);
  if (!rate) throw new Error(`FX rate missing for ${cleanFrom} to ${cleanTo}`);

  memoryCache.set(key, rate);
  return value * rate;
}

export async function getLatestRate(from, to) {
  if (!from || !to || from === to) return 1;
  return convertCurrency(1, from, to);
}
