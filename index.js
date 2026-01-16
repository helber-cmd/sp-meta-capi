// index.js — sp-meta-capi (100% multi-evento)
// ✅ 1 rota principal: /sp/event
// ✅ Rotas de compatibilidade (opcional)
// ✅ IP + User-Agent
// ✅ lead_id em user_data (melhor match)
// ✅ Dedupe forte: event_id = lead_id + event_name
// ✅ Logs enxutos

import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";

const app = express();
app.use(express.json({ limit: "2mb" }));

const PIXEL_ID = process.env.META_PIXEL_ID;
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;

const META_API_VERSION = process.env.META_API_VERSION || "v20.0";
const DEFAULT_ACTION_SOURCE = process.env.META_ACTION_SOURCE || "chat";

/* =========================
   EVENT MAP
========================= */
const EVENT_MAP = {
  lead_telegram: { event_name: "Lead_Telegram" },
  registro_casa: { event_name: "Registro_Casa" },
  grupo_telegram: { event_name: "Grupo_Telegram" },
  bilhete_mgm: {
    event_name: "Bilhete_MGM",
    extra_custom_data: { origem: "telegram", produto: "bilhete_mgm" },
  },
};

/* =========================
   Helpers
========================= */
function sha256(str) {
  if (!str) return undefined;
  return crypto.createHash("sha256").update(String(str)).digest("hex");
}

function getItem(body) {
  return Array.isArray(body) ? body[0] : body;
}

function safeString(v) {
  if (v === null || v === undefined) return "";
  return String(v);
}

function extractVarsAndTelegramId(body) {
  const item = getItem(body);

  const vars =
    item?.contact?.variables ||
    item?.contact?.last_message_data?.message?.tracking_data?.contact_variables ||
    {};

  const telegram_id =
    item?.contact?.telegram_id ||
    item?.contact?.last_message_data?.chat_id ||
    item?.contact?.last_message_data?.telegram_id ||
    "";

  const title = item?.title || "";

  return {
    vars,
    telegram_id: safeString(telegram_id),
    title: safeString(title),
  };
}

function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) return safeString(xff).split(",")[0].trim();
  return safeString(req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || "");
}

function getUserAgent(req) {
  return safeString(req.headers["user-agent"] || "");
}

async function sendToMeta(event) {
  if (!PIXEL_ID || !ACCESS_TOKEN) {
    throw new Error("Missing META_PIXEL_ID or META_ACCESS_TOKEN");
  }

  const url = `https://graph.facebook.com/${META_API_VERSION}/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: [event] }),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json));
  return json;
}

function buildEvent({ cfg, vars, telegram_id, req }) {
  const leadId = vars.lead_id || crypto.randomUUID();
  const event_name = cfg.event_name;
  const event_id = `${leadId}_${event_name}`;

  const client_ip_address = getClientIp(req);
  const client_user_agent = getUserAgent(req);

  return {
    event_name,
    event_time: Math.floor(Date.now() / 1000),
    action_source: DEFAULT_ACTION_SOURCE,
    event_id,

    user_data: {
      // 🔥 melhoria aplicada conforme documentação Meta
      lead_id: leadId,

      fbp: vars.fbp || undefined,
      fbc: vars.fbc || undefined,
      external_id: sha256(telegram_id) || undefined,
      client_ip_address: client_ip_address || undefined,
      client_user_agent: client_user_agent || undefined,
    },

    custom_data: {
      lead_id: leadId,
      telegram_id,
      utm_source: vars.utm_source,
      utm_medium: vars.utm_medium,
      utm_campaign: vars.utm_campaign,
      utm_content: vars.utm_content,
      fbclid: vars.fbclid,
      ...(cfg.extra_custom_data || {}),
    },
  };
}

function resolveEventKey(req, extracted) {
  const q = safeString(req.query?.e || "").toLowerCase().trim();
  if (q) return q;

  const title = safeString(extracted?.title || "").toLowerCase().trim();
  if (title) return title;

  return "";
}

/* =========================
   Routes
========================= */
app.get("/", (_, res) => res.send("OK"));

app.post("/sp/event", async (req, res) => {
  try {
    const extracted = extractVarsAndTelegramId(req.body);
    const key = resolveEventKey(req, extracted);

    if (!key || !EVENT_MAP[key]) {
      return res.status(400).json({ ok: false, error: "EVENT_NOT_MAPPED", key });
    }

    const cfg = EVENT_MAP[key];
    const event = buildEvent({
      cfg,
      vars: extracted.vars,
      telegram_id: extracted.telegram_id,
      req,
    });

    console.log("🚀 Evento enviado:", {
      event_name: event.event_name,
      event_id: event.event_id,
      has_ip: !!event.user_data.client_ip_address,
      has_ua: !!event.user_data.client_user_agent,
      has_lead_id: !!event.user_data.lead_id,
    });

    const metaResp = await sendToMeta(event);
    console.log("✅ Meta OK:", metaResp);

    res.json({ ok: true, event: event.event_name, event_id: event.event_id });
  } catch (err) {
    console.error("❌ ERROR:", err?.message || err);
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

/* =========================
   Start
========================= */
const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`🚀 sp-meta-capi listening on port ${port}`);
});
