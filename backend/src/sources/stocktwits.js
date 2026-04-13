// StockTwits public stream — free, no key. ~200 req/hour per IP.
// Per-symbol endpoint returns last 30 messages with bullish/bearish tags.

export async function fetchStockTwitsSymbol(symbol) {
  const url = `https://api.stocktwits.com/api/2/streams/symbol/${symbol}.json`;
  const res = await fetch(url, { headers: { "User-Agent": "signa-bot/0.1" } });
  if (!res.ok) {
    if (res.status === 429) throw new Error("StockTwits rate-limited");
    throw new Error(`StockTwits ${symbol} ${res.status}`);
  }
  const json = await res.json();
  return (json?.messages || []).map(m => {
    const tag = m.entities?.sentiment?.basic;
    const sentiment = tag === "Bullish" ? 1 : tag === "Bearish" ? -1 : 0;
    return {
      symbol,
      source: "stocktwits",
      ts: Math.floor(new Date(m.created_at).getTime() / 1000),
      sentiment,
      raw_text: m.body?.slice(0, 200),
      url: `https://stocktwits.com/${m.user?.username}/message/${m.id}`,
    };
  });
}

// Summarize the last N messages per symbol into quick stats for /api/momentum.
export async function summarizeStockTwits(watchlist) {
  const out = {};
  for (const sym of watchlist) {
    try {
      const msgs = await fetchStockTwitsSymbol(sym);
      const bull = msgs.filter(m => m.sentiment > 0).length;
      const bear = msgs.filter(m => m.sentiment < 0).length;
      const total = msgs.length;
      // Twits don't give us a 24h window, just the last ~30; treat as a "heat" snapshot.
      out[sym] = {
        msgCount: total,
        bullishMsgs: bull,
        bearishMsgs: bear,
        stBullishPct: total > 0 ? Math.round((bull / (bull + bear || 1)) * 100) : null,
      };
      await new Promise(r => setTimeout(r, 1500));
    } catch (e) {
      out[sym] = { msgCount: 0, bullishMsgs: 0, bearishMsgs: 0, stBullishPct: null, error: e.message };
    }
  }
  return out;
}

export async function scanStockTwits(watchlist) {
  const out = [];
  for (const sym of watchlist) {
    try {
      const msgs = await fetchStockTwitsSymbol(sym);
      out.push(...msgs);
      await new Promise(r => setTimeout(r, 2500)); // keep well under rate limit
    } catch (e) {
      console.warn(`[stocktwits] ${sym}:`, e.message);
      if (e.message.includes("rate-limited")) break;
    }
  }
  return out;
}
