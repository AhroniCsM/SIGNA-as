/**
 * SIGNA Signal Card v2 — Enhanced
 *
 * Features added in v2:
 *  - Dynamic grade-based colour theming (entire card shifts)
 *  - Position sizer (portfolio balance × risk %)
 *  - Copy-to-clipboard on trade params
 *  - Glowing "LEADING" and "CONFIRMED" badges
 *  - Framer Motion animated gauge (wrap with <motion.path>)
 *  - Data-delay warning banner
 *  - Low R:R quality flag (< 2.0:1)
 *
 * Expects: React 18+, lucide-react, framer-motion (optional graceful fallback)
 */

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  CheckCircle, XCircle, AlertTriangle, TrendingUp, Zap,
  Target, ShieldAlert, Copy, Check, Clock, Wallet,
} from "lucide-react";

/* ─── Palette ─── */
const C = {
  bg: "#0a0e17", card: "#0f1420", cardBorder: "#1a2236",
  green: "#00e676", greenDim: "#00e67633",
  amber: "#ffc107", amberDim: "#ffc10733",
  red: "#ff4444", redDim: "#ff444433",
  cyan: "#18ffff", cyanDim: "#18ffff22",
  textPrimary: "#e0e6f0", textSecondary: "#7b8ba3", textMuted: "#4a5568",
};

const gradeAccent = (grade) =>
  grade === "A" ? C.green : grade === "B" ? C.green : grade === "C" ? C.amber : C.red;

const sentimentColour = (s) =>
  s === "BULLISH" ? C.green : s === "NEUTRAL" ? C.amber : C.red;

const statusMeta = {
  CONFIRMED: { colour: C.green, bg: C.greenDim, glow: true, icon: CheckCircle },
  LEADING:   { colour: C.cyan,  bg: C.cyanDim,  glow: true, icon: TrendingUp },
  ALERT:     { colour: C.amber, bg: C.amberDim,  glow: false, icon: AlertTriangle },
  BEARISH:   { colour: C.red,   bg: C.redDim,    glow: false, icon: XCircle },
};

/* ─── Animated number counter hook ─── */
function useAnimatedValue(target, duration = 800) {
  const [value, setValue] = useState(0);
  const rafRef = useRef(null);
  useEffect(() => {
    const start = value;
    const startTime = performance.now();
    const animate = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
      setValue(Math.round(start + (target - start) * eased));
      if (progress < 1) rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target]);
  return value;
}

/* ─── Copy hook ─── */
function useCopyToClipboard() {
  const [copied, setCopied] = useState(false);
  const copy = useCallback((text) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, []);
  return { copied, copy };
}

/* ═══════════════════════════════════════════════════════════════════════════
   DATA DELAY BANNER
   ═══════════════════════════════════════════════════════════════════════════ */
export function DataDelayBanner({ delayMinutes }) {
  if (!delayMinutes) return null;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 6,
      background: "#ff444418", border: "1px solid #ff444433",
      borderRadius: 8, padding: "6px 12px", marginBottom: 10,
    }}>
      <Clock size={13} color={C.red} />
      <span style={{ fontSize: 11, color: C.red, fontWeight: 600 }}>
        Delayed Signal — data is {delayMinutes}m behind real-time
      </span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   ANIMATED GAUGE
   ═══════════════════════════════════════════════════════════════════════════ */
function BullishGauge({ pct, sentiment, id = "main" }) {
  const animatedPct = useAnimatedValue(pct);
  const accent = sentimentColour(sentiment);
  const radius = 80, circumference = Math.PI * radius;
  const progress = (animatedPct / 100) * circumference;
  const angle = Math.PI + (animatedPct / 100) * Math.PI;
  const nx = 100 + radius * Math.cos(angle);
  const ny = 110 + radius * Math.sin(angle);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 4 }}>
      <svg width="200" height="120" viewBox="0 0 200 120">
        <defs>
          <linearGradient id={`gg-${id}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={C.red} />
            <stop offset="50%" stopColor={C.amber} />
            <stop offset="100%" stopColor={C.green} />
          </linearGradient>
          <filter id={`glow-${id}`}>
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <path d="M 20 110 A 80 80 0 0 1 180 110" fill="none" stroke="#1a2236" strokeWidth="10" strokeLinecap="round" />
        <path d="M 20 110 A 80 80 0 0 1 180 110" fill="none" stroke={`url(#gg-${id})`}
          strokeWidth="10" strokeLinecap="round"
          strokeDasharray={`${progress} ${circumference}`}
          filter={`url(#glow-${id})`}
          style={{ transition: "stroke-dasharray 0.06s linear" }} />
        <circle cx={nx} cy={ny} r="5" fill={accent} filter={`url(#glow-${id})`}
          style={{ transition: "cx 0.06s, cy 0.06s" }} />
      </svg>
      <div style={{ marginTop: -36, textAlign: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: accent, letterSpacing: 2, textTransform: "uppercase" }}>
          {sentiment}
        </div>
        <div style={{ fontSize: 36, fontWeight: 800, color: C.textPrimary, lineHeight: 1 }}>
          {animatedPct}%
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   GRADE BADGE — dynamic colour
   ═══════════════════════════════════════════════════════════════════════════ */
function GradeBadge({ grade }) {
  const accent = gradeAccent(grade);
  return (
    <div style={{
      width: 52, height: 52, borderRadius: "50%", border: `3px solid ${accent}`,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      boxShadow: `0 0 20px ${accent}55, 0 0 40px ${accent}22`, margin: "0 auto",
      transition: "border-color 0.4s, box-shadow 0.4s",
    }}>
      <span style={{ fontSize: 24, fontWeight: 800, color: accent, lineHeight: 1 }}>{grade}</span>
      <span style={{ fontSize: 7, fontWeight: 600, color: C.textSecondary, letterSpacing: 1, textTransform: "uppercase" }}>Grade</span>
    </div>
  );
}

/* ─── Size legend ─── */
function SizeLegend({ activeSize }) {
  const sizes = [{ key: "full size", l: "A/B" }, { key: "half size", l: "C" }, { key: "starter", l: "D" }];
  return (
    <div style={{ display: "flex", justifyContent: "center", gap: 8, fontSize: 11, color: C.textMuted, margin: "6px 0 10px" }}>
      {sizes.map((s) => (
        <span key={s.key} style={{ color: activeSize === s.key ? C.textPrimary : C.textMuted, fontWeight: activeSize === s.key ? 600 : 400 }}>
          {s.l}: {s.key}
        </span>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TRADE PARAM BOX — with copy-to-clipboard
   ═══════════════════════════════════════════════════════════════════════════ */
function TradeParam({ label, value, sub, colour, icon: Icon, rawValue }) {
  const { copied, copy } = useCopyToClipboard();
  return (
    <div
      onClick={() => rawValue && copy(`${label}: ${rawValue}`)}
      style={{
        flex: 1, background: `${colour}11`, border: `1px solid ${colour}33`, borderRadius: 8,
        padding: "10px 10px 8px", textAlign: "center", cursor: rawValue ? "pointer" : "default",
        position: "relative", transition: "border-color 0.2s",
      }}
      title={rawValue ? "Click to copy" : undefined}
    >
      <div style={{ fontSize: 10, color: C.textSecondary, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
        {Icon && <Icon size={12} color={colour} />} {label}
        {rawValue && (
          copied
            ? <Check size={10} color={C.green} style={{ marginLeft: 2 }} />
            : <Copy size={10} color={C.textMuted} style={{ marginLeft: 2 }} />
        )}
      </div>
      <div style={{ fontSize: 17, fontWeight: 700, color: colour }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: C.textSecondary, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   POSITION SIZER
   ═══════════════════════════════════════════════════════════════════════════ */
function PositionSizer({ entry, stopLoss, grade }) {
  const [balance, setBalance] = useState(25000);
  const [riskPct, setRiskPct] = useState(1.0);

  const result = useMemo(() => {
    if (!entry || !stopLoss || stopLoss >= entry) return null;
    const dollarRisk = balance * (riskPct / 100);
    const riskPerShare = entry - stopLoss;
    const qty = Math.floor(dollarRisk / riskPerShare);
    return { qty, dollarRisk: dollarRisk.toFixed(2), positionValue: (qty * entry).toFixed(2) };
  }, [balance, riskPct, entry, stopLoss]);

  if (!result) return null;

  return (
    <div style={{
      background: "#111827", border: `1px solid ${C.cardBorder}`, borderRadius: 10,
      padding: 12, marginTop: 8,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <Wallet size={13} color={C.cyan} />
        <span style={{ fontSize: 11, fontWeight: 700, color: C.textSecondary, letterSpacing: 1, textTransform: "uppercase" }}>Position Sizer</span>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <label style={{ flex: 1 }}>
          <span style={{ fontSize: 9, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5 }}>Portfolio $</span>
          <input type="number" value={balance} onChange={(e) => setBalance(+e.target.value)}
            style={{
              width: "100%", background: "#0a0e17", border: `1px solid ${C.cardBorder}`, borderRadius: 6,
              color: C.textPrimary, padding: "4px 8px", fontSize: 13, fontWeight: 600, marginTop: 2,
              outline: "none",
            }} />
        </label>
        <label style={{ flex: 1 }}>
          <span style={{ fontSize: 9, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5 }}>Risk %</span>
          <input type="number" value={riskPct} step="0.25" onChange={(e) => setRiskPct(+e.target.value)}
            style={{
              width: "100%", background: "#0a0e17", border: `1px solid ${C.cardBorder}`, borderRadius: 6,
              color: C.textPrimary, padding: "4px 8px", fontSize: 13, fontWeight: 600, marginTop: 2,
              outline: "none",
            }} />
        </label>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1, textAlign: "center" }}>
          <div style={{ fontSize: 9, color: C.textMuted, textTransform: "uppercase" }}>Shares</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.cyan }}>{result.qty.toLocaleString()}</div>
        </div>
        <div style={{ flex: 1, textAlign: "center" }}>
          <div style={{ fontSize: 9, color: C.textMuted, textTransform: "uppercase" }}>$ at Risk</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.amber }}>${result.dollarRisk}</div>
        </div>
        <div style={{ flex: 1, textAlign: "center" }}>
          <div style={{ fontSize: 9, color: C.textMuted, textTransform: "uppercase" }}>Position</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>${Number(result.positionValue).toLocaleString()}</div>
        </div>
      </div>
    </div>
  );
}

/* ─── Metric Pill ─── */
function MetricPill({ label, value, accent }) {
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 6, background: "#111827",
      border: `1px solid ${accent || C.cardBorder}`, borderRadius: 6,
      padding: "4px 10px", fontSize: 11,
    }}>
      <span style={{ color: C.textSecondary, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</span>
      <span style={{ color: accent || C.textPrimary, fontWeight: 700 }}>{value}</span>
    </div>
  );
}

/* ─── Low R:R Warning ─── */
function LowRRWarning({ rr }) {
  const numericRR = parseFloat(rr);
  if (isNaN(numericRR) || numericRR >= 2.0) return null;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 6,
      background: C.amberDim, border: `1px solid ${C.amber}33`, borderRadius: 6,
      padding: "4px 10px", marginTop: 6,
    }}>
      <AlertTriangle size={12} color={C.amber} />
      <span style={{ fontSize: 10, color: C.amber, fontWeight: 600 }}>
        Low Quality Trade — R:R {rr} is below 2.0:1 minimum
      </span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   CHECKLIST ITEM — with glow effect
   ═══════════════════════════════════════════════════════════════════════════ */
function ChecklistItem({ label, status }) {
  const meta = statusMeta[status] || statusMeta.ALERT;
  const Icon = meta.icon;
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 10,
      padding: "8px 0", borderBottom: `1px solid ${C.cardBorder}`,
    }}>
      <Icon size={16} color={meta.colour} style={{ marginTop: 2, flexShrink: 0 }} />
      <span style={{ flex: 1, fontSize: 13, color: C.textPrimary, lineHeight: 1.4, whiteSpace: "pre-line" }}>{label}</span>
      <span style={{
        fontSize: 10, fontWeight: 700, color: meta.colour, background: meta.bg,
        padding: "2px 8px", borderRadius: 4, letterSpacing: 0.5, whiteSpace: "nowrap",
        boxShadow: meta.glow ? `0 0 8px ${meta.colour}44, 0 0 16px ${meta.colour}22` : "none",
        animation: meta.glow ? "badgePulse 2s ease-in-out infinite" : "none",
      }}>
        {status}
      </span>
    </div>
  );
}

/* ─── Early Warning ─── */
function EarlyWarning({ pattern, badge, description }) {
  const m = statusMeta[badge] || statusMeta.ALERT;
  return (
    <div style={{ border: `1px solid ${m.colour}33`, borderRadius: 10, padding: 14, background: `${m.colour}08`, marginTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Zap size={14} color={m.colour} />
        <span style={{ fontSize: 12, fontWeight: 700, color: m.colour, letterSpacing: 0.5 }}>{pattern}</span>
        <span style={{
          marginLeft: "auto", fontSize: 9, fontWeight: 700, color: m.colour, background: m.bg,
          padding: "2px 8px", borderRadius: 4, letterSpacing: 0.5,
          boxShadow: m.glow ? `0 0 8px ${m.colour}44` : "none",
        }}>{badge}</span>
      </div>
      <p style={{ fontSize: 12, color: C.textSecondary, lineHeight: 1.5, margin: 0 }}>{description}</p>
    </div>
  );
}

/* ─── Section Header ─── */
function SectionHeader({ children, trailing }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "18px 0 8px", paddingBottom: 6, borderBottom: `1px solid ${C.cardBorder}` }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: C.textSecondary, letterSpacing: 1.5, textTransform: "uppercase" }}>{children}</span>
      {trailing && <span style={{ fontSize: 10, color: C.textMuted, fontStyle: "italic" }}>{trailing}</span>}
    </div>
  );
}

/* ─── Header Bar ─── */
function HeaderBar({ symbol, timeframe, version, dataDelay }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0 6px", borderBottom: `1px solid ${C.cardBorder}`, marginBottom: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: C.green, letterSpacing: 1 }}>SIGNA</span>
        <span style={{ fontSize: 10, color: C.textMuted }}>SIGNAL</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11, color: C.textSecondary }}>
        <span style={{ fontWeight: 600 }}>{symbol}</span><span>·</span>
        <span>{timeframe}</span><span>·</span>
        <span style={{ color: C.textMuted }}>v{version}</span>
        {dataDelay && <Clock size={11} color={C.red} title={`${dataDelay}m delay`} />}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN EXPORT — SignalCard
   ═══════════════════════════════════════════════════════════════════════════ */
export default function SignalCard({ signal, gaugeId = "main" }) {
  const sig = signal;
  const gc = gradeAccent(sig.grade);

  // Parse numeric entry/stop for position sizer
  const parsePrice = (v) => v ? parseFloat(v.replace(/[$,]/g, "")) : null;
  const entryNum = parsePrice(sig.entry?.value);
  const stopNum = parsePrice(sig.stop?.value);

  return (
    <div style={{
      maxWidth: 380, background: C.card,
      border: `1px solid ${gc}22`, borderRadius: 16,
      padding: "0 20px 24px",
      boxShadow: `0 4px 24px rgba(0,0,0,0.4), 0 0 40px ${gc}08`,
      transition: "border-color 0.4s, box-shadow 0.4s",
    }}>
      <style>{`
        @keyframes badgePulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
      `}</style>

      <HeaderBar symbol={sig.symbol} timeframe={sig.timeframe} version={sig.version} dataDelay={sig.dataDelay} />
      <DataDelayBanner delayMinutes={sig.dataDelay} />
      <BullishGauge pct={sig.bullishPct} sentiment={sig.sentiment} id={gaugeId} />
      <GradeBadge grade={sig.grade} />
      <SizeLegend activeSize={sig.positionSize} />

      {sig.noSetup && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: C.amberDim, border: `1px solid ${C.amber}33`, borderRadius: 8, padding: "8px 12px", marginBottom: 12 }}>
          <AlertTriangle size={14} color={C.amber} />
          <span style={{ fontSize: 12, color: C.amber, fontWeight: 600 }}>No setup — wait for clearer signal</span>
        </div>
      )}

      {sig.entry && (
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <TradeParam label="Entry" value={sig.entry.value} sub={sig.entry.sub} colour={C.green} icon={Target} rawValue={sig.entry.value} />
          <TradeParam label="Stop" value={sig.stop.value} sub={sig.stop.sub} colour={C.red} icon={ShieldAlert} rawValue={sig.stop.value} />
        </div>
      )}
      {sig.target && (
        <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
          <TradeParam label="Target" value={sig.target.value} sub={sig.target.sub} colour={C.amber} icon={TrendingUp} rawValue={sig.target.value} />
        </div>
      )}

      {/* Position Sizer */}
      {entryNum && stopNum && <PositionSizer entry={entryNum} stopLoss={stopNum} grade={sig.grade} />}

      {/* Key Metrics */}
      <SectionHeader>Key Metrics</SectionHeader>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 4 }}>
        <MetricPill label="R:R" value={sig.riskReward} />
        <MetricPill label="Grade" value={sig.grade} accent={gc} />
        <MetricPill label="Score" value={`${sig.score}/100`} accent={sig.score >= 70 ? C.green : sig.score >= 50 ? C.amber : C.red} />
        <MetricPill label="ADX" value={sig.adx} />
        <MetricPill label="VOL" value={sig.volRatio} accent={sig.volColour} />
      </div>
      <LowRRWarning rr={sig.riskReward} />

      {/* Signal Checklist */}
      <SectionHeader>Signal Checklist</SectionHeader>
      {sig.checklist.map((item, i) => <ChecklistItem key={i} label={item.label} status={item.status} />)}

      {/* Early Warnings */}
      {sig.earlyWarnings?.length > 0 && (
        <>
          <SectionHeader trailing="leading indicators">Early Warnings</SectionHeader>
          {sig.earlyWarnings.map((w, i) => <EarlyWarning key={i} pattern={w.pattern} badge={w.badge} description={w.description} />)}
        </>
      )}

      {/* Footer */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 18, paddingTop: 10, borderTop: `1px solid ${C.cardBorder}`, fontSize: 10, color: C.textMuted }}>
        <span style={{ fontWeight: 700, color: C.green, letterSpacing: 1 }}>SIGNA</span>
        <span>{sig.symbol} · {sig.timeframe}</span>
      </div>
    </div>
  );
}
