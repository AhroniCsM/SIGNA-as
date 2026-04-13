import YF from "yahoo-finance2";
const yf = new YF();
// historical and chart might be attached as own props after init
console.log("own after new:", Object.getOwnPropertyNames(yf));
// try calling a known method:
try {
  const q = await yf.quote("AAPL");
  console.log("quote ok:", q.symbol, q.regularMarketPrice);
} catch(e) { console.log("quote err:", e.message); }
