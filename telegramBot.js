/**
 * SIGNA — Telegram Notification Bot
 *
 * Standalone Node.js script. Watches for high-conviction signals and pushes
 * them to your Telegram chat in real-time.
 *
 * Setup:
 *   1. Talk to @BotFather on Telegram → /newbot → copy the token
 *   2. Get your chat ID: send a message to the bot, then GET
 *      https://api.telegram.org/bot<TOKEN>/getUpdates
 *   3. Set environment variables:
 *        TELEGRAM_BOT_TOKEN=your_token
 *        TELEGRAM_CHAT_ID=your_chat_id
 *   4. Run: node telegramBot.js
 *
 * Dependencies: npm install node-fetch (or use Node 18+ native fetch)
 */

const BOT_TOKEN  = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID    = process.env.TELEGRAM_CHAT_ID;
const POLL_INTERVAL_MS = 60_000; // check every 60s

if (!BOT_TOKEN || !CHAT_ID) {
  console.error("❌ Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID env vars");
  process.exit(1);
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. TELEGRAM SEND
   ═══════════════════════════════════════════════════════════════════════════ */

async function sendTelegram(message) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text: message,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    console.error("Telegram send failed:", await res.text());
  }
  return res.ok;
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. MESSAGE FORMATTERS
   ═══════════════════════════════════════════════════════════════════════════ */

function formatGradeUpgrade(event, signal) {
  return [
    `🟢 *GRADE UPGRADE*`,
    ``,
    `*${signal.symbol}* (${signal.timeframe})`,
    `${event.message}`,
    ``,
    `📊 Score: ${signal.score}/100`,
    `📈 Entry: ${signal.entry || "—"}`,
    `🛑 Stop: ${signal.stop || "—"}`,
    `🎯 Target: ${signal.target || "—"}`,
    `⚖️ R:R: ${signal.riskReward}`,
    ``,
    `_Position: ${signal.positionSize}_`,
  ].join("\n");
}

function formatSqueezeFired(event, signal) {
  return [
    `⚡ *SQUEEZE FIRED*`,
    ``,
    `*${signal.symbol}* (${signal.timeframe})`,
    `${event.message}`,
    ``,
    `Grade: *${signal.grade}* | Bullish: *${signal.bullishPct}%*`,
    ``,
    `_Momentum breakout detected — check chart immediately_`,
  ].join("\n");
}

function formatHighConviction(event, signal) {
  return [
    `🔥 *HIGH CONVICTION SETUP*`,
    ``,
    `*${signal.symbol}* (${signal.timeframe})`,
    `Grade *${signal.grade}* at *${signal.bullishPct}%*`,
    ``,
    `📈 Entry: ${signal.entry}`,
    `🛑 Stop: ${signal.stop} (${signal.stopPct}%)`,
    `🎯 Target: ${signal.target} (${signal.targetPct}%)`,
    `⚖️ R:R: ${signal.riskReward}`,
    `📦 Size: ${signal.positionSize}`,
    ``,
    `✅ Checklist:`,
    ...signal.checklist
      .filter((c) => c.status === "CONFIRMED")
      .map((c) => `  • ${c.label.replace(/\n/g, " ")}`),
    ``,
    `_Full conviction — act on your plan_`,
  ].join("\n");
}

function formatBullTrap(ticker) {
  return [
    `🚨 *BULL TRAP WARNING*`,
    ``,
    `*${ticker.symbol}*`,
    `Social mentions surging (+${ticker.mentionVelocity}%) but volume dropping (${ticker.volumeRatio}× avg)`,
    `Sentiment: ${(ticker.avgSentiment * 100).toFixed(0)}% bullish`,
    ``,
    `_Divergence detected: hype ↑ volume ↓ — be cautious_`,
  ].join("\n");
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. NOTIFICATION DISPATCHER
   ═══════════════════════════════════════════════════════════════════════════ */

const FORMATTERS = {
  GRADE_UPGRADE:   formatGradeUpgrade,
  SQUEEZE_FIRED:   formatSqueezeFired,
  HIGH_CONVICTION: formatHighConviction,
  BULL_TRAP:       formatBullTrap,
};

async function dispatchNotifications(events, signals) {
  for (const event of events) {
    const signal = signals.find((s) => s.symbol === event.symbol) || {};
    const formatter = FORMATTERS[event.type];
    if (formatter) {
      const msg = formatter(event, signal);
      await sendTelegram(msg);
      console.log(`✅ Sent ${event.type} for ${event.symbol || "unknown"}`);
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. WEBHOOK HANDLER (Express/Next.js compatible)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Drop this into a Next.js API route or Express handler:
 *
 *   // pages/api/webhook/signal.js (Next.js)
 *   import { handleSignalWebhook } from "./telegramBot";
 *   export default handleSignalWebhook;
 *
 *   // Express
 *   app.post("/webhook/signal", handleSignalWebhook);
 */
export async function handleSignalWebhook(req, res) {
  try {
    const { events, signals } = req.body;
    if (!events?.length) return res.status(200).json({ ok: true, sent: 0 });

    await dispatchNotifications(events, signals);
    res.status(200).json({ ok: true, sent: events.length });
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(500).json({ error: err.message });
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. POLLING MODE (standalone)
   ═══════════════════════════════════════════════════════════════════════════ */

// In production, replace this with actual API calls to your signal service.
async function fetchLatestSignals() {
  // TODO: Replace with real endpoint
  // const res = await fetch("https://your-api.com/api/signals/latest");
  // return res.json();
  return { events: [], signals: [] };
}

async function pollLoop() {
  console.log("🚀 SIGNA Telegram Bot started — polling every", POLL_INTERVAL_MS / 1000, "s");
  while (true) {
    try {
      const { events, signals } = await fetchLatestSignals();
      if (events.length > 0) {
        await dispatchNotifications(events, signals);
      }
    } catch (err) {
      console.error("Poll error:", err.message);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

// Run in polling mode when executed directly
const isMain = typeof require !== "undefined" && require.main === module;
if (isMain) {
  pollLoop();
}
