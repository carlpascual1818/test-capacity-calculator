export default async function handler(req, res) {
  try {
    const from = String(req.query.from || '').toUpperCase();
    const to = String(req.query.to || '').toUpperCase();

    if (!from || !to) {
      return res.status(400).json({ error: 'Missing from or to currency.' });
    }

    if (from === to) {
      return res.status(200).json({ from, to, rate: 1 });
    }

    const url = `https://api.frankfurter.app/latest?amount=1&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const response = await fetch(url);

    if (!response.ok) {
      return res.status(response.status).json({ error: `Frankfurter request failed for ${from} to ${to}.` });
    }

    const data = await response.json();
    const rate = Number(data?.rates?.[to]);

    if (!rate) {
      return res.status(500).json({ error: `FX rate missing for ${from} to ${to}.` });
    }

    return res.status(200).json({ from, to, rate });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'FX lookup failed.' });
  }
}
