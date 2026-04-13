// Dump exactly what Stooq returns so we can see the failure reason.
// Usage: node debug-stooq.mjs
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36";
const urls = [
  "https://stooq.com/q/d/l/?s=aapl.us&i=d",
  "https://stooq.com/q/d/l/?s=aapl.us&d1=20240101&d2=20260413&i=d",
  "https://stooq.com/q/l/?s=aapl.us&f=sd2t2ohlcv&h&e=csv",
];
for (const url of urls) {
  console.log(`\n=== ${url}`);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "text/csv,text/plain,*/*" }});
    const body = await r.text();
    console.log(`HTTP ${r.status}  (${body.length} bytes)`);
    console.log(body.slice(0, 500));
  } catch (e) { console.log("ERROR:", e.message); }
}
