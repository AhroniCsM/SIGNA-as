/**
 * SIGNA — Market Momentum Sidebar
 *
 * Ranks tickers by Mention Velocity vs Technical Grade.
 * Includes:
 *  - Bull Trap divergence detector (high hype + dropping volume)
 *  - Hype vs Institutional Interest classification
 *  - Sparkline velocity bars
 */

import { useState, useMemo } from "react";
import { TrendingUp, AlertTriangle, Flame, Building2, Users } from "lucide-react";

const C = {
  bg: "#0a0e17", card: "#0f1420", cardBorder: "#1a2236",
  green: "#00e676", greenDim: "#00e67633",
  amber: "#ffc107", amberDim: "#ffc10733",
  red: "#ff4444", redDim: "#ff444433",
  cyan: "#18ffff", cyanDim: "#18ffff22",
  purple: "#bb86fc", purpleDim: "#bb86fc33",
  textPrimary: "#e0e6f0", textSecondary: "#7b8ba3", textMuted: "#4a5568",
};

const gradeAccent = (g) => g === "A" ? C.green : g === "B" ? C.green : g === "C" ? C.amber : C.red;

const velocityMeta = {
  VIRAL:   { colour: C.red,   label: "VIRAL",   icon: Flame },
  SURGING: { colour: C.amber, label: "SURGING", icon: TrendingUp },
  RISING:  { colour: C.green, label: "RISING",  icon: TrendingUp },
  STABLE:  { colour: C.textMuted, label: "STABLE", icon: null },
  FADING:  { colour: C.red,   label: "FADING",  icon: null },
  NEW:     { colour: C.cyan,  label: "NEW",     icon: Flame },
  QUIET:   { colour: C.textMuted, label: "QUIET", icon: null },
};

/* ─── Sentiment Type Classifier ─── */
function classifySentiment(mentionVelocity, volumeRatio, avgSentiment) {
  // Bull Trap: High social hype but volume dropping
  if (mentionVelocity > 100 && volumeRatio < 0.5 && avgSentiment > 0.5) {
    return { type: "BULL_TRAP", colour: C.red, icon: AlertTriangle, label: "BULL TRAP" };
  }
  // Institutional: Moderate mentions, strong volume, neutral-positive sentiment
  if (volumeRatio >= 1.5 && mentionVelocity < 50) {
    return { type: "INSTITUTIONAL", colour: C.purple, icon: Building2, label: "INSTITUTIONAL" };
  }
  // Hype: High mentions, weak volume
  if (mentionVelocity > 100 && volumeRatio < 1.0) {
    return { type: "HYPE", colour: C.amber, icon: Users, label: "RETAIL HYPE" };
  }
  // Confirmed: Good mentions + good volume
  if (mentionVelocity > 50 && volumeRatio >= 1.0) {
    return { type: "CONFIRMED", colour: C.green, icon: TrendingUp, label: "CONFIRMED" };
  }
  return { type: "NEUTRAL", colour: C.textMuted, icon: null, label: "NEUTRAL" };
}

/* ─── Velocity Bar ─── */
function VelocityBar({ velocity, maxVelocity }) {
  const pct = Math.min(Math.abs(velocity) / Math.max(maxVelocity, 1) * 100, 100);
  const colour = velocity > 200 ? C.red : velocity > 100 ? C.amber : velocity > 0 ? C.green : C.textMuted;
  return (
    <div style={{ width: "100%", height: 4, background: "#1a2236", borderRadius: 2, overflow: "hidden" }}>
      <div style={{
        width: `${pct}%`, height: "100%", background: colour, borderRadius: 2,
        boxShadow: `0 0 6px ${colour}44`,
        transition: "width 0.5s ease",
      }} />
    </div>
  );
}

/* ─── Single Ticker Row ─── */
function TickerRow({ ticker, maxVelocity, onClick, isActive }) {
  const vMeta = velocityMeta[ticker.velocityLabel] || velocityMeta.STABLE;
  const sentClass = classifySentiment(ticker.mentionVelocity, ticker.volumeRatio, ticker.avgSentiment);
  const SentIcon = sentClass.icon;

  return (
    <div
      onClick={() => onClick?.(ticker.symbol)}
      style={{
        padding: "10px 12px", borderBottom: `1px solid ${C.cardBorder}`,
        cursor: "pointer", transition: "background 0.2s",
        background: isActive ? `${C.green}08` : "transparent",
        borderLeft: isActive ? `2px solid ${C.green}` : "2px solid transparent",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary }}>{ticker.symbol}</span>
          <span style={{
            fontSize: 9, fontWeight: 700, color: gradeAccent(ticker.grade),
            background: `${gradeAccent(ticker.grade)}22`, padding: "1px 6px", borderRadius: 3,
          }}>
            {ticker.grade}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {vMeta.icon && <vMeta.icon size={11} color={vMeta.colour} />}
          <span style={{ fontSize: 10, fontWeight: 700, color: vMeta.colour }}>
            {ticker.mentionVelocity > 0 ? "+" : ""}{ticker.mentionVelocity}%
          </span>
        </div>
      </div>

      <VelocityBar velocity={ticker.mentionVelocity} maxVelocity={maxVelocity} />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {SentIcon && <SentIcon size={10} color={sentClass.colour} />}
          <span style={{ fontSize: 9, fontWeight: 600, color: sentClass.colour, letterSpacing: 0.5 }}>
            {sentClass.label}
          </span>
        </div>
        <span style={{ fontSize: 10, color: C.textSecondary }}>
          {ticker.mentions.toLocaleString()} mentions · {ticker.bullishPct}%
        </span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN EXPORT — MomentumSidebar
   ═══════════════════════════════════════════════════════════════════════════ */
export default function MomentumSidebar({ tickers, activeTicker, onTickerClick }) {
  const [sortBy, setSortBy] = useState("velocity"); // "velocity" | "grade"

  const sorted = useMemo(() => {
    const gradeRank = { A: 4, B: 3, C: 2, D: 1 };
    const copy = [...tickers];
    if (sortBy === "velocity") {
      copy.sort((a, b) => b.mentionVelocity - a.mentionVelocity);
    } else {
      copy.sort((a, b) => (gradeRank[b.grade] || 0) - (gradeRank[a.grade] || 0) || b.bullishPct - a.bullishPct);
    }
    return copy;
  }, [tickers, sortBy]);

  const maxVelocity = Math.max(...tickers.map((t) => Math.abs(t.mentionVelocity)), 1);

  return (
    <div style={{
      width: 320, background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 16,
      overflow: "hidden", display: "flex", flexDirection: "column",
    }}>
      {/* Header */}
      <div style={{ padding: "14px 16px 10px", borderBottom: `1px solid ${C.cardBorder}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Flame size={14} color={C.amber} />
            <span style={{ fontSize: 12, fontWeight: 700, color: C.textPrimary, letterSpacing: 1, textTransform: "uppercase" }}>
              Market Momentum
            </span>
          </div>
          <span style={{ fontSize: 9, color: C.textMuted }}>{tickers.length} tickers</span>
        </div>

        {/* Sort toggle */}
        <div style={{ display: "flex", gap: 4 }}>
          {["velocity", "grade"].map((key) => (
            <button key={key} onClick={() => setSortBy(key)} style={{
              flex: 1, padding: "4px 0", fontSize: 10, fontWeight: 600,
              background: sortBy === key ? "#1a2236" : "transparent",
              border: `1px solid ${sortBy === key ? C.cyan : C.cardBorder}`,
              borderRadius: 6, color: sortBy === key ? C.cyan : C.textMuted,
              cursor: "pointer", textTransform: "uppercase", letterSpacing: 0.5,
            }}>
              {key === "velocity" ? "Mention Velocity" : "Technical Grade"}
            </button>
          ))}
        </div>
      </div>

      {/* Ticker List */}
      <div style={{ flex: 1, overflowY: "auto", maxHeight: 600 }}>
        {sorted.map((t) => (
          <TickerRow
            key={t.symbol}
            ticker={t}
            maxVelocity={maxVelocity}
            onClick={onTickerClick}
            isActive={activeTicker === t.symbol}
          />
        ))}
      </div>

      {/* Legend */}
      <div style={{ padding: "8px 16px", borderTop: `1px solid ${C.cardBorder}`, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {[
          { label: "Institutional", colour: C.purple },
          { label: "Confirmed", colour: C.green },
          { label: "Retail Hype", colour: C.amber },
          { label: "Bull Trap", colour: C.red },
        ].map((l) => (
          <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: l.colour }} />
            <span style={{ fontSize: 8, color: C.textMuted, letterSpacing: 0.3 }}>{l.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
