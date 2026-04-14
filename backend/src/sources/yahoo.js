// Multi-source market data orchestrator.
// Order: Stooq (reliable, no auth) → Yahoo direct (with retry+jitter) → synthetic (non-strict only)
// Exposed name kept as "yahoo.js" to avoid churn in callers.

import { fetchStooqDaily, fetchStooqQuote } from "./stooq.js";
import { fetchTwelveDaily } from "./twelvedata.js";
import { fetchMassiveDaily, fetchMassiveQuote } from "./massive.js";
import { fetchCandlesSynthetic, fetchQuoteSynthetic, fetchSectorSynthetic } from "./synthetic.js";

const DEMO = process.env.SIGNA_DEMO === "1";
const STRICT = process.env.SIGNA_STRICT !== "0";

export const sourceStatus = {};

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const TF_MAP = {
  "1D": { interval: "1d", range: "2y" },
  "4H": { interval: "1h", range: "60d" },
  "1H": { interval: "1h", range: "60d" },
  "15M": { interval: "15m", range: "60d" },
};

const PRICE_BOUNDS = {
  AAPL: [80, 500], NVDA: [40, 500], TSLA: [80, 800], MSFT: [200, 900],
  GOOGL: [80, 500], META: [200, 1200], AMZN: [80, 600], AMD: [40, 400],
  SOFI: [2, 50], GME: [5, 200], SPY: [300, 900], QQQ: [300, 900],
};
function sanityOK(symbol, price) {
  const b = PRICE_BOUNDS[symbol];
  if (!b) return price > 0.5;
  return price >= b[0] && price <= b[1];
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function yahooChart(symbol, interval, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false&events=div,split`;
  // Retry with jitter on 429
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, "Accept": "application/json", "Accept-Language": "en-US,en;q=0.9" },
      });
      if (res.status === 429) {
        const wait = 2000 + Math.random() * 3000 + attempt * 2000;
        await sleep(wait);
        lastErr = new Error(`HTTP 429 (retry ${attempt+1})`);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const r = json?.chart?.result?.[0];
      if (!r) throw new Error(json?.chart?.error?.description || "no result");
      const ts = r.timestamp || [];
      const q = r.indicators?.quote?.[0] || {};
      const adj = r.indicators?.adjclose?.[0]?.adjclose || [];
      const out = [];
      for (let i = 0; i < ts.length; i++) {
        const close = adj[i] ?? q.close?.[i];
        const volume = q.volume?.[i];
        if (close == null || volume == null) continue;
        out.push({
          ts: ts[i],
          open: q.open?.[i] ?? close,
          high: q.high?.[i] ?? close,
          low: q.low?.[i] ?? close,
          close, volume,
        });
      }
      return { candles: out, meta: r.meta || {} };
    } catch (e) {
      lastErr = e;
      if (!String(e.message).includes("429")) break;
    }
  }
  throw lastErr || new Error("Yahoo unknown error");
}

export async function fetchCandles(symbol, timeframe = "1D", opts = {}) {
  // opts.caller: "search" → TwelveData is primary (on-demand, rare); "watchlist" → TwelveData skipped (high volume, would burn 800/day quota in hours)
  const caller = opts.caller || "watchlist";
  if (DEMO) {
    sourceStatus[symbol] = { source: "synthetic", reason: "SIGNA_DEMO=1", ts: Date.now() };
    return fetchCandlesSynthetic(symbol, timeframe);
  }

  const errors = [];
  const hasMassive = !!process.env.MASSIVE_API_KEY;
  const hasTwelve = !!(process.env.TWELVE_DATA_KEY || process.env.TWELVEDATA_KEY);

  // ── Search callers: TwelveData FIRST ──────────────────────────────
  // TwelveData has its own quota (800/day, 8/min) separate from Massive's
  // throttle queue. Trying it first means searches return in 1–2s instead
  // of waiting behind the worker's Massive queue (which can be 30–90s deep).
  const twelveSkipUntil = globalThis.__twelveQuotaExhaustedUntil || 0;
  const twelveAvailable = timeframe === "1D" && hasTwelve && caller === "search" && Date.now() >= twelveSkipUntil;
  if (twelveAvailable) {
    try {
      const candles = await fetchTwelveDaily(symbol);
      const last = candles[candles.length - 1].close;
      if (sanityOK(symbol, last)) {
        sourceStatus[symbol] = { source: "twelvedata", latestClose: last, bars: candles.length, ts: Date.now() };
        console.log(`[twelvedata] ${symbol} ← ${candles.length} bars, last=$${last.toFixed(2)}`);
        return candles;
      }
      errors.push(`twelvedata: sanity fail $${last}`);
    } catch (e) {
      if (/out of api credits|credits were used/i.test(e.message)) {
        const now = new Date();
        const tomorrowUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 1);
        globalThis.__twelveQuotaExhaustedUntil = tomorrowUTC;
        console.warn(`[twelvedata] quota exhausted — skipping until ${new Date(tomorrowUTC).toISOString()}`);
      }
      errors.push(`twelvedata: ${e.message}`);
    }
  } else if (timeframe === "1D" && hasTwelve && caller !== "search") {
    // Silently skipped for watchlist — expected behavior, not an error.
  } else if (timeframe === "1D" && hasTwelve && Date.now() < twelveSkipUntil) {
    errors.push(`twelvedata: skipped (quota exhausted until UTC midnight)`);
  }

  // ── Massive.com — primary for watchlist worker, fallback for search ──
  if (timeframe === "1D" && hasMassive) {
    try {
      const candles = await fetchMassiveDaily(symbol);
      if (candles.length >= 20) {
        const last = candles[candles.length - 1].close;
        if (sanityOK(symbol, last)) {
          sourceStatus[symbol] = { source: "massive", latestClose: last, bars: candles.length, ts: Date.now() };
          console.log(`[massive] ${symbol} ← ${candles.length} bars, last=$${last.toFixed(2)}`);
          return candles;
        }
        errors.push(`massive: sanity fail $${last}`);
      } else {
        errors.push(`massive: only ${candles.length} bars`);
      }
    } catch (e) { errors.push(`massive: ${e.message}`); }
  }

  // 2) Stooq (works only if STOOQ_API_KEY set — captcha-gated since 2025)
  if (timeframe === "1D") {
    try {
      const candles = await fetchStooqDaily(symbol);
      if (candles.length > 20) {
        const last = candles[candles.length - 1].close;
        if (sanityOK(symbol, last)) {
          sourceStatus[symbol] = {
            source: "stooq",
            latestClose: last,
            bars: candles.length,
            delayMin: null,
            ts: Date.now(),
          };
          console.log(`[stooq] ${symbol} ← ${candles.length} bars, last=$${last.toFixed(2)}`);
          return candles;
        }
        errors.push(`stooq: sanity fail $${last}`);
      } else {
        errors.push(`stooq: only ${candles.length} bars`);
      }
    } catch (e) { errors.push(`stooq: ${e.message}`); }
  }

  // 2) Yahoo HTTP (fallback, supports intraday)
  const cfg = TF_MAP[timeframe] || TF_MAP["1D"];
  try {
    const { candles, meta } = await yahooChart(symbol, cfg.interval, cfg.range);
    if (!candles.length) throw new Error("empty");
    const last = candles[candles.length - 1].close;
    if (!sanityOK(symbol, last)) throw new Error(`sanity fail $${last}`);
    sourceStatus[symbol] = {
      source: "yahoo-http",
      latestClose: last,
      bars: candles.length,
      delayMin: meta.regularMarketTime ? Math.round((Date.now()/1000 - meta.regularMarketTime)/60) : 15,
      ts: Date.now(),
    };
    console.log(`[yahoo-http] ${symbol} ${timeframe} ← ${candles.length} bars, last=$${last.toFixed(2)}`);
    return candles;
  } catch (e) { errors.push(`yahoo: ${e.message}`); }

  // 4) Fail
  const msg = errors.join(" | ");
  console.error(`[market] ${symbol} all sources failed: ${msg}`);
  sourceStatus[symbol] = { source: "failed", error: msg, ts: Date.now() };
  if (STRICT) throw new Error(msg);
  sourceStatus[symbol] = { source: "synthetic", reason: msg, ts: Date.now() };
  return fetchCandlesSynthetic(symbol, timeframe);
}

export async function fetchQuote(symbol) {
  if (DEMO) return fetchQuoteSynthetic(symbol);
  if (process.env.MASSIVE_API_KEY) {
    try {
      const q = await fetchMassiveQuote(symbol);
      if (sanityOK(symbol, q.price)) return q;
    } catch (e) {
      console.warn(`[massive] quote ${symbol} failed: ${e.message} — trying stooq`);
    }
  }
  try {
    const q = await fetchStooqQuote(symbol);
    if (!sanityOK(symbol, q.price)) throw new Error(`sanity fail $${q.price}`);
    return {
      symbol,
      name: symbol,
      price: q.price,
      change: ((q.price - q.open) / q.open) * 100,
      volume: q.volume,
      marketState: "REGULAR",
      delayMs: 15 * 60 * 1000,
      source: "stooq",
    };
  } catch (e) {
    console.warn(`[stooq] quote ${symbol} failed: ${e.message} — trying yahoo`);
  }
  try {
    const { candles, meta } = await yahooChart(symbol, "1d", "5d");
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2] || last;
    if (!sanityOK(symbol, last.close)) throw new Error(`sanity fail $${last.close}`);
    return {
      symbol,
      name: meta.shortName || symbol,
      price: last.close,
      change: ((last.close - prev.close) / prev.close) * 100,
      volume: last.volume,
      marketState: meta.marketState || "UNKNOWN",
      delayMs: 15 * 60 * 1000,
      source: "yahoo-http",
    };
  } catch (e) {
    console.error(`[market] quote ${symbol} all sources failed: ${e.message}`);
    if (STRICT) throw e;
    return fetchQuoteSynthetic(symbol);
  }
}

export async function fetchSectorForSymbol(symbol) {
  if (DEMO) return fetchSectorSynthetic(symbol);
  return null; // Stooq doesn't have sector; leaving null rather than faking
}
