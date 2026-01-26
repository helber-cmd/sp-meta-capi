// index.js — sp-meta-capi (100% multi-evento) — UPGRADE (IP + UA + trust proxy + email/phone opcional + SMARTICO value/currency)
// ✅ 1 rota principal: /sp/event  (SendPulse)
// ✅ Rotas de compatibilidade: /sp/lead, /sp/register, /sp/group, /sp/bilhete
// ✅ SMARTICO: /smartico/postback (GET) -> envia Registro_vupibet, ftd_vupibet, qftd_vupibet, deposito_vupibet
// ✅ Melhor match: client_ip_address + client_user_agent
// ✅ User data extra (opcional): em / ph (se existir no SendPulse)
// ✅ Dedupe forte: event_id = lead_id + event_name

import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";

const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "2mb" }));

const PIXEL_ID = process.env.META_PIXEL_ID;
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;

const META_API_VERSION = process.env.META_API_VERSION || "v20.0";
const DEFAULT_ACTION_SOURCE = process.env.META_ACTION_SOURCE || "chat";

// =========================
// EVENTOS (SendPulse -> Meta)
// =========================
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
    extra_custom_data: { origem: "telegram", produto: "bilhete_mgm" },
  },
  bilhete_novibet: {
    event_name: "Bilhete_Novibet",
    extra_custom_data: { origem: "telegram", produto: "bilhete_novibet" },
  },
  bilhete_vupibet: {
    event_name: "Bilhete_Vupibet",
    extra_custom_data: { origem: "telegram", produto: "bilhete_vupibet" },
  },
};

// =========================
// EVENTOS (Smartico -> Meta)
// (ev=registro|ftd|qftd|deposito)
// =========================
const SMARTICO_EVENT_MAP = {
  registro: "Registro_vupibet",
  ftd: "ftd_vupibet",
  qftd: "qftd_vupibet",
  deposito: "deposito_vupibet",
};

// =========================
// Helpers base
// =========================
function sha256(str) {
  if (!str) return undefined;
  return crypto.createHash("sha256").update(String(str)).digest("hex");
}

function safeString(v) {
  if (v === null || v === undefined) return "";
  return String(v);
}

// remove string vazia -> undefined
function cleanStr(v) {
  const s = (v ?? "").toString().trim();
  return s.length ? s : undefined;
}

// parse num seguro (Smartico manda "20.0000")
function parseValue(v) {
  if (v === null || v === undefined) return undefined;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
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

  const title = item?.title || item?.service || "";

  return {
    item,
    vars,
    telegram_id: safeString(telegram_id),
    title: safeString(title),
  };
}

function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) return safeString(xff).split(",")[0].trim();
  if (req.ip) return safeString(req.ip);
  return safeString(req.connection?.remoteAddress || "");
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

// =========================
// Build (SendPulse -> Meta)
// =========================
function buildUserDataFromSendPulse({ vars, telegram_id, req }) {
  const fbp = vars.fbp || undefined;
  const fbc = vars.fbc || undefined;

  const external_id = sha256(telegram_id) || undefined;

  const client_ip_address = getClientIp(req) || undefined;
  const client_user_agent = getUserAgent(req) || undefined;

  // OPCIONAIS (se coletar no funil)
  const rawEmail = vars.email || vars.em || vars.user_email || vars.userEmail || "";
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

function buildSendPulseEvent({ cfg, vars, telegram_id, req }) {
  const leadId = vars.lead_id || crypto.randomUUID();
  const event_name = cfg.event_name;
  const event_id = `${leadId}_${event_name}`;

  return {
    event_name,
    event_time: Math.floor(Date.now() / 1000),
    action_source: DEFAULT_ACTION_SOURCE,
    event_id,
    user_data: buildUserDataFromSendPulse({ vars, telegram_id, req }),
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
  const q = safeString(req.query?.e || req.query?.event || "").toLowerCase().trim();
  if (q) return q;

  const title = safeString(extracted?.title || "").toLowerCase().trim();
  if (title) return title;

  return "";
}

// =========================
// Routes
// =========================
app.get("/", (req, res) => res.status(200).send("OK"));

// ✅ ROTA ÚNICA (SendPulse)
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
    const event = buildSendPulseEvent({
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
// Rotas de compatibilidade (SendPulse antigo)
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

    const event = buildSendPulseEvent({
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

app.post("/sp/lead", (req, res) => compatHandler(req, res, "lead_telegram"));
app.post("/sp/register", (req, res) => compatHandler(req, res, "registro_casa"));
app.post("/sp/group", (req, res) => compatHandler(req, res, "grupo_telegram"));
app.post("/sp/bilhete", (req, res) => compatHandler(req, res, "bilhete_mgm"));

// =========================
// ✅ SMARTICO -> META (FIX atribuição)
// =========================
app.get("/smartico/postback", async (req, res) => {
  try {
    console.log("🔥 /smartico/postback RECEBIDO");
    console.log("🕒", new Date().toISOString());
    console.log("🔎 Query:", JSON.stringify(req.query || {}));

    const q = req.query || {};
    const evKey = safeString(q.ev || "").toLowerCase().trim();

    const metaEventName = SMARTICO_EVENT_MAP[evKey];
    if (!metaEventName) {
      console.warn("⚠️ Smartico ev não mapeado:", evKey);
      return res.status(400).json({
        ok: false,
        error: "SMARTICO_EVENT_NOT_MAPPED",
        received_ev: evKey,
        known_ev: Object.keys(SMARTICO_EVENT_MAP),
      });
    }

    // event_time: se Smartico mandar unix epoch (segundos) a gente usa, senão "agora"
    const smarticoTime =
      parseInt(String(q.registration_date || q.first_deposit_date || ""), 10) || 0;
    const event_time = smarticoTime > 0 ? smarticoTime : Math.floor(Date.now() / 1000);

    // ✅ Dedupe: preferir registration_id, senão click_id
    const baseId = cleanStr(q.registration_id) || cleanStr(q.click_id) || crypto.randomUUID();
    const event_id = `${baseId}_${metaEventName}`;

    // ✅ FIX PRINCIPAL: fbp/fbc em user_data (não em custom_data)
    const fbp = cleanStr(q.fbp);
    const fbc = cleanStr(q.fbc);

    // external_id: hash do click_id (ou afp), fallback customer_id
    const extSeed = cleanStr(q.click_id) || cleanStr(q.afp) || cleanStr(q.customer_id) || "";
    const external_id = extSeed ? sha256(extSeed) : undefined;

    const value =
      parseValue(q.value) ??
      parseValue(q.first_deposit_amount) ??
      parseValue(q.deposit);

    const currency = cleanStr(q.currency) || cleanStr(q.payout_currency) || "BRL";

    const event = {
      event_name: metaEventName,
      event_time,
      action_source: "website",
      event_id,

      user_data: {
        client_ip_address: cleanStr(getClientIp(req)),
        client_user_agent: cleanStr(getUserAgent(req)),
        external_id,
        fbp,
        fbc,
      },

      custom_data: {
        origem: "smartico",

        brand_name: cleanStr(q.brand_name),
        brand_id: cleanStr(q.brand_id),
        country_code: cleanStr(q.country_code),
        deal_id: cleanStr(q.deal_id),
        deal_group_id: cleanStr(q.deal_group_id),
        deal_group_name: cleanStr(q.deal_group_name),

        campaign_id: cleanStr(q.campaign_id),
        campaign_name: cleanStr(q.campaign_name),

        link_id: cleanStr(q.link_id),
        link_name: cleanStr(q.link_name),

        registration_id: cleanStr(q.registration_id),
        customer_id: cleanStr(q.customer_id),

        utm_source: cleanStr(q.utm_source),
        utm_medium: cleanStr(q.utm_medium),
        utm_campaign: cleanStr(q.utm_campaign),
        utm_content: cleanStr(q.utm_content),

        afp: cleanStr(q.afp),
        afp1: cleanStr(q.afp1),
        afp2: cleanStr(q.afp2),
        afp3: cleanStr(q.afp3),
        afp4: cleanStr(q.afp4),
        afp5: cleanStr(q.afp5),
        afp6: cleanStr(q.afp6),
        afp7: cleanStr(q.afp7),
        afp8: cleanStr(q.afp8),
        afp9: cleanStr(q.afp9),

        fbclid: cleanStr(q.fbclid),

        // ✅ Valor para ftd/qftd/deposito
        value: value ?? undefined,
        currency,
      },
    };

    console.log("🚀 Enviando Smartico -> Meta:", JSON.stringify(event, null, 2));
    const metaResp = await sendToMeta(event);
    console.log("✅ Meta OK:", JSON.stringify(metaResp));

    res.json({ ok: true, ev: evKey, event_name: metaEventName, event_id, meta: metaResp });
  } catch (err) {
    console.error("❌ /smartico/postback ERROR:", err?.message || err);
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// Start
const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`🚀 sp-meta-capi listening on port ${port}`);
});
