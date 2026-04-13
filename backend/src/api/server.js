// Express API — read-only endpoints the React dashboard consumes.

import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { openDb, initSchema, upsertTicker } from "../db/schema.js";
import { calcPositionSize, computeSignal } from "../engine/signalEngine.js";
import { computeAll } from "../engine/indicators.js";
import { sourceStatus, fetchCandles, fetchQuote } from "../sources/yahoo.js";
import { fetchApeWisdomForWatchlist } from "../sources/apewisdom.js";
import { summarizeStockTwits } from "../sources/stocktwits.js";
import { getMarketRegime, applyRegimeToSignal } from "../engine/regime.js";
import { fetchFundamentals } from "../sources/fundamentals.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const db = openDb();
initSchema(db);

const app = express();
app.use(cors());
app.use(express.json());

// ── Market regime (macro gate) — cached 30 min, triggers async background fetch if stale
app.get("/api/market-regime", async (req, res) => {
  try {
    const force = req.query.force === "1";
    // Wait for first compute — can take ~3 min on cold start. Return what we have if cached.
    const regime = await getMarketRegime({ wait: true, force });
    if (!regime) return res.status(202).json({ state: "COMPUTING", message: "First regime computation in progress. Retry in 2–3 minutes." });
    res.json(regime);
  } catch (e) {
    console.error("[/api/market-regime]", e.message);
    res.status(502).json({ state: "UNKNOWN", error: e.message });
  }
});

// Helper: attach current regime (non-blocking; if first call is slow we skip)
async function regimeOrNull() {
  try {
    // If already cached, this resolves instantly. Otherwise we wait (first call only).
    return await getMarketRegime();
  } catch { return null; }
}

// ── Latest signal per symbol (all watchlist), regime-adjusted
app.get("/api/signals", async (req, res) => {
  const rows = db.prepare(`
    SELECT s.*
    FROM signals s
    JOIN (
      SELECT symbol, MAX(ts) AS mx
      FROM signals
      WHERE timeframe = COALESCE(?, '1D')
      GROUP BY symbol
    ) latest ON s.symbol = latest.symbol AND s.ts = latest.mx
    ORDER BY s.score DESC
  `).all(req.query.timeframe || null);

  const regime = await regimeOrNull();
  // Fetch fundamentals for all symbols in parallel (cached 6h, so cheap on repeat)
  const fundsList = await Promise.all(rows.map(r => fetchFundamentals(r.symbol).catch(() => null)));
  const result = rows.map((r, i) => {
    const payload = JSON.parse(r.payload_json);
    const enriched = { ...payload, version: r.version, data_delay_min: r.data_delay_min, fundamentals: fundsList[i] };
    return applyRegimeToSignal(enriched, regime);
  });
  // Re-sort after regime adjustment so top card reflects adjusted score
  result.sort((a, b) => (b.score || 0) - (a.score || 0));
  res.json(result);
});

// ── Single signal + its checklist/warnings
app.get("/api/signals/:symbol", async (req, res) => {
  const sym = req.params.symbol.toUpperCase();
  const row = db.prepare(`
    SELECT * FROM signals WHERE symbol=? ORDER BY ts DESC LIMIT 1
  `).get(sym);
  if (!row) return res.status(404).json({ error: "not_found" });
  const regime = await regimeOrNull();
  const payload = { ...JSON.parse(row.payload_json), version: row.version, data_delay_min: row.data_delay_min };
  res.json(applyRegimeToSignal(payload, regime));
});

// ── Historical versions (for backtesting / debugging scoring)
app.get("/api/signals/:symbol/history", (req, res) => {
  const sym = req.params.symbol.toUpperCase();
  const limit = Math.min(+req.query.limit || 50, 500);
  const rows = db.prepare(`
    SELECT version, ts, grade, score, bullish_pct, sentiment, trend_score, osc_score, vol_score, volat_score
    FROM signals WHERE symbol=? ORDER BY ts DESC LIMIT ?
  `).all(sym, limit);
  res.json(rows);
});

// ── Momentum: live mention data from ApeWisdom (free public API, Reddit+Twitter aggregated)
// Cached 2 minutes to stay well under their rate limit.
let momentumCache = { ts: 0, data: [] };
app.get("/api/momentum", async (req, res) => {
  const watchlist = (process.env.WATCHLIST || "AAPL,NVDA,TSLA,AMD,SOFI,AMZN,GME,MSFT,META,GOOGL")
    .split(",").map(s => s.trim().toUpperCase());
  const ageMs = Date.now() - momentumCache.ts;
  if (ageMs < 120_000 && momentumCache.data.length) {
    return res.json({ source: "apewisdom", cachedAgeSec: Math.round(ageMs/1000), tickers: momentumCache.data });
  }
  try {
    // Parallel fetch: ApeWisdom (Reddit) + StockTwits (retail traders)
    const [ape, twits] = await Promise.all([
      fetchApeWisdomForWatchlist(watchlist).catch(e => { console.warn(`[momentum] apewisdom: ${e.message}`); return []; }),
      summarizeStockTwits(watchlist).catch(e => { console.warn(`[momentum] stocktwits: ${e.message}`); return {}; }),
    ]);
    // Join with latest signal grade/bullishPct per symbol
    const sigs = db.prepare(`
      SELECT s.symbol, s.grade, s.bullish_pct FROM signals s
      WHERE s.ts = (SELECT MAX(ts) FROM signals WHERE symbol = s.symbol)
    `).all();
    const sigMap = Object.fromEntries(sigs.map(r => [r.symbol, r]));
    // For tickers in watchlist but missing from ApeWisdom's top-200, show 0 mentions (honest)
    const data = watchlist.map(sym => {
      const a = ape.find(x => x.symbol.toUpperCase() === sym);
      const t = twits[sym] || {};
      const s = sigMap[sym];
      const redditMentions = a?.mentions || 0;
      const stMsgs = t.msgCount || 0;
      const chatter = redditMentions + stMsgs * 10;
      const velocityPct = a?.velocityPct || 0;
      const grade = s?.grade || null;

      // ── Social Edge composite ──────────────────────────────────────────
      // Goal: a score that rewards technical+social alignment, penalizes
      // retail hype on weak stocks, and surfaces quiet accumulation setups.
      const techScore = { A: 100, B: 80, C: 60, D: 30, F: 10 }[grade] ?? 40;

      // StockTwits bullish % (0–100). Null when no msgs — treat as 50 neutral.
      const stBull = (t.stBullishPct != null) ? t.stBullishPct : 50;
      const hasSocial = stMsgs >= 3 || redditMentions >= 5;

      // Alignment: social agrees with technicals?
      let alignment = 0;
      let alignmentReason = null;
      if (hasSocial) {
        if (stBull >= 60 && (grade === "A" || grade === "B")) {
          alignment = 20; alignmentReason = "social bullish + technicals strong";
        } else if (stBull >= 60 && (grade === "D" || grade === "F")) {
          alignment = -25; alignmentReason = "social bullish vs weak technicals (divergence)";
        } else if (stBull <= 40 && (grade === "A" || grade === "B")) {
          alignment = 8; alignmentReason = "quiet/skeptical crowd on strong setup (contrarian)";
        } else if (stBull <= 40 && (grade === "D" || grade === "F")) {
          alignment = -5; alignmentReason = "both sides bearish";
        }
      }

      // Hype penalty: parabolic chatter on non-top-grade → retail exhaustion pattern
      const hypePenalty = (velocityPct > 150 && (grade === "C" || grade === "D" || grade === "F")) ? 30 : 0;

      // Stealth bonus: grade A/B with almost no chatter = potential accumulation
      const stealthBonus = ((grade === "A" || grade === "B") && chatter < 15) ? 12 : 0;

      const socialEdge = Math.max(0, Math.min(100,
        Math.round(techScore * 0.6 + alignment + stealthBonus - hypePenalty)
      ));

      // ── Badge taxonomy (mutually exclusive, first match wins) ──────────
      let badge = "WATCH", badgeColour = "neutral", reason = "No clear edge — monitor";
      if (!grade) {
        badge = "NO DATA"; badgeColour = "neutral"; reason = "Signal not yet computed for this ticker";
      } else if ((grade === "C" || grade === "D" || grade === "F") && velocityPct > 150 && stBull >= 60) {
        badge = "TRAP RISK"; badgeColour = "red";
        reason = `Retail piling in (+${velocityPct}% chatter, ${stBull}% bullish) while technicals are ${grade}-grade — common exhaustion pattern`;
      } else if ((grade === "D" || grade === "F") && redditMentions > 50) {
        badge = "EXHAUSTION"; badgeColour = "red";
        reason = `Heavy crowd attention (${redditMentions} mentions) on a failing technical setup — late-stage move`;
      } else if ((grade === "A" || grade === "B") && stBull >= 55 && velocityPct > 0 && hasSocial) {
        badge = "CONVICTION"; badgeColour = "green";
        reason = `Technicals (${grade}) aligned with bullish crowd sentiment (${stBull}%) — highest-confluence setup`;
      } else if ((grade === "A" || grade === "B") && chatter < 15) {
        badge = "STEALTH"; badgeColour = "green";
        reason = `Strong technicals (${grade}) with minimal chatter — possible pre-crowd accumulation`;
      } else if (grade === "C" && velocityPct > 50) {
        badge = "MIXED"; badgeColour = "amber";
        reason = `Technicals middling (C) but chatter rising +${velocityPct}% — wait for technical confirmation`;
      } else if (velocityPct < 20 && chatter < 5) {
        badge = "QUIET"; badgeColour = "neutral";
        reason = "Little social activity — no edge from crowd data";
      } else if (grade === "A" || grade === "B") {
        badge = "WATCH"; badgeColour = "green";
        reason = `Strong technicals (${grade}), ambiguous crowd signal`;
      }

      return {
        symbol: sym,
        mentions: redditMentions,
        mentions24hAgo: a?.mentions24hAgo || 0,
        velocityPct,
        rank: a?.rank || null,
        stMsgs,
        stBullishPct: t.stBullishPct,
        chatterScore: chatter,
        sources: { reddit: redditMentions > 0, stocktwits: stMsgs > 0 },
        grade,
        bullishPct: s?.bullish_pct || 0,
        // ── new fields ──
        socialEdge,
        badge,
        badgeColour,
        reason,
        alignment,
        alignmentReason,
        hypePenalty,
        stealthBonus,
        sentimentDir: stBull >= 60 ? "bullish" : stBull <= 40 ? "bearish" : "mixed",
        hasSocial,
      };
    }).sort((a, b) => b.socialEdge - a.socialEdge);
    momentumCache = { ts: Date.now(), data };
    res.json({ source: "reddit+stocktwits", cachedAgeSec: 0, tickers: data });
  } catch (e) {
    console.error(`[/api/momentum] apewisdom failed: ${e.message}`);
    res.status(502).json({ error: "momentum_source_failed", detail: e.message });
  }
});

// ── On-demand scan for ANY symbol (search box / not-in-watchlist tickers).
// Fetches candles + quote live, computes indicators + signal, persists to DB, returns full signal payload.
// Cached 60s per symbol to avoid hammering Yahoo when a user types fast.
const scanCache = new Map(); // symbol -> { ts, payload }
const insIndicatorStmt = db.prepare(`
  INSERT INTO indicators(symbol,timeframe,ts,ema21,ema50,sma150,sma200,rsi,macd,macd_signal,macd_hist,adx,atr,bb_upper,bb_lower,kc_upper,kc_lower,squeeze_on,obv,cmf,vol_ratio)
  VALUES(@symbol,@timeframe,@ts,@ema21,@ema50,@sma150,@sma200,@rsi,@macd,@macd_signal,@macd_hist,@adx,@atr,@bb_upper,@bb_lower,@kc_upper,@kc_lower,@squeeze_on,@obv,@cmf,@vol_ratio)
`);
const insSignalStmt = db.prepare(`
  INSERT INTO signals(symbol,timeframe,version,ts,grade,score,bullish_pct,sentiment,trend_score,osc_score,vol_score,volat_score,entry,stop,target,risk_reward,position_size,no_setup,data_delay_min,payload_json)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
`);
const insChecklistStmt = db.prepare(`INSERT INTO signal_checklist_items(signal_id,ord,label,status) VALUES(?,?,?,?)`);
const insWarningStmt = db.prepare(`INSERT INTO early_warnings(signal_id,pattern,badge,description) VALUES(?,?,?,?)`);
const latestVersionStmt = db.prepare(`SELECT COALESCE(MAX(version),0) AS v FROM signals WHERE symbol=? AND timeframe=?`);

app.get("/api/scan/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase().trim();
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) {
    return res.status(400).json({ error: "invalid_symbol" });
  }
  const TIMEFRAME = "1D";
  const cached = scanCache.get(symbol);
  if (cached && Date.now() - cached.ts < 60_000) {
    return res.json({ ...cached.payload, cached: true, cachedAgeSec: Math.round((Date.now() - cached.ts) / 1000) });
  }
  try {
    // Search box uses TwelveData first (reserved budget). Watchlist worker uses Yahoo/Stooq.
    const [candles, quote] = await Promise.all([fetchCandles(symbol, TIMEFRAME, { caller: "search" }), fetchQuote(symbol)]);
    if (!candles || candles.length < 200) {
      return res.status(404).json({ error: "insufficient_data", symbol, candleCount: candles?.length || 0 });
    }
    upsertTicker(db, symbol, quote.name);
    const ind = computeAll(candles);
    if (!ind) return res.status(500).json({ error: "indicator_failure", symbol });

    insIndicatorStmt.run({
      symbol, timeframe: TIMEFRAME, ts: ind.ts,
      ema21: ind.ema21, ema50: ind.ema50, sma150: ind.sma150, sma200: ind.sma200,
      rsi: ind.rsi, macd: ind.macd, macd_signal: ind.macd_signal, macd_hist: ind.macd_hist,
      adx: ind.adx, atr: ind.atr,
      bb_upper: ind.bb_upper, bb_lower: ind.bb_lower,
      kc_upper: ind.kc_upper, kc_lower: ind.kc_lower,
      squeeze_on: ind.squeeze_on,
      obv: ind.obv, cmf: ind.cmf, vol_ratio: ind.vol_ratio,
    });

    const sig = computeSignal({ symbol, timeframe: TIMEFRAME, indicator: ind });
    const ver = latestVersionStmt.get(symbol, TIMEFRAME).v + 1;
    const delayMin = Math.round((quote.delayMs || 0) / 60000) || null;

    const info = insSignalStmt.run(
      symbol, TIMEFRAME, ver, sig.ts, sig.grade, sig.score, sig.bullishPct, sig.sentiment,
      sig.scores.trend, sig.scores.oscillator, sig.scores.volume, sig.scores.volatility,
      sig.entry ? parseFloat(sig.entry.value.replace(/[$,]/g, "")) : null,
      sig.stop ? parseFloat(sig.stop.value.replace(/[$,]/g, "")) : null,
      sig.target ? parseFloat(sig.target.value.replace(/[$,]/g, "")) : null,
      sig.riskReward !== "N/A" ? parseFloat(sig.riskReward) : null,
      sig.positionSize, sig.noSetup ? 1 : 0, delayMin,
      JSON.stringify(sig),
    );
    sig.checklist.forEach((it, i) => insChecklistStmt.run(info.lastInsertRowid, i, it.label, it.status));
    sig.earlyWarnings.forEach(w => insWarningStmt.run(info.lastInsertRowid, w.pattern, w.badge, w.description));

    // Attach fundamentals (analyst consensus, earnings date, logo) — non-blocking;
    // if Yahoo is down we still return the signal without them.
    let fundamentals = null;
    try { fundamentals = await fetchFundamentals(symbol); } catch {}
    const payload = { ...sig, version: ver, data_delay_min: delayMin, fundamentals };
    scanCache.set(symbol, { ts: Date.now(), payload });
    const regime = await regimeOrNull();
    res.json({ ...applyRegimeToSignal(payload, regime), cached: false });
  } catch (e) {
    console.error(`[/api/scan/${symbol}]`, e.message);
    // Fallback: serve the most recent signal from DB if we have one, with a "stale" flag
    const staleRow = db.prepare(`SELECT * FROM signals WHERE symbol=? AND timeframe=? ORDER BY ts DESC LIMIT 1`).get(symbol, TIMEFRAME);
    if (staleRow) {
      const ageMin = Math.round((Date.now() / 1000 - staleRow.ts) / 60);
      const payload = JSON.parse(staleRow.payload_json);
      const regime = await regimeOrNull();
      const adjusted = applyRegimeToSignal({
        ...payload,
        version: staleRow.version,
        data_delay_min: staleRow.data_delay_min,
      }, regime);
      return res.status(200).json({
        ...adjusted,
        stale: true,
        staleAgeMin: ageMin,
        staleReason: classifyUpstreamError(e.message),
      });
    }
    // No cache → return a clean, actionable error
    const reason = classifyUpstreamError(e.message);
    res.status(502).json({
      error: "scan_failed",
      symbol,
      userMessage: reason.userMessage,
      retryAfterSec: reason.retryAfterSec,
    });
  }
});

// Map raw provider errors to user-friendly guidance.
function classifyUpstreamError(msg) {
  const m = (msg || "").toLowerCase();
  const rateLimited = m.includes("429") || m.includes("rate") || m.includes("out of api credits") || m.includes("credits were used");
  const captcha = m.includes("captcha") || m.includes("get_apikey");
  if (rateLimited && captcha) return { userMessage: "All market-data providers are rate-limited right now. Yahoo clears in ~30–60 min; TwelveData resets at midnight UTC.", retryAfterSec: 1800 };
  if (rateLimited) return { userMessage: "Market-data providers are rate-limited. Try again in ~30 min.", retryAfterSec: 1800 };
  if (captcha) return { userMessage: "Stooq now requires an API key. Yahoo is the active fallback — retry shortly.", retryAfterSec: 120 };
  return { userMessage: `Couldn't fetch data for this symbol. Details: ${msg.slice(0, 180)}`, retryAfterSec: 60 };
}

// ── Position size calculator
app.post("/api/position-size", (req, res) => {
  const { portfolio, riskPct, entry, stop } = req.body || {};
  const r = calcPositionSize({ portfolio, riskPct, entry, stop });
  if (!r) return res.status(400).json({ error: "invalid_input" });
  res.json(r);
});

// ── Health
app.get("/health", (_req, res) => {
  // Read actual signals from DB — authoritative across processes.
  const rows = db.prepare(`
    SELECT symbol, ts, grade, score, bullish_pct, entry
    FROM signals s
    WHERE ts = (SELECT MAX(ts) FROM signals WHERE symbol = s.symbol)
    ORDER BY score DESC
  `).all();
  const now = Math.floor(Date.now() / 1000);
  const tickers = rows.map(r => ({
    symbol: r.symbol,
    grade: r.grade,
    score: r.score,
    entry: r.entry,
    ageSec: now - r.ts,
  }));
  res.json({
    ok: true,
    ts: Date.now(),
    demo: process.env.SIGNA_DEMO === "1",
    strict: process.env.SIGNA_STRICT !== "0",
    scanned: tickers.length,
    tickers,
    inProcessSourceLog: Object.entries(sourceStatus).map(([s, v]) => ({ symbol: s, ...v })),
  });
});

// ── Serve the dashboard UI (same origin → no CORS needed)
const UI_DIR = path.resolve(__dirname, "../../../");   // Signals_&_trends/
app.use(express.static(UI_DIR));
// Serve dashboard with PostHog project key injected from env (never commit the key).
app.get("/", (_req, res) => {
  try {
    const html = fs.readFileSync(path.join(UI_DIR, "Dashboard_preview.html"), "utf-8");
    const key = (process.env.POSTHOG_KEY || "").trim();
    const injected = key.startsWith("phc_")
      ? html.replace("</head>", `<meta name="posthog-key" content="${key}" />\n</head>`)
      : html;
    res.type("html").send(injected);
  } catch (e) {
    res.sendFile(path.join(UI_DIR, "Dashboard_preview.html"));
  }
});

const PORT = +process.env.PORT || 4000;
app.listen(PORT, () => console.log(`[api] listening on http://localhost:${PORT}`));
