// Social worker — Reddit + StockTwits → mentions table → aggregated velocity.

import "dotenv/config";
import cron from "node-cron";
import { openDb, initSchema, getWatchlist, seedWatchlist } from "../db/schema.js";
import { scanReddit } from "../sources/reddit.js";
import { scanStockTwits } from "../sources/stocktwits.js";
const SUBS = (process.env.REDDIT_SUBS || "wallstreetbets,stocks").split(",").map(s => s.trim());

const db = openDb();
initSchema(db);
seedWatchlist(db);

const insMention = db.prepare(`
  INSERT INTO social_mentions(symbol,source,ts,sentiment,raw_text,url)
  VALUES(?,?,?,?,?,?)
`);

const upsertAgg = db.prepare(`
  INSERT OR REPLACE INTO social_aggregates(symbol,window_min,ts,mentions,velocity_pct,avg_sentiment)
  VALUES(?,?,?,?,?,?)
`);

const countWindow = db.prepare(`
  SELECT COUNT(*) AS n, AVG(sentiment) AS s
  FROM social_mentions
  WHERE symbol=? AND ts >= ? AND ts < ?
`);

function aggregate(symbol, windowMin = 60) {
  const now = Math.floor(Date.now() / 1000);
  const cur = countWindow.get(symbol, now - windowMin * 60, now);
  const prev = countWindow.get(symbol, now - windowMin * 120, now - windowMin * 60);
  const velocity = prev.n > 0 ? ((cur.n - prev.n) / prev.n) * 100 : (cur.n > 0 ? 100 : 0);
  upsertAgg.run(symbol, windowMin, now, cur.n, velocity, cur.s || 0);
  return { mentions: cur.n, velocity: Math.round(velocity), sentiment: cur.s || 0 };
}

async function scan() {
  const WATCHLIST = getWatchlist(db);
  console.log(`[social] scan @ ${new Date().toISOString()} — ${WATCHLIST.length} symbols`);
  const reddit = await scanReddit(SUBS, WATCHLIST);
  const stocktwits = await scanStockTwits(WATCHLIST);
  const all = [...reddit, ...stocktwits];
  console.log(`[social] collected ${reddit.length} reddit + ${stocktwits.length} stocktwits = ${all.length} mentions`);

  // node:sqlite DatabaseSync has no .transaction() helper — use explicit BEGIN/COMMIT.
  db.exec("BEGIN");
  try {
    for (const r of all) insMention.run(r.symbol, r.source, r.ts, r.sentiment, r.raw_text, r.url);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  for (const sym of WATCHLIST) {
    const a = aggregate(sym, 60);
    if (a.mentions > 0) console.log(`[social] ${sym}: ${a.mentions} mentions, velocity ${a.velocity}%, sent ${a.sentiment.toFixed(2)}`);
  }
}

await scan();
const intervalMin = +process.env.SOCIAL_SCAN_INTERVAL_MIN || 2;
cron.schedule(`*/${intervalMin} * * * *`, scan);
console.log(`[social] worker running — next scan every ${intervalMin}m`);
