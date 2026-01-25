// index.js — sp-meta-capi (Telegram SendPulse + Smartico Postbacks) — UPGRADE FINAL
// ✅ 1 rota principal (SendPulse): POST /sp/event?e=lead_telegram|registro_casa|grupo_telegram|bilhete_mgm|bilhete_novibet...
// ✅ Rotas compat (SendPulse): POST /sp/lead /sp/register /sp/group /sp/bilhete
// ✅ Smartico (GET): /smartico/postback?ev=registro|ftd|qftd|deposito&click_id=...
// ✅ Melhor match: trust proxy + client_ip_address + client_user_agent
// ✅ User data extra opcional: em / ph (se existir no SendPulse)
// ✅ Dedupe forte: event_id = lead_id + event_name
// ✅ event_time Smartico: usa registration_date / first_deposit_date quando houver

import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";

const app = express();

// IMPORTANTE: atrás do Render/proxy, melhora req.ip e x-forwarded-for
app.set("trust proxy", true);

app.use(express.json({ limit: "2mb" }));

// ===== ENV =====
const PIXEL_ID = process.env.META_PIXEL_ID;
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;

const META_API_VERSION = process.env.META_API_VERSION || "v20.0";
const DEFAULT_ACTION_SOURCE = process.env.META_ACTION_SOURCE || "chat";

// =========================
// MAPA (chave -> evento meta) — SENDPULSE/TELEGRAM
// =========================
// Disparo via:
// - query: /sp/event?e=lead_telegram
// - body.title do SendPulse (ex: "lead_telegram")
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

  // ✅ Extras (exemplo)
  bilhete_novibet: {
    event_name: "Bilhete_Novibet",
    extra_custom_data: { origem: "telegram", produto: "bilhete_novibet" },
  },
  // Se quiser adicionar mais: copie um bloco acima e altere key/event_name/produto.
};

// =========================
// SMARTICO (ev -> evento meta)
// =========================
const SMARTICO_EVENT_MAP = {
  registro: "Registro_vupibet",
  ftd: "ftd_vupibet",
  qftd: "qftd_vupibet",
  deposito: "deposito_vupibet",
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
  // Preferir x-forwarded-for (Render / proxies)
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

function buildUserData({ vars, telegram_id, req }) {
  const fbp = vars.fbp || undefined;
  const fbc = vars.fbc || undefined;

  const external_id = sha256(telegram_id) || undefined;

  const client_ip_address = getClientIp(req) || undefined;
  const client_user_agent = getUserAgent(req) || undefined;

  // OPCIONAIS (se coletar no funil SendPulse)
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

function buildEvent({ cfg, vars, telegram_id, req }) {
  const leadId = vars.lead_id || crypto.randomUUID();

  const event_name = cfg.event_name;

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
  const q = safeString(req.query?.e || req.query?.event || "").toLowerCase().trim();
  if (q) return q;

  const title = safeString(extracted?.title || "").toLowerCase().trim();
  if (title) return title;

  return "";
}

// =========================
// SMARTICO helpers
// =========================
function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// event_time baseado nas datas da Smartico quando existirem
function smarticoEventTime(ev, q) {
  const reg = toInt(q.registration_date);
  const ftd = toInt(q.first_deposit_date);

  if (ev === "registro" && reg) return reg;
  if ((ev === "ftd" || ev === "qftd") && ftd) return ftd;

  if (reg) return reg;
  return Math.floor(Date.now() / 1000);
}

// Normaliza click_id (vamos usar como lead_id / event_id base)
function normalizeClickId(v) {
  const s = safeString(v).trim();
  if (!s) return "";
  // evita caracteres muito doidos
  return s.slice(0, 128);
}

// Para Smartico, user_data vem principalmente de fbp/fbc (se você conseguir passar) + IP/UA do callback
function buildSmarticoUserData({ req, q }) {
  const client_ip_address = getClientIp(req) || undefined;
  const client_user_agent = getUserAgent(req) || undefined;

  // Se você passar via Smartico macros: fbp / fbc (ótimo)
  const fbp = q.fbp ? safeString(q.fbp) : undefined;
  const fbc = q.fbc ? safeString(q.fbc) : undefined;

  // Se você passar algum identificador de cliente (opcional) dá pra hash também
  const customer_id = q.customer_id ? sha256(safeString(q.customer_id)) : undefined;
  const registration_id = q.registration_id ? sha256(safeString(q.registration_id)) : undefined;

  const user_data = {
    client_ip_address,
    client_user_agent,
  };

  if (fbp) user_data.fbp = fbp;
  if (fbc) user_data.fbc = fbc;

  // external_id extra: ajuda match (opcional)
  // OBS: só use se você quiser (é hash, mas pode gerar duplicidade se mudar)
  if (customer_id) user_data.external_id = customer_id;

  // Também dá pra mandar como external_id alternativo em outro campo (ex: external_id array),
  // mas mantive simples.
  return user_data;
}

function buildSmarticoEvent({ req, q }) {
  const ev = safeString(q.ev).toLowerCase().trim();
  const metaEventName = SMARTICO_EVENT_MAP[ev];

  if (!metaEventName) {
    return { error: "SMARTICO_EVENT_NOT_MAPPED", ev, known: Object.keys(SMARTICO_EVENT_MAP) };
  }

  // click_id recomendado = {{afp}} (você controla)
  const click_id = normalizeClickId(q.click_id || q.afp || "");
  const lead_id = click_id || normalizeClickId(q.registration_id || q.customer_id || "");

  if (!lead_id) {
    return { error: "MISSING_CLICK_ID", hint: "Passe click_id={{afp}} (recomendado) ou ao menos registration_id/customer_id." };
  }

  const event_id = `${lead_id}_${metaEventName}`;

  // Valores numéricos (se existirem)
  const first_deposit_amount = q.first_deposit_amount ? Number(q.first_deposit_amount) : undefined;
  const deposit_total = q.deposit ? Number(q.deposit) : undefined;

  const currency =
    safeString(q.payout_currency || q.currency || "BRL").toUpperCase().slice(0, 3) || "BRL";

  const custom_data = {
    origem: "smartico",
    brand_name: q.brand_name,
    brand_id: q.brand_id,
    country_code: q.country_code,
    deal_id: q.deal_id,
    campaign_id: q.campaign_id,
    campaign_name: q.campaign_name,
    link_id: q.link_id,
    registration_id: q.registration_id,
    customer_id: q.customer_id,

    utm_source: q.utm_source,
    utm_medium: q.utm_medium,
    utm_campaign: q.utm_campaign,

    afp: q.afp,
    afp1: q.afp1,
    afp2: q.afp2,
    afp3: q.afp3,
    afp4: q.afp4,
    afp5: q.afp5,
    afp6: q.afp6,
    afp7: q.afp7,
    afp8: q.afp8,
    afp9: q.afp9,

    fbclid: q.fbclid,
  };

  // Se tiver valores, manda (ajuda relatórios)
  if (ev === "ftd" || ev === "qftd") {
    if (Number.isFinite(first_deposit_amount)) {
      custom_data.value = first_deposit_amount;
      custom_data.currency = currency;
    }
  }

  if (ev === "deposito") {
    if (Number.isFinite(deposit_total)) {
      custom_data.value = deposit_total;
      custom_data.currency = currency;
    }
  }

  return {
    event_name: metaEventName,
    event_time: smarticoEventTime(ev, q),
    action_source: "website", // callback de web normalmente
    event_id,
    user_data: buildSmarticoUserData({ req, q }),
    custom_data,
  };
}

// =========================
// Routes
// =========================
app.get("/", (req, res) => res.status(200).send("OK"));

// ---------- SENDPULSE MULTI EVENT ----------
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

// ---------- SENDPULSE COMPAT ROUTES ----------
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

app.post("/sp/lead", (req, res) => compatHandler(req, res, "lead_telegram"));
app.post("/sp/register", (req, res) => compatHandler(req, res, "registro_casa"));
app.post("/sp/group", (req, res) => compatHandler(req, res, "grupo_telegram"));
app.post("/sp/bilhete", (req, res) => compatHandler(req, res, "bilhete_mgm"));

// ---------- SMARTICO POSTBACK (GET) ----------
app.get("/smartico/postback", async (req, res) => {
  try {
    // Smartico manda GET com query params
    const q = req.query || {};
    const ev = safeString(q.ev).toLowerCase().trim();

    console.log("📩 /smartico/postback RECEBIDO");
    console.log("🕒", new Date().toISOString());
    console.log("🔎 Query:", JSON.stringify(q || {}));

    const event = buildSmarticoEvent({ req, q });

    if (event?.error) {
      console.warn("⚠️ Smartico inválido:", event);
      return res.status(400).json({ ok: false, ...event });
    }

    console.log("🚀 Enviando Smartico -> Meta:", JSON.stringify(event, null, 2));

    const metaResp = await sendToMeta(event);
    console.log("✅ Meta OK (Smartico):", JSON.stringify(metaResp));

    res.json({
      ok: true,
      source: "smartico",
      ev,
      event_name: event.event_name,
      event_id: event.event_id,
      meta: metaResp,
    });
  } catch (err) {
    console.error("❌ /smartico/postback ERROR:", err?.message || err);
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// ---------- START ----------
const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`🚀 sp-meta-capi listening on port ${port}`);
});
