// Free fundamentals layer — Yahoo quoteSummary (no auth, unofficial but stable).
// Provides: analyst consensus, next earnings date, key ratios, company name/logo.
//
// Cached per-symbol for 6 hours — fundamentals don't move intraday and this
// endpoint occasionally rate-limits aggressive callers.

const CACHE_MS = 6 * 60 * 60 * 1000;   // 6 h
const _cache = new Map();              // symbol -> { ts, data }

const BASE = "https://query2.finance.yahoo.com/v10/finance/quoteSummary";
const MODULES = "financialData,defaultKeyStatistics,calendarEvents,summaryProfile,price,earnings";

// Clearbit free logo API — resolves a domain to a company logo PNG
const LOGO_BASE = "https://logo.clearbit.com";

function num(v) { return v && typeof v.raw === "number" ? v.raw : (typeof v === "number" ? v : null); }
function fmt(v) { return v && typeof v.fmt === "string" ? v.fmt : null; }

export async function fetchFundamentals(symbol) {
  const sym = symbol.toUpperCase();
  const cached = _cache.get(sym);
  if (cached && Date.now() - cached.ts < CACHE_MS) return cached.data;

  const url = `${BASE}/${encodeURIComponent(sym)}?modules=${MODULES}`;
  let json;
  try {
    const res = await fetch(url, {
      headers: {
        // Yahoo blocks empty UAs; this matches a common browser fingerprint
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
      },
    });
    if (!res.ok) throw new Error(`Yahoo fundamentals HTTP ${res.status}`);
    json = await res.json();
  } catch (e) {
    // Return null cache so we don't hammer on repeat failures; short TTL
    _cache.set(sym, { ts: Date.now() - CACHE_MS + 5 * 60 * 1000, data: null });
    return null;
  }

  const r = json?.quoteSummary?.result?.[0];
  if (!r) return null;

  const fd = r.financialData || {};
  const ks = r.defaultKeyStatistics || {};
  const ce = r.calendarEvents || {};
  const pr = r.price || {};
  const sp = r.summaryProfile || {};

  // Earnings date — next upcoming. Yahoo returns a range [start, end] or single value.
  let nextEarningsTs = null;
  const eDates = ce.earnings?.earningsDate || [];
  if (Array.isArray(eDates) && eDates.length > 0) {
    nextEarningsTs = num(eDates[0]);
  }

  // Domain for logo — from summaryProfile.website or derived
  let website = sp.website || null;
  let domain = null;
  if (website) {
    try { domain = new URL(website).hostname.replace(/^www\./, ""); } catch {}
  }

  // Map Yahoo sector name → S&P sector ETF we track in regime.js
  const SECTOR_TO_ETF = {
    "Technology": "XLK",
    "Financial Services": "XLF", "Financial": "XLF",
    "Healthcare": "XLV",
    "Consumer Cyclical": "XLY",
    "Consumer Defensive": "XLP",
    "Energy": "XLE",
    "Industrials": "XLI",
    "Utilities": "XLU",
    "Basic Materials": "XLB",
    "Real Estate": "XLRE",
    "Communication Services": "XLC",
  };
  const sector = sp.sector || null;
  const industry = sp.industry || null;
  const sectorETF = sector ? (SECTOR_TO_ETF[sector] || null) : null;

  const data = {
    symbol: sym,
    name: pr.longName || pr.shortName || null,
    exchange: pr.exchangeName || null,
    marketCap: num(pr.marketCap),
    logo: domain ? `${LOGO_BASE}/${domain}` : null,
    sector,
    industry,
    sectorETF,
    analyst: {
      targetMean: num(fd.targetMeanPrice),
      targetHigh: num(fd.targetHighPrice),
      targetLow: num(fd.targetLowPrice),
      targetMedian: num(fd.targetMedianPrice),
      analystCount: num(fd.numberOfAnalystOpinions),
      recommendationKey: fd.recommendationKey || null,     // "buy" / "hold" / "sell" etc.
      recommendationMean: num(fd.recommendationMean),      // 1 (strong buy) - 5 (strong sell)
    },
    earnings: {
      nextDateTs: nextEarningsTs,
      nextDateLabel: nextEarningsTs ? new Date(nextEarningsTs * 1000).toISOString().slice(0, 10) : null,
      daysUntil: nextEarningsTs ? Math.round((nextEarningsTs * 1000 - Date.now()) / (24 * 3600 * 1000)) : null,
      trailingEps: num(ks.trailingEps),
      forwardEps: num(ks.forwardEps),
      epsGrowth: num(ks.earningsQuarterlyGrowth),          // YoY quarterly EPS growth
      revenueGrowth: num(fd.revenueGrowth),                // YoY quarterly revenue growth
    },
    ratios: {
      peTrailing: num(ks.trailingPE),
      peForward: num(ks.forwardPE),
      pegRatio: num(ks.pegRatio),
      profitMargin: num(fd.profitMargins),
      returnOnEquity: num(fd.returnOnEquity),
      debtToEquity: num(fd.debtToEquity),
    },
    fetchedAt: Date.now(),
  };

  _cache.set(sym, { ts: Date.now(), data });
  return data;
}

// ── Blackout rule ────────────────────────────────────────────────
// Earnings is binary-outcome risk — a signal entered within the blackout
// window is gambling on the report, not trading the trend. Default: 3 days.
export function inEarningsBlackout(fund, windowDays = 3) {
  if (!fund?.earnings?.daysUntil && fund?.earnings?.daysUntil !== 0) return false;
  const d = fund.earnings.daysUntil;
  return d >= 0 && d <= windowDays;
}
