// Reddit JSON — free, no auth needed. Be polite with User-Agent + rate limit.
// We scan new posts in each sub, extract cashtags + $TICKER mentions, lightweight keyword sentiment.

const BULL_WORDS = ["moon", "rocket", "calls", "long", "buy", "pump", "breakout", "squeeze", "rip", "bullish", "🚀", "💎"];
const BEAR_WORDS = ["puts", "short", "dump", "crash", "bearish", "sell", "dead", "rug", "tank"];

function lightSentiment(text) {
  const t = text.toLowerCase();
  let score = 0;
  for (const w of BULL_WORDS) if (t.includes(w)) score += 1;
  for (const w of BEAR_WORDS) if (t.includes(w)) score -= 1;
  return Math.max(-1, Math.min(1, score / 5));
}

function extractTickers(text, watchlist) {
  const found = new Set();
  const cashtagRe = /\$([A-Z]{2,5})\b/g;
  let m; while ((m = cashtagRe.exec(text)) !== null) found.add(m[1]);
  // Also match watchlist bare symbols surrounded by whitespace/punctuation
  for (const sym of watchlist) {
    const re = new RegExp(`\\b${sym}\\b`);
    if (re.test(text)) found.add(sym);
  }
  return [...found];
}

export async function fetchSubreddit(sub, limit = 50) {
  const url = `https://www.reddit.com/r/${sub}/new.json?limit=${limit}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "signa-bot/0.1 (local dev)" },
  });
  if (!res.ok) throw new Error(`Reddit ${sub} ${res.status}`);
  const json = await res.json();
  return (json?.data?.children || []).map(c => c.data);
}

export async function scanReddit(subs, watchlist) {
  const mentions = [];
  for (const sub of subs) {
    try {
      const posts = await fetchSubreddit(sub, 50);
      for (const p of posts) {
        const text = `${p.title || ""} ${p.selftext || ""}`;
        const tickers = extractTickers(text, watchlist);
        if (!tickers.length) continue;
        const sentiment = lightSentiment(text);
        for (const sym of tickers) {
          mentions.push({
            symbol: sym,
            source: `reddit/${sub}`,
            ts: p.created_utc,
            sentiment,
            raw_text: (p.title || "").slice(0, 200),
            url: `https://reddit.com${p.permalink}`,
          });
        }
      }
      // be polite
      await new Promise(r => setTimeout(r, 1000));
    } catch (e) {
      console.warn(`[reddit] ${sub}:`, e.message);
    }
  }
  return mentions;
}
