// SQLite schema — mirrors the 7-table design from SCHEMA_AND_LOGIC.md
// Using SQLite for Phase 1 (zero-config, file-based). Migrate to Postgres+Timescale later.

import { DatabaseSync } from "node:sqlite";
import path from "path";

const DB_PATH = process.env.DB_PATH || "./signa.db";

export function openDb() {
  const db = new DatabaseSync(path.resolve(DB_PATH));
  try { db.exec("PRAGMA journal_mode = WAL"); } catch {}
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA foreign_keys = ON;");
  return db;
}

export function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tickers (
      symbol TEXT PRIMARY KEY,
      name TEXT,
      sector TEXT,
      asset_class TEXT DEFAULT 'stock',
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS price_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      ts INTEGER NOT NULL,
      open REAL, high REAL, low REAL, close REAL, volume REAL,
      FOREIGN KEY(symbol) REFERENCES tickers(symbol)
    );
    CREATE INDEX IF NOT EXISTS idx_price_sym_tf_ts ON price_snapshots(symbol,timeframe,ts);

    CREATE TABLE IF NOT EXISTS indicators (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      ts INTEGER NOT NULL,
      ema21 REAL, ema50 REAL, sma150 REAL, sma200 REAL,
      rsi REAL, macd REAL, macd_signal REAL, macd_hist REAL,
      adx REAL, atr REAL,
      bb_upper REAL, bb_lower REAL, kc_upper REAL, kc_lower REAL,
      squeeze_on INTEGER,
      obv REAL, cmf REAL, vol_ratio REAL
    );
    CREATE INDEX IF NOT EXISTS idx_ind_sym_tf_ts ON indicators(symbol,timeframe,ts);

    CREATE TABLE IF NOT EXISTS signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      version INTEGER NOT NULL,
      ts INTEGER NOT NULL,
      grade TEXT,
      score INTEGER,
      bullish_pct INTEGER,
      sentiment TEXT,
      trend_score INTEGER,
      osc_score INTEGER,
      vol_score INTEGER,
      volat_score INTEGER,
      entry REAL, stop REAL, target REAL,
      risk_reward REAL,
      position_size TEXT,
      no_setup INTEGER DEFAULT 0,
      data_delay_min INTEGER,
      payload_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sig_sym_ts ON signals(symbol,ts DESC);

    CREATE TABLE IF NOT EXISTS signal_checklist_items (
      signal_id INTEGER NOT NULL,
      ord INTEGER NOT NULL,
      label TEXT,
      status TEXT,
      FOREIGN KEY(signal_id) REFERENCES signals(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS early_warnings (
      signal_id INTEGER NOT NULL,
      pattern TEXT,
      badge TEXT,
      description TEXT,
      FOREIGN KEY(signal_id) REFERENCES signals(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS social_mentions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      source TEXT NOT NULL,
      ts INTEGER NOT NULL,
      sentiment REAL,
      raw_text TEXT,
      url TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_mentions_sym_ts ON social_mentions(symbol,ts DESC);

    CREATE TABLE IF NOT EXISTS social_aggregates (
      symbol TEXT NOT NULL,
      window_min INTEGER NOT NULL,
      ts INTEGER NOT NULL,
      mentions INTEGER,
      velocity_pct REAL,
      avg_sentiment REAL,
      PRIMARY KEY(symbol,window_min,ts)
    );

    CREATE TABLE IF NOT EXISTS watchlist (
      symbol TEXT PRIMARY KEY,
      added_at INTEGER DEFAULT (strftime('%s','now'))
    );
  `);
}

// ── Watchlist helpers (shared across API + workers) ─────────────────

export function getWatchlist(db) {
  return db.prepare("SELECT symbol FROM watchlist ORDER BY added_at").all().map(r => r.symbol);
}

export function addToWatchlist(db, symbol) {
  db.prepare("INSERT OR IGNORE INTO watchlist(symbol) VALUES(?)").run(symbol.toUpperCase().trim());
}

export function removeFromWatchlist(db, symbol) {
  db.prepare("DELETE FROM watchlist WHERE symbol=?").run(symbol.toUpperCase().trim());
}

// Seed from env var if the table is empty (first boot)
export function seedWatchlist(db) {
  const count = db.prepare("SELECT COUNT(*) AS n FROM watchlist").get().n;
  if (count > 0) return;   // already seeded
  const envList = (process.env.WATCHLIST || "AAPL,NVDA,TSLA,AMD,SOFI,AMZN,GME,MSFT,META,GOOGL")
    .split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
  const ins = db.prepare("INSERT OR IGNORE INTO watchlist(symbol) VALUES(?)");
  for (const sym of envList) ins.run(sym);
}

export function upsertTicker(db, symbol, name = null, sector = null) {
  db.prepare(`
    INSERT INTO tickers(symbol,name,sector) VALUES(?,?,?)
    ON CONFLICT(symbol) DO UPDATE SET name=COALESCE(excluded.name,name), sector=COALESCE(excluded.sector,sector)
  `).run(symbol, name, sector);
}
