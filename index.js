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
// SENDPULSE EVENT MAP
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
// SMARTICO EVENT MAP (query ev=...)
// Você pediu: Registro_vupibet, ftd_vupibet, qftd_vupibet, deposito_vupibet
// =========================
const SMARTICO_EVENT_MAP = {
  registro: { event_name: "Registro_vupibet", is_value_event: false },
  ftd: { event_name: "ftd_vupibet", is_value_event: true },
  qftd: { event_name: "qftd_vupibet", is_value_event: true },
  deposito: { event_name: "deposito_vupibet", is_value_event: true },
};

// =========================
// Helpers
// =========================
function sha256(str) {
  if (!str) return undefined;
  return crypto.createHash("sha256").update(String(str)).digest("hex");
}

function normalizeEmail(email) {
  if (!email) return "";
  return String(email).trim().toLowerCase();
}

function normalizePhone(phone) {
  if (!phone) return "";
  return String(phone).replace(/\D+/g, "");
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

// ---------- value helpers (SMARTICO) ----------
function toNumber(v) {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim().replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function pickCurrency(q) {
  const c = (q.currency || q.cur || q.payout_currency || q.payoutCurrency || "")
    .toString()
    .trim()
    .toUpperCase();
  return c || "BRL";
}

// =========================
// User Data builder (SendPulse)
// =========================
function buildUserData({ vars, telegram_id, req }) {
  const fbp = vars.fbp || undefined;
  const fbc = vars.fbc || undefined;

  const external_id = sha256(telegram_id) || undefined;

  const client_ip_address = getClientIp(req) || undefined;
  const client_user_agent = getUserAgent(req) || undefined;

  const rawEmail = vars.email || vars.em || vars.user_email || vars.userEmail || "";
  const rawPhone =
    vars.phone || vars.ph || vars.telefone || vars.tel || vars.user_phone || vars.userPhone || "";

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

// ✅ SENDPULSE ROTA ÚNICA
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

// ✅ Rotas compatíveis (não quebra funis antigos)
async function compatHandler(req, res, key) {
  try {
    console.log(`🔥 /sp/${key} WEBHOOK RECEBIDO`);
    console.log("🕒", new Date().toISOString());
    console.log("📦 BODY:", JSON.stringify(req.body, null, 2));

    if (!EVENT_MAP[key]) return res.status(400).json({ ok: false, error: "EVENT_NOT_MAPPED", key });

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

app.post("/sp/lead", (req, res) => compatHandler(req, res, "lead_telegram"));
app.post("/sp/register", (req, res) => compatHandler(req, res, "registro_casa"));
app.post("/sp/group", (req, res) => compatHandler(req, res, "grupo_telegram"));
app.post("/sp/bilhete", (req, res) => compatHandler(req, res, "bilhete_mgm"));

// =====================================================
// ✅ SMARTICO POSTBACK (GET)
// Configure no Smartico: https://SEU-APP.onrender.com/smartico/postback?ev=registro&...
//
// IMPORTANTE p/ VALUE:
// - deposito: mande &value={{deposit}}&currency=BRL  (ou payout_currency se disponível)
// - ftd: mande &value={{first_deposit_amount}}&currency=BRL
// - qftd: se tiver valor no Smartico, mande &value=... (se não tiver, vai 0)
// =====================================================
app.get("/smartico/postback", async (req, res) => {
  try {
    const q = req.query || {};
    const ev = safeString(q.ev || q.event || "").toLowerCase().trim();

    console.log("🔥 /smartico/postback RECEBIDO");
    console.log("🕒", new Date().toISOString());
    console.log("🔎 Query:", JSON.stringify(q || {}));

    if (!ev || !SMARTICO_EVENT_MAP[ev]) {
      return res.status(400).json({
        ok: false,
        error: "SMARTICO_EVENT_NOT_MAPPED",
        received_ev: ev,
        known_ev: Object.keys(SMARTICO_EVENT_MAP),
      });
    }

    const cfg = SMARTICO_EVENT_MAP[ev];

    // Identificadores vindos da Smartico
    // external_id: vamos hashear um identificador "estável" (customer_id OU registration_id)
    const registration_id = safeString(q.registration_id || q.registrationId || "");
    const customer_id = safeString(q.customer_id || q.customerId || "");
    const stableId = customer_id || registration_id || "";

    const event_name = cfg.event_name;

    // event_id: usar registration_id se existir (melhor), senão customer_id, senão random
    const event_id_base = registration_id || customer_id || crypto.randomUUID();
    const event_id = `${event_id_base}_${event_name}`;

    // IP/UA: aqui será do "servidor Smartico" (melhor do que nada, mas não é o IP real do usuário)
    const client_ip_address = getClientIp(req) || undefined;
    const client_user_agent = getUserAgent(req) || undefined;

    // VALUE/CURRENCY: agora lê do query (ou de campos conhecidos)
    // Você precisa mandar isso no postback:
    // &value={{deposit}} ou &value={{first_deposit_amount}}
    const value = toNumber(q.value || q.deposit || q.first_deposit_amount || q.firstDepositAmount);
    const currency = pickCurrency(q);

    // Monta o evento
    const event = {
      event_name,
      event_time: Math.floor(Date.now() / 1000),
      action_source: "website",
      event_id,
      user_data: {
        client_ip_address,
        client_user_agent,
        external_id: stableId ? sha256(stableId) : undefined,
      },
      custom_data: {
        origem: "smartico",

        // espelhar dados úteis da Smartico (se vierem)
        brand_name: safeString(q.brand_name || q.brandName || ""),
        brand_id: safeString(q.brand_id || q.brandId || ""),
        country_code: safeString(q.country_code || q.countryCode || ""),
        deal_id: safeString(q.deal_id || q.dealId || ""),
        deal_group_id: safeString(q.deal_group_id || q.dealGroupId || ""),
        campaign_id: safeString(q.campaign_id || q.campaignId || ""),
        campaign_name: safeString(q.campaign_name || q.campaignName || ""),
        link_id: safeString(q.link_id || q.linkId || ""),
        link_name: safeString(q.link_name || q.linkName || ""),

        registration_id,
        customer_id,

        utm_source: safeString(q.utm_source || ""),
        utm_medium: safeString(q.utm_medium || ""),
        utm_campaign: safeString(q.utm_campaign || ""),
        utm_content: safeString(q.utm_content || ""),

        afp: safeString(q.afp || ""),
        afp1: safeString(q.afp1 || ""),
        afp2: safeString(q.afp2 || ""),
        afp3: safeString(q.afp3 || ""),
        afp4: safeString(q.afp4 || ""),
        afp5: safeString(q.afp5 || ""),
        afp6: safeString(q.afp6 || ""),
        afp7: safeString(q.afp7 || ""),
        afp8: safeString(q.afp8 || ""),
        afp9: safeString(q.afp9 || ""),

        fbclid: safeString(q.fbclid || ""),
        fbp: safeString(q.fbp || ""),
        fbc: safeString(q.fbc || ""),

        // ✅ VALUE/CURRENCY: manda para Meta (obrigatório pra otimizar com valor)
        value: cfg.is_value_event ? value ?? 0 : undefined,
        currency: cfg.is_value_event ? currency : undefined,
      },
    };

    // Remove undefined do custom_data (pra não poluir)
    Object.keys(event.custom_data).forEach((k) => {
      if (event.custom_data[k] === undefined) delete event.custom_data[k];
    });

    console.log("🚀 Enviando Smartico -> Meta:", JSON.stringify(event, null, 2));
    const metaResp = await sendToMeta(event);
    console.log("✅ Meta OK:", JSON.stringify(metaResp));

    res.json({ ok: true, ev, event_name, event_id, meta: metaResp });
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
