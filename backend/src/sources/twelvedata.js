// Twelve Data source — free tier, 800 req/day.
// Get a free API key in 10 seconds at https://twelvedata.com/register, then:
//   export TWELVE_DATA_KEY=xxxxx
// The key "demo" works for AAPL/MSFT/AMZN as a built-in demo.

const BASE = "https://api.twelvedata.com";

function getKey() {
  return process.env.TWELVE_DATA_KEY || process.env.TWELVEDATA_KEY || null;
}

export async function fetchTwelveDaily(symbol) {
  const key = getKey();
  if (!key) throw new Error("TWELVE_DATA_KEY not set");
  const url = `${BASE}/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=500&apikey=${key}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.status === "error") throw new Error(`TwelveData: ${json.message}`);
  if (!Array.isArray(json.values)) throw new Error(`TwelveData: no values`);
  const out = json.values
    .slice() // newest-first by default
    .reverse() // oldest-first for our engine
    .map(v => ({
      ts: Math.floor(new Date(v.datetime + "T21:00:00Z").getTime() / 1000),
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close),
      volume: parseFloat(v.volume),
    }))
    .filter(r => isFinite(r.close) && isFinite(r.volume));
  // Drop trailing bars with volume=0. TwelveData free tier returns the current
  // (unfinalized) session with volume=0 until late in the day, which poisons
  // the vol_ratio calc (ends up as 0.0× and flags spurious "volume dry-up").
  while (out.length && (out[out.length - 1].volume === 0 || !isFinite(out[out.length - 1].volume))) {
    out.pop();
  }
  if (out.length < 20) throw new Error(`TwelveData: only ${out.length} bars`);
  return out;
}

export async function fetchTwelveQuote(symbol) {
  const key = getKey();
  if (!key) throw new Error("TWELVE_DATA_KEY not set");
  const url = `${BASE}/quote?symbol=${encodeURIComponent(symbol)}&apikey=${key}`;
  const res = await fetch(url);
  const q = await res.json();
  if (q.status === "error") throw new Error(`TwelveData: ${q.message}`);
  return {
    symbol,
    price: parseFloat(q.close),
    open: parseFloat(q.open),
    high: parseFloat(q.high),
    low: parseFloat(q.low),
    volume: parseFloat(q.volume),
    name: q.name,
  };
}
