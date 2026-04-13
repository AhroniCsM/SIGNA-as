// Stooq CSV data source — free, no auth.
// The raw URL `?s=aapl.us&i=d` sometimes returns "Exceeded..." or empty for unknown reasons.
// Safer: include explicit date range d1=YYYYMMDD&d2=YYYYMMDD. We also log what we actually
// received when parsing fails so we can see the failure reason instead of guessing.

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function fmtDate(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map(h => h.trim().toLowerCase());
  // Stooq headers: Date,Open,High,Low,Close,Volume
  if (!header.includes("date") || !header.includes("close")) return [];
  return lines.slice(1).map(line => {
    const cells = line.split(",");
    const row = {};
    header.forEach((h, i) => { row[h] = cells[i]; });
    return row;
  });
}

function stooqSymbol(sym) {
  if (sym.startsWith("^")) return sym.toLowerCase();
  return `${sym.toLowerCase()}.us`;
}

async function getCSV(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept": "text/csv,text/plain,*/*",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  const text = await res.text();
  return { status: res.status, text, ok: res.ok };
}

export async function fetchStooqDaily(symbol) {
  const s = stooqSymbol(symbol);
  const now = new Date();
  const from = new Date(now.getTime() - 365 * 2 * 86400 * 1000); // 2y history
  const key = process.env.STOOQ_API_KEY; // optional — needed since Stooq added captcha gate in 2025

  const suffix = key ? `&apikey=${key}` : "";
  const urls = [
    `https://stooq.com/q/d/l/?s=${s}&d1=${fmtDate(from)}&d2=${fmtDate(now)}&i=d${suffix}`,
    `https://stooq.com/q/d/l/?s=${s}&i=d${suffix}`,
  ];

  let lastDiag = "";
  for (const url of urls) {
    try {
      const { status, text } = await getCSV(url);
      if (status !== 200) { lastDiag = `HTTP ${status}`; continue; }
      if (!text || text.length < 20) { lastDiag = `empty body (${text.length}b)`; continue; }

      // Detect common "bad" responses
      if (/exceeded|limit/i.test(text.slice(0, 200))) { lastDiag = `rate limited: ${text.slice(0,80)}`; continue; }
      if (/<html/i.test(text.slice(0, 200))) { lastDiag = `got HTML not CSV`; continue; }
      if (text.startsWith("No data")) { lastDiag = `no data for ${symbol}`; continue; }

      const rows = parseCSV(text);
      const out = [];
      for (const r of rows) {
        const close = parseFloat(r.close);
        const volume = parseFloat(r.volume);
        if (!isFinite(close) || !isFinite(volume)) continue;
        out.push({
          ts: Math.floor(new Date(r.date + "T21:00:00Z").getTime() / 1000),
          open: parseFloat(r.open) || close,
          high: parseFloat(r.high) || close,
          low: parseFloat(r.low) || close,
          close, volume,
        });
      }
      if (out.length < 20) {
        lastDiag = `parsed ${out.length} bars; first 120 chars: ${text.slice(0,120).replace(/\n/g,' ')}`;
        continue;
      }
      return out;
    } catch (e) {
      lastDiag = `fetch threw: ${e.message}`;
    }
  }
  throw new Error(`Stooq: ${lastDiag}`);
}

export async function fetchStooqQuote(symbol) {
  const s = stooqSymbol(symbol);
  const url = `https://stooq.com/q/l/?s=${s}&f=sd2t2ohlcv&h&e=csv`;
  const { status, text } = await getCSV(url);
  if (status !== 200) throw new Error(`Stooq quote HTTP ${status}`);
  const rows = parseCSV(text);
  const r = rows[0];
  if (!r || !isFinite(parseFloat(r.close))) throw new Error(`Stooq quote: bad data: ${text.slice(0,100)}`);
  return {
    symbol, price: parseFloat(r.close),
    open: parseFloat(r.open), high: parseFloat(r.high), low: parseFloat(r.low),
    volume: parseFloat(r.volume), date: r.date, time: r.time,
  };
}
