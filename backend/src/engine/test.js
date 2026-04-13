// Smoke-test: fetch AAPL, compute indicators, compute signal. No DB writes.

import { fetchCandles } from "../sources/yahoo.js";
import { computeAll } from "./indicators.js";
import { computeSignal } from "./signalEngine.js";

const symbol = process.argv[2] || "AAPL";
console.log(`→ fetching ${symbol} daily candles...`);
const candles = await fetchCandles(symbol, "1D");
console.log(`✓ ${candles.length} candles, latest: ${new Date(candles.at(-1).ts * 1000).toISOString()}`);

const ind = computeAll(candles);
console.log("\nIndicators (latest bar):");
console.log({
  close: ind.close?.toFixed(2),
  ema21: ind.ema21?.toFixed(2),
  ema50: ind.ema50?.toFixed(2),
  sma150: ind.sma150?.toFixed(2),
  sma200: ind.sma200?.toFixed(2),
  rsi: ind.rsi?.toFixed(1),
  macd_hist: ind.macd_hist?.toFixed(3),
  adx: ind.adx?.toFixed(1),
  atr: ind.atr?.toFixed(2),
  vol_ratio: ind.vol_ratio?.toFixed(2),
  squeeze_on: ind.squeeze_on,
  cmf: ind.cmf?.toFixed(3),
});

const sig = computeSignal({ symbol, timeframe: "1D", indicator: ind });
console.log(`\nSignal for ${symbol}:`);
console.log(`  Grade: ${sig.grade}  Score: ${sig.score}/100  Sentiment: ${sig.sentiment}`);
console.log(`  Scores → Trend ${sig.scores.trend} · Osc ${sig.scores.oscillator} · Vol ${sig.scores.volume} · Volat ${sig.scores.volatility}`);
if (!sig.noSetup) {
  console.log(`  Entry ${sig.entry.value}  Stop ${sig.stop.value}  Target ${sig.target.value}  R:R ${sig.riskReward}`);
} else {
  console.log(`  No setup — wait for clearer signal`);
}
console.log(`  Checklist:`);
sig.checklist.forEach(it => console.log(`    [${it.status}] ${it.label.replace(/\n/g, " ")}`));
if (sig.earlyWarnings.length) {
  console.log(`  Early warnings:`);
  sig.earlyWarnings.forEach(w => console.log(`    • ${w.pattern} [${w.badge}] — ${w.description}`));
}
