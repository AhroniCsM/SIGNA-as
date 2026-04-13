// Offline test — generate synthetic OHLCV, run through indicators + signal engine.
// Proves the math & scoring work without needing network.

import { computeAll } from "./indicators.js";
import { computeSignal } from "./signalEngine.js";

// Generate 260 daily candles trending up with some noise (bullish case)
function genCandles(bias = 0.0008, vol = 0.015, n = 260) {
  const out = [];
  let price = 100;
  const startTs = Math.floor(Date.now() / 1000) - n * 86400;
  for (let i = 0; i < n; i++) {
    const drift = bias;
    const shock = (Math.random() - 0.5) * 2 * vol;
    const close = price * (1 + drift + shock);
    const high = Math.max(price, close) * (1 + Math.random() * vol * 0.5);
    const low = Math.min(price, close) * (1 - Math.random() * vol * 0.5);
    const volume = 1e6 * (0.7 + Math.random() * 0.6);
    out.push({ ts: startTs + i * 86400, open: price, high, low, close, volume });
    price = close;
  }
  // Make last bar a strong up-day with surging volume to trigger a bullish setup
  const last = out.at(-1);
  last.close = last.open * 1.025;
  last.high = last.close * 1.005;
  last.volume = 3e6;
  return out;
}

function run(label, bias) {
  console.log(`\n━━━ ${label} (bias ${bias}) ━━━`);
  const candles = genCandles(bias);
  const ind = computeAll(candles);
  if (!ind) { console.log("not enough candles"); return; }
  const sig = computeSignal({ symbol: "TEST", timeframe: "1D", indicator: ind });
  console.log(`Close: $${ind.close.toFixed(2)} | EMA21 $${ind.ema21.toFixed(2)} | SMA200 $${ind.sma200.toFixed(2)} | RSI ${ind.rsi.toFixed(0)} | ADX ${ind.adx?.toFixed(0) ?? "—"} | Vol× ${ind.vol_ratio.toFixed(2)}`);
  console.log(`→ Grade ${sig.grade} (${sig.score}/100) ${sig.sentiment}`);
  console.log(`  Trend ${sig.scores.trend} · Osc ${sig.scores.oscillator} · Vol ${sig.scores.volume} · Volat ${sig.scores.volatility}`);
  if (!sig.noSetup) console.log(`  Entry ${sig.entry.value} | Stop ${sig.stop.value} | Target ${sig.target.value} | R:R ${sig.riskReward}`);
  else console.log(`  No setup`);
  console.log(`  Checklist:`);
  sig.checklist.slice(0, 4).forEach(it => console.log(`    [${it.status}] ${it.label.split("\n")[0]}`));
}

run("Strong bull trend",  0.0012);
run("Choppy / neutral",   0.0000);
run("Downtrend",         -0.0010);
