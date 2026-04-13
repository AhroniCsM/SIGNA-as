// Synthetic candle generator — used when SIGNA_DEMO=1 or network unavailable.
// Deterministic per-symbol so signals are stable across scans.

function hash(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }

function mulberry32(seed) {
  return () => {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Per-symbol profile: bias (trend strength), volatility, baseVolume.
const PROFILE = {
  AAPL:  { bias:  0.0010, vol: 0.013, px: 195,   name: "Apple Inc.",   sector: "Technology" },
  NVDA:  { bias:  0.0014, vol: 0.022, px: 142,   name: "NVIDIA",       sector: "Semiconductors" },
  TSLA:  { bias:  0.0004, vol: 0.028, px: 265,   name: "Tesla",        sector: "Consumer Cyclical" },
  AMD:   { bias:  0.0002, vol: 0.025, px: 168,   name: "AMD",          sector: "Semiconductors" },
  SOFI:  { bias:  0.0009, vol: 0.020, px:  10,   name: "SoFi",         sector: "Financial Services" },
  JRNL:  { bias:  0.0015, vol: 0.030, px:   8,   name: "Journal Co.",  sector: "Communication" },
  GME:   { bias: -0.0008, vol: 0.035, px:  13,   name: "GameStop",     sector: "Consumer Cyclical" },
  MSFT:  { bias:  0.0008, vol: 0.011, px: 410,   name: "Microsoft",    sector: "Technology" },
  META:  { bias:  0.0012, vol: 0.018, px: 505,   name: "Meta",         sector: "Communication" },
  GOOGL: { bias:  0.0009, vol: 0.015, px: 165,   name: "Alphabet",     sector: "Communication" },
};

export function fetchCandlesSynthetic(symbol, timeframe = "1D") {
  const p = PROFILE[symbol] || { bias: 0.0003, vol: 0.02, px: 50, name: symbol, sector: "Other" };
  const n = 260;
  const rnd = mulberry32(hash(symbol + ":" + timeframe));
  const out = [];
  let price = p.px * 0.6;          // start ~40% below "today" so trend looks real
  const start = Math.floor(Date.now() / 1000) - n * 86400;
  for (let i = 0; i < n; i++) {
    const shock = (rnd() - 0.5) * 2 * p.vol;
    const close = price * (1 + p.bias + shock);
    const high = Math.max(price, close) * (1 + rnd() * p.vol * 0.5);
    const low = Math.min(price, close) * (1 - rnd() * p.vol * 0.5);
    const volume = 1e6 * (0.6 + rnd() * 0.8);
    out.push({ ts: start + i * 86400, open: price, high, low, close, volume });
    price = close;
  }
  // Give the final bar a bit of punch for interesting signals
  const last = out.at(-1);
  const pop = 1 + p.bias * 20;
  last.close = last.open * pop;
  last.high = last.close * 1.01;
  last.volume *= 2.2;
  return out;
}

export function fetchQuoteSynthetic(symbol) {
  const p = PROFILE[symbol] || { name: symbol, px: 50 };
  const candles = fetchCandlesSynthetic(symbol);
  const last = candles.at(-1);
  const prev = candles.at(-2);
  return {
    symbol,
    name: p.name,
    price: last.close,
    change: ((last.close / prev.close) - 1) * 100,
    volume: last.volume,
    marketState: "REGULAR",
    delayMs: 0,
  };
}

export function fetchSectorSynthetic(symbol) {
  return PROFILE[symbol]?.sector || "Other";
}
