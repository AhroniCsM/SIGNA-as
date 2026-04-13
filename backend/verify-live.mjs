// Verify-live: prove the Yahoo pipe is returning real market data.
// Run with:  node verify-live.mjs
// Success = realistic prices printed for every ticker.
process.env.SIGNA_DEMO = "0";
process.env.SIGNA_STRICT = "1";

const SYMS = (process.env.WATCHLIST || "AAPL,NVDA,TSLA,AMZN,MSFT,GOOGL,META,AMD,SOFI,GME").split(",");
const { fetchCandles } = await import("./src/sources/yahoo.js");

console.log(`\n▶ Verifying live Yahoo data for ${SYMS.length} tickers...\n`);
let live = 0, failed = 0;
for (const sym of SYMS) {
  try {
    const c = await fetchCandles(sym.trim(), "1D");
    const last = c[c.length - 1].close;
    console.log(`  ✓ ${sym.padEnd(6)} $${last.toFixed(2).padStart(8)}  (${c.length} bars)`);
    live++;
  } catch (e) {
    console.log(`  ✗ ${sym.padEnd(6)} FAILED: ${e.message}`);
    failed++;
  }
}
console.log(`\nResult: ${live} live / ${failed} failed`);
console.log(live === SYMS.length ? "✅ All tickers verified live.\n" : "⚠️  Some tickers failed — check network / rate limits.\n");
