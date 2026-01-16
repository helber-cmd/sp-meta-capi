// index.js — sp-meta-capi (100% multi-evento)
// ✅ 1 rota principal: /sp/event
// ✅ Rotas de compatibilidade (opcional): /sp/lead, /sp/register, /sp/group, /sp/bilhete
// ✅ Melhor match: envia client_ip_address e client_user_agent
// ✅ Dedupe forte: event_id = lead_id + event_name

import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";

const app = express();
app.use(express.json({ limit: "2mb" }));

const PIXEL_ID = process.env.META_PIXEL_ID;
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;

const META_API_VERSION = process.env.META_API_VERSION || "v20.0";
const DEFAULT_ACTION_SOURCE = process.env.META_ACTION_SOURCE || "chat";

// =========================
// MAPA (chave -> evento meta)
// =========================
// Você pode disparar o evento por:
// - query: /sp/event?e=lead_telegram
// - body.title vindo do SendPulse (ex: "lead_telegram")
// - ou usando as rotas antigas (/sp/lead etc)
const EVENT_MAP = {
  lead_telegram: {
    event_name: "Lead_Telegram",
    route_key: "lead",
    extra_custom_data: {},
  },
  registro_casa: {
    event_name: "Registro_Casa",
    route_key: "register",
    extra_custom_data: {},
  },
  grupo_telegram: {
    event_name: "Grupo_Telegram",
    route_key: "group",
    extra_custom_data: {},
  },
  bilhete_mgm: {
    event_name: "Bilhete_MGM",
    route_key: "bilhete",
    extra_custom_data: {
      origem: "telegram",
      produto: "bilhete_mgm",
    },
  },
};

// ==================================
// Helpers (hash, parsing, ip/useragent)
// ==================================
function sha256(str) {
  if (!str) return undefined;
  return crypto.createHash("sha256").update(String(str)).digest("hex");
}

// O SendPulse manda um ARRAY com 1 item. Aqui a gente normaliza.
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

  // title é ótimo p/ identificar o tipo do evento (lead_telegram, etc)
  const title = item?.title || item?.service || "";

  return { item, vars, telegram_id: safeString(telegram_id), title: safeString(title) };
}

function getClientIp(req) {
  // Render/Proxies: X-Forwarded-For pode vir como "ip1, ip2, ip3"
  const xff = req.headers["x-forwarded-for"];
  if (xff) return safeString(xff).split(",")[0].trim();
  // fallback
  return safeString(req.ip || req.connection?.remoteAddress || "");
}

function getUserAgent(req) {
  return safeString(req.headers["user-agent"] || "");
}

async function sendToMeta(event) {
  if (!PIXEL_ID || !ACCESS_TOKEN) {
    throw new Error("Missing META_PIXEL_ID or META_ACCESS_TOKEN in environment variables.");
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

function buildEvent({ cfg, vars, telegram_id, req, overrideEventName }) {
  const leadId = vars.lead_id || crypto.randomUUID();

  const event_name = overrideEventName || cfg.event_name;

  // DEDUPE FORTE: lead_id + event_name
  const event_id = `${leadId}_${event_name}`;

  const client_ip_address = getClientIp(req);
  const client_user_agent = getUserAgent(req);

  return {
    event_name,
    event_time: Math.floor(Date.now() / 1000),
    action_source: DEFAULT_ACTION_SOURCE,
    event_id,

    user_data: {
      // Atribuição
      fbp: vars.fbp || undefined,
      fbc: vars.fbc || undefined,

      // Identificador (hash do telegram_id)
      external_id: sha256(telegram_id) || undefined,

      // Aumenta muito o match rate (qualidade)
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
  // 1) Query (mais simples p/ vários funis)
  const q = safeString(req.query?.e || req.query?.event || "").toLowerCase().trim();
  if (q) return q;

  // 2) Body title (SendPulse)
  const title = safeString(extracted?.title || "").toLowerCase().trim();
  if (title) return title;

  return "";
}

// =========================
// Routes
// =========================
app.get("/", (req, res) => res.status(200).send("OK"));

// ✅ ROTA ÚNICA MULTI-EVENTO
// Você pode chamar de 2 formas:
// 1) SendPulse -> URL: https://SEU-APP.onrender.com/sp/event?e=lead_telegram
// 2) Se o body já vem com title="lead_telegram", pode chamar só /sp/event
app.post("/sp/event", async (req, res) => {
  try {
    console.log("🔥 /sp/event WEBHOOK RECEBIDO");
    console.log("🕒", new Date().toISOString());
    console.log("🔎 Query:", JSON.stringify(req.query || {}));
    console.log("📦 BODY:", JSON.stringify(req.body, null, 2));

    const extracted = extractVarsAndTelegramId(req.body);
    const key = resolveEventKey(req, extracted);

    if (!key || !EVENT_MAP[key]) {
      const known = Object.keys(EVENT_MAP);
      console.warn("⚠️ Evento não mapeado:", key);
      return res.status(400).json({
        ok: false,
        error: "EVENT_NOT_MAPPED",
        received_key: key,
        known_keys: known,
        hint: "Use /sp/event?e=lead_telegram (ou outro), ou garanta que o body.title venha como lead_telegram.",
      });
    }

    const cfg = EVENT_MAP[key];
    const event = buildEvent({
      cfg,
      vars: extracted.vars,
      telegram_id: extracted.telegram_id,
      req,
    });

    console.log("🚀 Enviando para Meta:", JSON.stringify(event, null, 2));

    const metaResp = await sendToMeta(event);
    console.log("✅ Meta OK:", JSON.stringify(metaResp));

    res.json({ ok: true, key, event_name: event.event_name, event_id: event.event_id, meta: metaResp });
  } catch (err) {
    console.error("❌ /sp/event ERROR:", err?.message || err);
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// =========================
// Rotas de compatibilidade (opcional)
// Se você NÃO quiser manter, pode apagar.
// Mantive para você não precisar mexer em tudo de uma vez.
// =========================
async function compatHandler(req, res, key) {
  try {
    console.log(`🔥 /sp/${key} WEBHOOK RECEBIDO`);
    console.log("🕒", new Date().toISOString());
    console.log("📦 BODY:", JSON.stringify(req.body, null, 2));

    if (!EVENT_MAP[key]) {
      return res.status(400).json({ ok: false, error: "EVENT_NOT_MAPPED", key });
    }

    const extracted = extractVarsAndTelegramId(req.body);
    const cfg = EVENT_MAP[key];

    const event = buildEvent({
      cfg,
      vars: extracted.vars,
      telegram_id: extracted.telegram_id,
      req,
    });

    console.log("🚀 Enviando para Meta:", JSON.stringify(event, null, 2));

    const metaResp = await sendToMeta(event);
    console.log("✅ Meta OK:", JSON.stringify(metaResp));

    res.json({ ok: true, key, event_name: event.event_name, event_id: event.event_id, meta: metaResp });
  } catch (err) {
    console.error(`❌ /sp/${key} ERROR:`, err?.message || err);
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}

// Rotas antigas -> chaves do EVENT_MAP
app.post("/sp/lead", (req, res) => compatHandler(req, res, "lead_telegram"));
app.post("/sp/register", (req, res) => compatHandler(req, res, "registro_casa"));
app.post("/sp/group", (req, res) => compatHandler(req, res, "grupo_telegram"));
app.post("/sp/bilhete", (req, res) => compatHandler(req, res, "bilhete_mgm"));

// Start
const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`🚀 sp-meta-capi listening on port ${port}`);
});

