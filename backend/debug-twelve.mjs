// Dump exactly what Twelve Data returns. Usage:
//   TWELVE_DATA_KEY=xxx node debug-twelve.mjs
const key = process.env.TWELVE_DATA_KEY || process.env.TWELVEDATA_KEY;
if (!key) { console.log("ERROR: TWELVE_DATA_KEY not set"); process.exit(1); }

for (const sym of ["AAPL", "NVDA"]) {
  console.log(`\n=== ${sym}`);
  const url = `https://api.twelvedata.com/time_series?symbol=${sym}&interval=1day&outputsize=500&apikey=${key}`;
  try {
    const r = await fetch(url);
    const j = await r.json();
    console.log("HTTP", r.status);
    console.log("status:", j.status, "code:", j.code, "message:", j.message);
    console.log("values count:", Array.isArray(j.values) ? j.values.length : "N/A");
    if (Array.isArray(j.values) && j.values[0]) {
      console.log("latest bar:", JSON.stringify(j.values[0]));
    }
  } catch (e) { console.log("ERROR:", e.message); }
}
