// Offline: seed DB with one synthetic signal, then verify API returns it.
import "dotenv/config";
import { openDb, initSchema, upsertTicker } from "./src/db/schema.js";
import { computeAll } from "./src/engine/indicators.js";
import { computeSignal } from "./src/engine/signalEngine.js";

// Copy of synthetic generator
function genCandles(bias=0.0012,n=260){
  const out=[];let p=100;const t=Math.floor(Date.now()/1000)-n*86400;
  for(let i=0;i<n;i++){const c=p*(1+bias+(Math.random()-.5)*.03);
    out.push({ts:t+i*86400,open:p,high:Math.max(p,c)*1.01,low:Math.min(p,c)*.99,close:c,volume:1e6*(0.7+Math.random()*0.6)});p=c;}
  const l=out.at(-1);l.close=l.open*1.025;l.volume=3e6;
  return out;
}

const db = openDb();
initSchema(db);

// Insert a synthetic AAPL signal
upsertTicker(db, "AAPL", "Apple Inc.", "Technology");
const candles = genCandles();
const ind = computeAll(candles);
const sig = computeSignal({ symbol: "AAPL", timeframe: "1D", indicator: ind });

const insSignal = db.prepare(`
  INSERT INTO signals(symbol,timeframe,version,ts,grade,score,bullish_pct,sentiment,trend_score,osc_score,vol_score,volat_score,entry,stop,target,risk_reward,position_size,no_setup,data_delay_min,payload_json)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
`);
insSignal.run(
  "AAPL","1D",1,sig.ts,sig.grade,sig.score,sig.bullishPct,sig.sentiment,
  sig.scores.trend,sig.scores.oscillator,sig.scores.volume,sig.scores.volatility,
  null,null,null,null,sig.positionSize,sig.noSetup?1:0,0,
  JSON.stringify(sig)
);

console.log(`✓ Inserted synthetic AAPL → Grade ${sig.grade} (${sig.score}/100)`);
console.log(`✓ DB file: ${process.env.DB_PATH || "./signa.db"}`);

const count = db.prepare("SELECT COUNT(*) c FROM signals").get();
console.log(`✓ signals row count: ${count.c}`);
db.close();
