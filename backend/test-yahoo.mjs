process.env.SIGNA_DEMO = "0";
process.env.SIGNA_STRICT = "1";
const { fetchCandles, sourceStatus } = await import("./src/sources/yahoo.js");
try {
  const c = await fetchCandles("AAPL", "1D");
  console.log("SUCCESS:", c.length, "candles, last close=$"+c[c.length-1].close.toFixed(2));
} catch (e) {
  console.log("Failed (expected in sandbox):", e.message);
}
console.log("sourceStatus:", JSON.stringify(sourceStatus));
