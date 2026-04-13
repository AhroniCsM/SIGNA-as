// Massive.com — Polygon-compatible REST API. Daily OHLCV, no captcha.
// Free tier: ~5 req/min, 15-min delayed EOD data. Bearer auth.

const BASE = "https://api.massive.com";

function toDate(d) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

// Free tier: 5 req/min. Serialize all calls with 13s spacing to stay under limit.
// Shared across all callers (worker + search) since quota is global.
let _lastCallAt = 0;
let _chain = Promise.resolve();
const MIN_SPACING_MS = 13_000;
function throttle(fn) {
  const run = async () => {
    const wait = Math.max(0, _lastCallAt + MIN_SPACING_MS - Date.now());
    if (wait) await new Promise(r => setTimeout(r, wait));
    _lastCallAt = Date.now();
    return fn();
  };
  _chain = _chain.then(run, run);
  return _chain;
}

export async function fetchMassiveDaily(symbol, years = 2) {
  const key = process.env.MASSIVE_API_KEY;
  if (!key) throw new Error("MASSIVE_API_KEY not set");
  const to = new Date();
  const from = new Date(to.getTime() - years * 365 * 24 * 3600 * 1000);
  const url = `${BASE}/v2/aggs/ticker/${encodeURIComponent(symbol.toUpperCase())}/range/1/day/${toDate(from)}/${toDate(to)}?adjusted=true&sort=asc&limit=50000`;
  const j = await throttle(async () => {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Massive HTTP ${res.status}: ${body.slice(0, 160)}`);
    }
    return res.json();
  });
  if (!Array.isArray(j.results) || j.results.length === 0) {
    throw new Error(`Massive: no results (${j.status || "empty"})`);
  }
  return j.results.map(r => ({
    ts: Math.floor(r.t / 1000),   // ms → seconds
    open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v,
  }));
}

export async function fetchMassiveQuote(symbol) {
  // Use the last daily bar as the quote (EOD data — no real-time on free tier).
  const bars = await fetchMassiveDaily(symbol, 0.03);   // ~10 days
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2] || last;
  return {
    symbol,
    name: symbol,
    price: last.close,
    open: last.open,
    change: ((last.close - prev.close) / prev.close) * 100,
    volume: last.volume,
    marketState: "REGULAR",
    delayMs: 15 * 60 * 1000,
    source: "massive",
  };
}
