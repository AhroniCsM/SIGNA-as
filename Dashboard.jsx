/**
 * SIGNA — Dashboard Layout
 *
 * Hosts:
 *  - Multiple SignalCards in a responsive grid
 *  - MomentumSidebar (right rail)
 *  - Global data-delay indicator
 *  - Portfolio settings bar
 */

import { useState, useMemo } from "react";
import SignalCard from "./SignalCard";
import MomentumSidebar from "./MomentumSidebar";

const C = {
  bg: "#0a0e17", card: "#0f1420", cardBorder: "#1a2236",
  green: "#00e676", amber: "#ffc107", red: "#ff4444",
  cyan: "#18ffff",
  textPrimary: "#e0e6f0", textSecondary: "#7b8ba3", textMuted: "#4a5568",
};

/* ═══════════════════════════════════════════════════════════════════════════
   DEMO DATA (same 3 signals + momentum tickers)
   ═══════════════════════════════════════════════════════════════════════════ */
const DEMO_SIGNALS = [
  {
    symbol: "JRNL", timeframe: "1D", version: "3",
    bullishPct: 53, grade: "A", sentiment: "BULLISH", positionSize: "full size",
    entry: { value: "$8.4400", sub: "market" },
    stop: { value: "$7.2000", sub: "14.7%" },
    target: { value: "$10.920", sub: "29.4%" },
    riskReward: "2.0:1", score: 85, adx: 36, volRatio: "0.5×", volColour: C.amber,
    dataDelay: null,
    checklist: [
      { label: "Full bull stack:\nprice>EMA21>EMA50>SMA200", status: "CONFIRMED" },
      { label: "Trend score strong: 78/100", status: "CONFIRMED" },
      { label: "MACD bullish +\nhistogram expanding", status: "CONFIRMED" },
      { label: "RSI 65 — bullish zone", status: "CONFIRMED" },
      { label: "ICS 0 — institutional distribution", status: "BEARISH" },
      { label: "OBV rising + CMF positive — volume confirms", status: "CONFIRMED" },
      { label: "Volume thin (0.5× avg) — low conviction", status: "ALERT" },
    ],
    earlyWarnings: [],
  },
  {
    symbol: "BTC", timeframe: "1D", version: "3",
    bullishPct: 59, grade: "C", sentiment: "NEUTRAL", positionSize: "starter",
    entry: null, stop: null, target: null, noSetup: true,
    riskReward: "0.2×", score: 59, adx: 16, volRatio: "0.2×", volColour: C.amber,
    dataDelay: 15,
    checklist: [
      { label: "Price above EMA50", status: "CONFIRMED" },
      { label: "Trend score weak: 27/100", status: "BEARISH" },
      { label: "MACD bullish +\nhistogram expanding", status: "CONFIRMED" },
      { label: "RSI 60 — bullish zone", status: "CONFIRMED" },
      { label: "Volume thin (0.2× avg) — low conviction", status: "ALERT" },
    ],
    earlyWarnings: [
      { pattern: "INSIDE BAR + LOW VOLUME", badge: "LEADING", description: "Price coiling inside prior bar range on drying volume — classic pre-breakout setup." },
    ],
  },
  {
    symbol: "BTC", timeframe: "4h", version: "3",
    bullishPct: 70, grade: "B", sentiment: "BULLISH", positionSize: "half size",
    entry: { value: "$72,433.63", sub: "market" },
    stop: { value: "$71,376.15", sub: "1.7%" },
    target: { value: "$75,146.78", sub: "3.5%" },
    riskReward: "2.0:1", score: 78, adx: 53, volRatio: "9.1×", volColour: C.green,
    dataDelay: null,
    checklist: [
      { label: "Full bull stack:\nprice>EMA21>EMA50>SMA200", status: "CONFIRMED" },
      { label: "Trend score strong: 69/100", status: "CONFIRMED" },
      { label: "MACD bearish +\nhistogram contracting", status: "LEADING" },
      { label: "RSI 63 — bullish zone", status: "CONFIRMED" },
      { label: "Volume thin (0.1× avg) — low conviction", status: "ALERT" },
    ],
    earlyWarnings: [
      { pattern: "VOLUME DRY-UP", badge: "LEADING", description: "Volume 73% below 10-bar avg with price holding steady. Institutional absorption pattern — often precedes directional move." },
    ],
  },
];

const MOMENTUM_TICKERS = [
  { symbol: "JRNL", grade: "A", mentionVelocity: 245, velocityLabel: "VIRAL", mentions: 3420, bullishPct: 85, volumeRatio: 0.5, avgSentiment: 0.72 },
  { symbol: "NVDA", grade: "B", mentionVelocity: 130, velocityLabel: "SURGING", mentions: 12500, bullishPct: 72, volumeRatio: 2.1, avgSentiment: 0.65 },
  { symbol: "BTC",  grade: "C", mentionVelocity: 78, velocityLabel: "RISING", mentions: 45000, bullishPct: 59, volumeRatio: 0.9, avgSentiment: 0.55 },
  { symbol: "TSLA", grade: "B", mentionVelocity: 210, velocityLabel: "VIRAL", mentions: 8900, bullishPct: 68, volumeRatio: 0.3, avgSentiment: 0.85 },
  { symbol: "AAPL", grade: "A", mentionVelocity: 45, velocityLabel: "STABLE", mentions: 6200, bullishPct: 81, volumeRatio: 1.8, avgSentiment: 0.60 },
  { symbol: "AMD",  grade: "C", mentionVelocity: 190, velocityLabel: "SURGING", mentions: 5100, bullishPct: 52, volumeRatio: 0.4, avgSentiment: 0.90 },
  { symbol: "GME",  grade: "D", mentionVelocity: 350, velocityLabel: "VIRAL", mentions: 22000, bullishPct: 35, volumeRatio: 0.2, avgSentiment: 0.95 },
  { symbol: "SOFI", grade: "B", mentionVelocity: 62, velocityLabel: "RISING", mentions: 2100, bullishPct: 66, volumeRatio: 1.4, avgSentiment: 0.58 },
];

/* ═══════════════════════════════════════════════════════════════════════════
   DASHBOARD
   ═══════════════════════════════════════════════════════════════════════════ */
export default function Dashboard() {
  const [activeTicker, setActiveTicker] = useState("JRNL");

  return (
    <div style={{
      minHeight: "100vh", background: C.bg, padding: 24,
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    }}>
      {/* ── Top bar ── */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: 24, paddingBottom: 16, borderBottom: `1px solid ${C.cardBorder}`,
      }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: 22, fontWeight: 800, color: C.green, letterSpacing: 2 }}>SIGNA</span>
          <span style={{ fontSize: 12, color: C.textMuted, fontWeight: 500 }}>Signal Dashboard v3</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 11, color: C.textSecondary }}>
          <span>{DEMO_SIGNALS.length} active signals</span>
          <span>·</span>
          <span>{MOMENTUM_TICKERS.length} tracked tickers</span>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            background: `${C.green}18`, padding: "3px 10px", borderRadius: 12,
            color: C.green, fontWeight: 600,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.green, animation: "livePulse 2s infinite" }} />
            LIVE
          </span>
        </div>
      </div>

      <style>{`
        @keyframes livePulse { 0%,100% { opacity:1; } 50% { opacity:0.3; } }
      `}</style>

      {/* ── Main layout ── */}
      <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
        {/* Signal cards grid */}
        <div style={{
          flex: 1, display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
          gap: 20, alignItems: "start",
        }}>
          {DEMO_SIGNALS.map((sig, i) => (
            <SignalCard key={`${sig.symbol}-${sig.timeframe}`} signal={sig} gaugeId={`g${i}`} />
          ))}
        </div>

        {/* Momentum sidebar */}
        <MomentumSidebar
          tickers={MOMENTUM_TICKERS}
          activeTicker={activeTicker}
          onTickerClick={setActiveTicker}
        />
      </div>
    </div>
  );
}
