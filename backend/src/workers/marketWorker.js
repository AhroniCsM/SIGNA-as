// Market worker — fetches candles for the watchlist, computes indicators + signal, writes to DB.
// Runs on an interval (cron). Single-process, no queue — fine for Phase 1.

import "dotenv/config";
import cron from "node-cron";
import { openDb, initSchema, upsertTicker, getWatchlist, seedWatchlist } from "../db/schema.js";
import { fetchCandles, fetchQuote, fetchSectorForSymbol } from "../sources/yahoo.js";
import { computeAll } from "../engine/indicators.js";
import { computeSignal } from "../engine/signalEngine.js";
const TIMEFRAME = "1D";

const db = openDb();
initSchema(db);
seedWatchlist(db);

// ── persistence ──────────────────────────────────────────────
const insIndicator = db.prepare(`
  INSERT INTO indicators(symbol,timeframe,ts,ema21,ema50,sma150,sma200,rsi,macd,macd_signal,macd_hist,adx,atr,bb_upper,bb_lower,kc_upper,kc_lower,squeeze_on,obv,cmf,vol_ratio)
  VALUES(@symbol,@timeframe,@ts,@ema21,@ema50,@sma150,@sma200,@rsi,@macd,@macd_signal,@macd_hist,@adx,@atr,@bb_upper,@bb_lower,@kc_upper,@kc_lower,@squeeze_on,@obv,@cmf,@vol_ratio)
`);

const insSignal = db.prepare(`
  INSERT INTO signals(symbol,timeframe,version,ts,grade,score,bullish_pct,sentiment,trend_score,osc_score,vol_score,volat_score,entry,stop,target,risk_reward,position_size,no_setup,data_delay_min,payload_json)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
`);
const insChecklist = db.prepare(`INSERT INTO signal_checklist_items(signal_id,ord,label,status) VALUES(?,?,?,?)`);
const insWarning = db.prepare(`INSERT INTO early_warnings(signal_id,pattern,badge,description) VALUES(?,?,?,?)`);
const latestVersion = db.prepare(`SELECT COALESCE(MAX(version),0) AS v FROM signals WHERE symbol=? AND timeframe=?`);

// ── scan one symbol ──────────────────────────────────────────
async function scanSymbol(symbol) {
  try {
    const [candles, quote] = await Promise.all([fetchCandles(symbol, TIMEFRAME), fetchQuote(symbol)]);
    if (candles.length < 200) {
      console.log(`[market] ${symbol}: only ${candles.length} candles, skipping`);
      return;
    }
    upsertTicker(db, symbol, quote.name);
    const ind = computeAll(candles);
    if (!ind) return;

    insIndicator.run({
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
    const ver = latestVersion.get(symbol, TIMEFRAME).v + 1;
    const delayMin = Math.round((quote.delayMs || 0) / 60000) || null;

    const info = insSignal.run(
      symbol, TIMEFRAME, ver, sig.ts, sig.grade, sig.score, sig.bullishPct, sig.sentiment,
      sig.scores.trend, sig.scores.oscillator, sig.scores.volume, sig.scores.volatility,
      sig.entry ? parseFloat(sig.entry.value.replace(/[$,]/g, "")) : null,
      sig.stop ? parseFloat(sig.stop.value.replace(/[$,]/g, "")) : null,
      sig.target ? parseFloat(sig.target.value.replace(/[$,]/g, "")) : null,
      sig.riskReward !== "N/A" ? parseFloat(sig.riskReward) : null,
      sig.positionSize, sig.noSetup ? 1 : 0, delayMin,
      JSON.stringify(sig),
    );

    sig.checklist.forEach((it, i) => insChecklist.run(info.lastInsertRowid, i, it.label, it.status));
    sig.earlyWarnings.forEach(w => insWarning.run(info.lastInsertRowid, w.pattern, w.badge, w.description));

    console.log(`[market] ${symbol} → Grade ${sig.grade} (${sig.score}/100) v${ver}${delayMin ? ` ⏱${delayMin}m delayed` : ""}`);
  } catch (e) {
    console.error(`[market] ${symbol}:`, e.message);
  }
}

async function scanAll() {
  // Read watchlist from DB each cycle — picks up UI additions without restart
  const WATCHLIST = getWatchlist(db);
  console.log(`[market] scan @ ${new Date().toISOString()} — ${WATCHLIST.length} symbols`);
  for (const sym of WATCHLIST) {
    await scanSymbol(sym);
    await new Promise(r => setTimeout(r, 800)); // be polite to Yahoo
  }
  console.log(`[market] scan complete`);
}

// Run immediately, then on interval
await scanAll();
const intervalMin = +process.env.MARKET_SCAN_INTERVAL_MIN || 5;
cron.schedule(`*/${intervalMin} * * * *`, scanAll);
console.log(`[market] worker running — next scan every ${intervalMin}m`);
