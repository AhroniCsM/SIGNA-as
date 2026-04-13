// ApeWisdom — free public API aggregating Reddit/Twitter mentions.
// Endpoint: https://apewisdom.io/api/v1.0/filter/{filter}/page/{n}
// filter: all-stocks | wallstreetbets | stocks | cryptos | 4chan
// Returns: { results: [{ ticker, mentions, mentions_24h_ago, rank, rank_24h_ago, upvotes, name }, ...] }

const BASE = "https://apewisdom.io/api/v1.0/filter";

export async function fetchApeWisdom(filter = "all-stocks", pages = 2) {
  const all = [];
  for (let p = 1; p <= pages; p++) {
    const url = `${BASE}/${filter}/page/${p}`;
    const res = await fetch(url, { headers: { "User-Agent": "SIGNA/1.0" } });
    if (!res.ok) throw new Error(`ApeWisdom HTTP ${res.status}`);
    const json = await res.json();
    if (!Array.isArray(json.results)) throw new Error(`ApeWisdom bad response`);
    all.push(...json.results);
  }
  return all.map(r => ({
    symbol: r.ticker,
    name: r.name || r.ticker,
    mentions: +r.mentions || 0,
    mentions24hAgo: +r.mentions_24h_ago || 0,
    rank: +r.rank || 0,
    rank24hAgo: +r.rank_24h_ago || 0,
    upvotes: +r.upvotes || 0,
    // Velocity = % change in mentions vs 24h ago. >0 = growing chatter.
    velocityPct: (+r.mentions_24h_ago > 0)
      ? Math.round(((+r.mentions - +r.mentions_24h_ago) / +r.mentions_24h_ago) * 100)
      : 0,
  }));
}

// Filter to just the user's watchlist
export async function fetchApeWisdomForWatchlist(watchlist) {
  const all = await fetchApeWisdom("all-stocks", 4); // top 200 tickers
  const set = new Set(watchlist.map(s => s.toUpperCase()));
  return all.filter(r => set.has(r.symbol.toUpperCase()));
}
