// index.js — sp-meta-capi (100% multi-evento) — UPGRADE (IP + UA + trust proxy + email/phone opcional)
// ✅ 1 rota principal: /sp/event
// ✅ Rotas de compatibilidade: /sp/lead, /sp/register, /sp/group, /sp/bilhete
// ✅ Melhor match: client_ip_address + client_user_agent
// ✅ User data extra (opcional): em / ph (se existir no SendPulse)
// ✅ Dedupe forte: event_id = lead_id + event_name

import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";

const app = express();

// IMPORTANTE: atrás do Render/proxy, isso ajuda o req.ip e headers funcionarem direito
app.set("trust proxy", true);

app.use(express.json({ limit: "2mb" }));

const PIXEL_ID = process.env.META_PIXEL_ID;
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;

const META_API_VERSION = process.env.META_API_VERSION || "v20.0";
const DEFAULT_ACTION_SOURCE = process.env.META_ACTION_SOURCE || "chat";

// =========================
// MAPA (chave -> evento meta)
// =========================
// Disparo via:
// - query: /sp/event?e=lead_telegram
// - body.title do SendPulse (ex: "lead_telegram")
// - rotas antigas (/sp/lead etc)
const EVENT_MAP = {
  lead_telegram: {
    event_name: "Lead_Telegram",
    extra_custom_data: {},
  },
  registro_casa: {
    event_name: "Registro_Casa",
    extra_custom_data: {},
  },
  grupo_telegram: {
    event_name: "Grupo_Telegram",
    extra_custom_data: {},
  },
  bilhete_mgm: {
    event_name: "Bilhete_MGM",
    extra_custom_data: {
      origem: "telegram",
      produto: "bilhete_mgm",
    },
  },

  // ✅ NOVO EVENTO
  bilhete_novibet: {
    event_name: "Bilhete_Novibet",
    extra_custom_data: {
      origem: "telegram",
      produto: "bilhete_novibet",
    },
  },
};

// =========================
// Helpers
// =========================
function sha256(str) {
  if (!str) return undefined;
  return crypto.createHash("sha256").update(String(str)).digest("hex");
}

// Normalização recomendada p/ hashing de email (trim + lower)
function normalizeEmail(email) {
  if (!email) return "";
  return String(email).trim().toLowerCase();
}

// Normalização recomendada p/ telefone: só dígitos
function normalizePhone(phone) {
  if (!phone) return "";
  return String(phone).replace(/\D+/g, "");
}

// SendPulse manda um ARRAY com 1 item. Normaliza.
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

  // title ajuda a identificar o evento (lead_telegram, etc)
  const title = item?.title || item?.service || "";

  return {
    item,
    vars,
    telegram_id: safeString(telegram_id),
    title: safeString(title),
  };
}

function getClientIp(req) {
  // Preferir x-forwarded-for (Render / proxies)
  const xff = req.headers["x-forwarded-for"];
  if (xff) return safeString(xff).split(",")[0].trim();

  // Depois, req.ip (com trust proxy ligado tende a ficar ok)
  if (req.ip) return safeString(req.ip);

  // fallback
  return safeString(req.connection?.remoteAddress || "");
}

function getUserAgent(req) {
  return safeString(req.headers["user-agent"] || "");
}

async function sendToMeta(event) {
  if (!PIXEL_ID || !ACCESS_TOKEN) {
    throw new Error(
      "Missing META_PIXEL_ID or META_ACCESS_TOKEN in environment variables."
    );
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

function buildUserData({ vars, telegram_id, req }) {
  // ====== Dados de atribuição (já vem do seu link tg.pulse.is)
  const fbp = vars.fbp || undefined;
  const fbc = vars.fbc || undefined;

  // ====== Identificador (hash do telegram_id)
  const external_id = sha256(telegram_id) || undefined;

  // ====== IP + UA reais (melhora o match rate)
  const client_ip_address = getClientIp(req) || undefined;
  const client_user_agent = getUserAgent(req) || undefined;

  // ====== OPCIONAIS (se você coletar no funil)
  const rawEmail =
    vars.email || vars.em || vars.user_email || vars.userEmail || "";
  const rawPhone =
    vars.phone ||
    vars.ph ||
    vars.telefone ||
    vars.tel ||
    vars.user_phone ||
    vars.userPhone ||
    "";

  const emNorm = normalizeEmail(rawEmail);
  const phNorm = normalizePhone(rawPhone);

  const em = emNorm ? sha256(emNorm) : undefined;
  const ph = phNorm ? sha256(phNorm) : undefined;

  const user_data = {
    fbp,
    fbc,
    external_id,
    client_ip_address,
    client_user_agent,
  };

  if (em) user_data.em = em;
  if (ph) user_data.ph = ph;

  return user_data;
}

function buildEvent({ cfg, vars, telegram_id, req, overrideEventName }) {
  const leadId = vars.lead_id || crypto.randomUUID();

  const event_name = overrideEventName || cfg.event_name;

  // DEDUPE FORTE: lead_id + event_name
  const event_id = `${leadId}_${event_name}`;

  return {
    event_name,
    event_time: Math.floor(Date.now() / 1000),
    action_source: DEFAULT_ACTION_SOURCE,
    event_id,

    user_data: buildUserData({ vars, telegram_id, req }),

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
  // 1) Query (padrão multi-funis)
  const q = safeString(req.query?.e || req.query?.event || "")
    .toLowerCase()
    .trim();
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

    res.json({
      ok: true,
      key,
      event_name: event.event_name,
      event_id: event.event_id,
      meta: metaResp,
    });
  } catch (err) {
    console.error("❌ /sp/event ERROR:", err?.message || err);
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// =========================
// Rotas de compatibilidade (opcional)
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

    res.json({
      ok: true,
      key,
      event_name: event.event_name,
      event_id: event.event_id,
      meta: metaResp,
    });
  } catch (err) {
    console.error(`❌ /sp/${key} ERROR:`, err?.message || err);
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}

// Rotas antigas -> chaves do EVENT_MAP
app.post("/sp/lead", (req, res) => compatHandler(req, res, "lead_telegram"));
app.post("/sp/register", (req, res) =>
  compatHandler(req, res, "registro_casa")
);
app.post("/sp/group", (req, res) =>
  compatHandler(req, res, "grupo_telegram")
);
app.post("/sp/bilhete", (req, res) => compatHandler(req, res, "bilhete_mgm"));

// (Opcional) se você quiser uma rota antiga específica pra novibet, descomente:
// app.post("/sp/bilhete-novibet", (req, res) => compatHandler(req, res, "bilhete_novibet"));

// Start
const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`🚀 sp-meta-capi listening on port ${port}`);
});
