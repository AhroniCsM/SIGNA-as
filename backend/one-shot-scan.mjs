import "dotenv/config";
import { openDb, initSchema, upsertTicker } from "./src/db/schema.js";
import { fetchCandles, fetchQuote } from "./src/sources/yahoo.js";
import { computeAll } from "./src/engine/indicators.js";
import { computeSignal } from "./src/engine/signalEngine.js";

const WATCH = (process.env.WATCHLIST||"AAPL,NVDA,TSLA").split(",").map(s=>s.trim());
const db = openDb(); initSchema(db);

const insInd = db.prepare(`INSERT INTO indicators(symbol,timeframe,ts,ema21,ema50,sma150,sma200,rsi,macd,macd_signal,macd_hist,adx,atr,bb_upper,bb_lower,kc_upper,kc_lower,squeeze_on,obv,cmf,vol_ratio) VALUES(@symbol,@timeframe,@ts,@ema21,@ema50,@sma150,@sma200,@rsi,@macd,@macd_signal,@macd_hist,@adx,@atr,@bb_upper,@bb_lower,@kc_upper,@kc_lower,@squeeze_on,@obv,@cmf,@vol_ratio)`);
const insSig = db.prepare(`INSERT INTO signals(symbol,timeframe,version,ts,grade,score,bullish_pct,sentiment,trend_score,osc_score,vol_score,volat_score,entry,stop,target,risk_reward,position_size,no_setup,data_delay_min,payload_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const insCk = db.prepare(`INSERT INTO signal_checklist_items(signal_id,ord,label,status) VALUES(?,?,?,?)`);
const insWn = db.prepare(`INSERT INTO early_warnings(signal_id,pattern,badge,description) VALUES(?,?,?,?)`);

for (const sym of WATCH) {
  try {
    const [candles, quote] = await Promise.all([fetchCandles(sym,"1D"), fetchQuote(sym)]);
    if (candles.length < 200) { console.log(`[skip] ${sym}: ${candles.length} candles`); continue; }
    upsertTicker(db, sym, quote.name);
    const ind = computeAll(candles); if (!ind) continue;
    insInd.run({symbol:sym,timeframe:"1D",ts:ind.ts,ema21:ind.ema21,ema50:ind.ema50,sma150:ind.sma150,sma200:ind.sma200,rsi:ind.rsi,macd:ind.macd,macd_signal:ind.macd_signal,macd_hist:ind.macd_hist,adx:ind.adx,atr:ind.atr,bb_upper:ind.bb_upper,bb_lower:ind.bb_lower,kc_upper:ind.kc_upper,kc_lower:ind.kc_lower,squeeze_on:ind.squeeze_on,obv:ind.obv,cmf:ind.cmf,vol_ratio:ind.vol_ratio});
    const sig = computeSignal({symbol:sym,timeframe:"1D",indicator:ind});
    const r = insSig.run(sym,"1D",1,sig.ts,sig.grade,sig.score,sig.bullishPct,sig.sentiment,sig.scores.trend,sig.scores.oscillator,sig.scores.volume,sig.scores.volatility,sig.entry?+sig.entry.value.replace(/[$,]/g,''):null,sig.stop?+sig.stop.value.replace(/[$,]/g,''):null,sig.target?+sig.target.value.replace(/[$,]/g,''):null,sig.riskReward!=="N/A"?parseFloat(sig.riskReward):null,sig.positionSize,sig.noSetup?1:0,0,JSON.stringify(sig));
    sig.checklist.forEach((it,i)=>insCk.run(r.lastInsertRowid,i,it.label,it.status));
    sig.earlyWarnings.forEach(w=>insWn.run(r.lastInsertRowid,w.pattern,w.badge,w.description));
    console.log(`[ok] ${sym} → Grade ${sig.grade} (${sig.score}/100)`);
  } catch(e) { console.warn(`[err] ${sym}: ${e.message}`); }
}
db.close();
console.log("\n✓ scan done");
