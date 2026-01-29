// index.js — sp-meta-capi (100% multi-evento) — FULL + REVISADO
// =====================================================================
// ✅ ATUALIZAÇÕES (TOPO — sempre manter aqui)
// 1) ✅ ROTA ÚNICA SendPulse -> Meta: POST /sp/event?e=CHAVE_DO_EVENTO
// 2) ✅ Rotas de compatibilidade (não quebrar funis antigos):
//    - POST /sp/lead      -> lead_telegram
//    - POST /sp/register  -> registro_casa
//    - POST /sp/group     -> grupo_telegram
//    - POST /sp/bilhete   -> bilhete_mgm
// 3) ✅ Melhor Match Quality (Meta CAPI):
//    - app.set("trust proxy", true) (Render)
//    - user_data.client_ip_address + user_data.client_user_agent
// 4) ✅ Atribuição correta nas campanhas:
//    - fbp + fbc SEMPRE em user_data (não só em custom_data)
// 5) ✅ Identificador consistente (match id forte):
//    - SendPulse: external_id = hash(telegram_id)
//    - Smartico: external_id = hash(click_id | afp | customer_id)
// 6) ✅ DEDUPE forte:
//    - SendPulse: event_id = lead_id + event_name
//    - Smartico: event_id = registration_id (ou click_id) + event_name
// 7) ✅ User data extra opcional (SendPulse):
//    - em/ph (se existir nas variáveis do contato) com normalização + hash
// 8) ✅ Smartico -> Meta (GET /smartico/postback):
//    - Mapeia ev=registro|ftd|qftd|deposito -> nomes Meta desejados
//    - Converte value corretamente: value | first_deposit_amount | deposit
//
// ✅ EVENTOS ATIVOS (TOPO — para referência rápida)
// SendPulse (/sp/event?e=...)
// - lead_telegram         -> Lead_Telegram
// - registro_casa         -> Registro_Casa
// - grupo_telegram        -> Grupo_Telegram
// - bilhete_mgm           -> Bilhete_MGM
// - bilhete_novibet       -> Bilhete_Novibet
// - bilhete_vupibet       -> Bilhete_Vupibet
// - lead_whatsapp         -> Lead_Whatsapp            ✅ NOVO
// - lead_comunidadewpp    -> Lead_ComunidadeWPP       ✅ NOVO
//
// Smartico (/smartico/postback?ev=...)
// - registro              -> Registro_vupibet
// - ftd                   -> ftd_vupibet
// - qftd                  -> qftd_vupibet
// - deposito              -> deposito_vupibet
// =====================================================================

import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";
import { PrismaClient } from "@prisma/client";

// Prisma Client (singleton)
const prisma = new PrismaClient();

const app = express();

// IMPORTANT: atrás do Render/proxy, isso melhora req.ip e headers
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
  // ---------- TELEGRAM ----------
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

  // ---------- WHATSAPP ----------
  lead_whatsapp: {
    event_name: "Lead_Whatsapp",
    extra_custom_data: { origem: "whatsapp" },
  },
  lead_comunidadewpp: {
    event_name: "Lead_ComunidadeWPP",
    extra_custom_data: { origem: "whatsapp", etapa: "comunidade" },
  },
};

// =========================
// EVENTOS (Smartico -> Meta) - Vupibet
// =========================
const SMARTICO_EVENT_MAP = {
  registro: "Registro_vupibet",
  ftd: "ftd_vupibet",
  qftd: "qftd_vupibet",
  deposito: "deposito_vupibet",
};

// =========================
// EVENTOS (Novibet -> Meta)
// =========================
const NOVIBET_EVENT_MAP = {
  registro: "Registro_novibet",
  deposito: "deposito_novibet",
  ftd: "ftd_novibet",
};

// =========================
// Helpers
// =========================

/**
 * Valida se o valor é um UUID v4 válido (formato do nosso lead_id).
 * Usado para filtrar eventos que vieram do nosso funil vs outros experts.
 */
function isValidUUID(value) {
  if (!value || typeof value !== 'string') return false;
  // Regex para UUID v4: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  // onde y é 8, 9, a ou b
  const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidV4Regex.test(value);
}

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

function normalizeEmail(email) {
  if (!email) return "";
  return String(email).trim().toLowerCase();
}

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
// Persistência de Contexto (Prisma)
// =========================

/**
 * Salva o contexto do lead no banco de dados.
 * Usa upsert para atualizar se já existir (mesmo lead_id).
 * Falha silenciosa: se o banco falhar, loga e continua.
 */
async function saveLeadContext(data) {
  try {
    const { lead_id, afp, fbp, fbc, fbclid, utm_source, utm_medium, utm_campaign, utm_content, client_ip_address, client_user_agent } = data;

    if (!lead_id) {
      console.warn("⚠️ [saveLeadContext] lead_id ausente, não salvando.");
      return null;
    }

    const saved = await prisma.leadContext.upsert({
      where: { lead_id },
      update: {
        afp: afp || undefined,
        fbp: fbp || undefined,
        fbc: fbc || undefined,
        fbclid: fbclid || undefined,
        utm_source: utm_source || undefined,
        utm_medium: utm_medium || undefined,
        utm_campaign: utm_campaign || undefined,
        utm_content: utm_content || undefined,
        client_ip_address: client_ip_address || undefined,
        client_user_agent: client_user_agent || undefined,
      },
      create: {
        lead_id,
        afp: afp || undefined,
        fbp: fbp || undefined,
        fbc: fbc || undefined,
        fbclid: fbclid || undefined,
        utm_source: utm_source || undefined,
        utm_medium: utm_medium || undefined,
        utm_campaign: utm_campaign || undefined,
        utm_content: utm_content || undefined,
        client_ip_address: client_ip_address || undefined,
        client_user_agent: client_user_agent || undefined,
      },
    });

    console.log("✅ [saveLeadContext] Contexto salvo:", { lead_id, afp: saved.afp });
    return saved;
  } catch (err) {
    console.error("❌ [saveLeadContext] Erro ao salvar (continuando):", err?.message || err);
    return null;
  }
}

/**
 * Busca o contexto do lead pelo campo afp (click_id).
 * Retorna null se não encontrar ou se o banco falhar.
 */
async function getLeadContextByAfp(afp) {
  try {
    if (!afp) {
      console.warn("⚠️ [getLeadContextByAfp] afp ausente, não buscando.");
      return null;
    }

    const context = await prisma.leadContext.findFirst({
      where: { afp },
      orderBy: { createdAt: "desc" },
    });

    if (context) {
      console.log("✅ [getLeadContextByAfp] Contexto encontrado:", { afp, lead_id: context.lead_id });
    } else {
      console.log("ℹ️ [getLeadContextByAfp] Nenhum contexto encontrado para afp:", afp);
    }

    return context;
  } catch (err) {
    console.error("❌ [getLeadContextByAfp] Erro ao buscar (continuando):", err?.message || err);
    return null;
  }
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

  // Dedupe forte
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
        hint: "Use /sp/event?e=lead_whatsapp (ou outro), ou garanta que o body.title venha como lead_whatsapp.",
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

    // ✅ PERSISTÊNCIA: Salvar contexto do lead no banco (não bloqueia resposta)
    const vars = extracted.vars;
    const leadId = vars.lead_id || event.custom_data?.lead_id;
    const afpValue = vars.afp || vars.click_id || vars.afp1 || "";
    
    saveLeadContext({
      lead_id: leadId,
      afp: afpValue,
      fbp: vars.fbp,
      fbc: vars.fbc,
      fbclid: vars.fbclid,
      utm_source: vars.utm_source,
      utm_medium: vars.utm_medium,
      utm_campaign: vars.utm_campaign,
      utm_content: vars.utm_content,
      client_ip_address: getClientIp(req),
      client_user_agent: getUserAgent(req),
    }).catch((e) => console.error("❌ [saveLeadContext] Falha async:", e?.message));

    res.json({
      ok: true,
      key,
      event_name: event.event_name,
      event_id: event.event_id,
      context_saved: !!leadId,
      meta: metaResp,
    });
  } catch (err) {
    console.error("❌ /sp/event ERROR:", err?.message || err);
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// =========================
// Compatibilidade (funis antigos SendPulse)
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

// Rotas antigas (mantidas)
app.post("/sp/lead", (req, res) => compatHandler(req, res, "lead_telegram"));
app.post("/sp/register", (req, res) => compatHandler(req, res, "registro_casa"));
app.post("/sp/group", (req, res) => compatHandler(req, res, "grupo_telegram"));
app.post("/sp/bilhete", (req, res) => compatHandler(req, res, "bilhete_mgm"));

// =========================
// SMARTICO -> META (GET)
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

    // ✅ FILTRO DE QUALIDADE: Verificar se afp é UUID válido (nosso lead_id)
    const afpKey = cleanStr(q.afp) || cleanStr(q.click_id) || cleanStr(q.afp1) || "";
    const isOurLead = isValidUUID(afpKey);
    
    if (!isOurLead) {
      console.log("🚫 [FILTRO] afp não é UUID válido, ignorando evento:", afpKey || "(vazio)");
      console.log("📋 [FILTRO] Evento de outro expert, retornando OK sem enviar para Meta");
      return res.json({
        ok: true,
        filtered: true,
        reason: "afp_not_valid_uuid",
        afp: afpKey || null,
        hint: "Evento ignorado pois afp não é um UUID válido do nosso funil"
      });
    }
    
    console.log("✅ [FILTRO] afp é UUID válido, processando evento:", afpKey);
    
    // ✅ ENRIQUECIMENTO: Buscar contexto salvo pelo afp (click_id)
    const savedContext = await getLeadContextByAfp(afpKey);
    const hasContext = !!savedContext;
    
    console.log("📊 [MATCH]", hasContext ? "Contexto encontrado no banco" : "Usando dados da query (fallback)");

    const smarticoTime =
      parseInt(String(q.registration_date || q.first_deposit_date || ""), 10) || 0;
    const event_time = smarticoTime > 0 ? smarticoTime : Math.floor(Date.now() / 1000);

    const baseId = cleanStr(q.registration_id) || cleanStr(q.click_id) || crypto.randomUUID();
    const event_id = `${baseId}_${metaEventName}`;

    // ✅ PRIORIDADE: banco > query (fallback)
    const fbp = cleanStr(savedContext?.fbp) || cleanStr(q.fbp);
    const fbc = cleanStr(savedContext?.fbc) || cleanStr(q.fbc);
    const fbclid = cleanStr(savedContext?.fbclid) || cleanStr(q.fbclid);

    const extSeed = cleanStr(q.click_id) || cleanStr(q.afp) || cleanStr(q.customer_id) || "";
    const external_id = extSeed ? sha256(extSeed) : undefined;

    const value =
      parseValue(q.value) ??
      parseValue(q.first_deposit_amount) ??
      parseValue(q.deposit);

    const currency = cleanStr(q.currency) || cleanStr(q.payout_currency) || "BRL";

    // ✅ UTMs: prioridade banco > query
    const utm_source = cleanStr(savedContext?.utm_source) || cleanStr(q.utm_source);
    const utm_medium = cleanStr(savedContext?.utm_medium) || cleanStr(q.utm_medium);
    const utm_campaign = cleanStr(savedContext?.utm_campaign) || cleanStr(q.utm_campaign);
    const utm_content = cleanStr(savedContext?.utm_content) || cleanStr(q.utm_content);

    // ✅ IP/UA: prioridade banco (original do lead) > request atual
    const client_ip = cleanStr(savedContext?.client_ip_address) || cleanStr(getClientIp(req));
    const client_ua = cleanStr(savedContext?.client_user_agent) || cleanStr(getUserAgent(req));

    const event = {
      event_name: metaEventName,
      event_time,
      action_source: "website",
      event_id,

      // ✅ fbp/fbc em user_data para atribuição (enriquecido)
      user_data: {
        client_ip_address: client_ip,
        client_user_agent: client_ua,
        external_id,
        fbp,
        fbc,
      },

      custom_data: {
        origem: "smartico",
        context_matched: hasContext, // ✅ Flag para debug

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

        utm_source,
        utm_medium,
        utm_campaign,
        utm_content,

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

        fbclid,

        // ✅ valor convertido
        value: value ?? undefined,
        currency,
      },
    };

    console.log("🚀 Enviando Smartico -> Meta:", JSON.stringify(event, null, 2));
    const metaResp = await sendToMeta(event);
    console.log("✅ Meta OK:", JSON.stringify(metaResp));

    res.json({ 
      ok: true, 
      ev: evKey, 
      event_name: metaEventName, 
      event_id, 
      context_matched: hasContext,
      meta: metaResp 
    });
  } catch (err) {
    console.error("❌ /smartico/postback ERROR:", err?.message || err);
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// Start

// =========================
// NOVIBET -> META (POST)
// =========================

/**
 * Endpoint para Registro da Novibet
 * URL: POST /novibet/registro
 * Parâmetros esperados (body ou query):
 * - t1: click_id (nosso lead_id/afp)
 * - registration_id: ID do registro na Novibet
 * - country_code: código do país (opcional)
 * - brand: identificador da marca (opcional)
 * - currency: moeda (opcional, default BRL)
 * - timestamp: Unix timestamp (opcional)
 */
app.post("/novibet/registro", async (req, res) => {
  try {
    console.log("🔥 /novibet/registro RECEBIDO");
    console.log("🕒", new Date().toISOString());
    console.log("📦 Body:", JSON.stringify(req.body || {}));
    console.log("🔎 Query:", JSON.stringify(req.query || {}));

    // Novibet pode enviar via body ou query
    const data = { ...req.query, ...req.body };
    
    // t1 é o click_id da Novibet (nosso lead_id/afp)
    const afpKey = cleanStr(data.t1) || cleanStr(data.subid) || cleanStr(data.click_id) || "";
    
    // Validar se é UUID válido (nosso lead)
    if (!isValidUUID(afpKey)) {
      console.log("🚫 [NOVIBET] t1 não é UUID válido, ignorando:", afpKey || "(vazio)");
      return res.json({
        ok: true,
        filtered: true,
        reason: "t1_not_valid_uuid",
        t1: afpKey || null,
      });
    }

    console.log("✅ [NOVIBET] t1 é UUID válido, processando registro:", afpKey);

    // Buscar contexto salvo
    const savedContext = await getLeadContextByAfp(afpKey);
    const hasContext = !!savedContext;
    
    console.log("📊 [MATCH]", hasContext ? "Contexto encontrado no banco" : "Usando dados do postback (fallback)");

    const metaEventName = NOVIBET_EVENT_MAP.registro;
    const event_time = parseInt(data.timestamp) || Math.floor(Date.now() / 1000);
    const baseId = cleanStr(data.registration_id) || afpKey || crypto.randomUUID();
    const event_id = `${baseId}_${metaEventName}`;

    // Prioridade: banco > postback
    const fbp = cleanStr(savedContext?.fbp) || cleanStr(data.fbp);
    const fbc = cleanStr(savedContext?.fbc) || cleanStr(data.fbc);
    const fbclid = cleanStr(savedContext?.fbclid) || cleanStr(data.fbclid);
    const external_id = afpKey ? sha256(afpKey) : undefined;

    const utm_source = cleanStr(savedContext?.utm_source) || cleanStr(data.utm_source);
    const utm_medium = cleanStr(savedContext?.utm_medium) || cleanStr(data.utm_medium);
    const utm_campaign = cleanStr(savedContext?.utm_campaign) || cleanStr(data.utm_campaign);
    const utm_content = cleanStr(savedContext?.utm_content) || cleanStr(data.utm_content);

    const client_ip = cleanStr(savedContext?.client_ip_address) || cleanStr(getClientIp(req));
    const client_ua = cleanStr(savedContext?.client_user_agent) || cleanStr(getUserAgent(req));

    const event = {
      event_name: metaEventName,
      event_time,
      action_source: "website",
      event_id,
      user_data: {
        client_ip_address: client_ip,
        client_user_agent: client_ua,
        external_id,
        fbp,
        fbc,
      },
      custom_data: {
        origem: "novibet",
        context_matched: hasContext,
        registration_id: cleanStr(data.registration_id),
        country_code: cleanStr(data.country_code),
        brand: cleanStr(data.brand),
        currency: cleanStr(data.currency) || "BRL",
        t1: afpKey,
        utm_source,
        utm_medium,
        utm_campaign,
        utm_content,
        fbclid,
      },
    };

    console.log("🚀 Enviando Novibet Registro -> Meta:", JSON.stringify(event, null, 2));
    const metaResp = await sendToMeta(event);
    console.log("✅ Meta OK:", JSON.stringify(metaResp));

    res.json({
      ok: true,
      event_type: "registro",
      event_name: metaEventName,
      event_id,
      context_matched: hasContext,
      meta: metaResp,
    });
  } catch (err) {
    console.error("❌ /novibet/registro ERROR:", err?.message || err);
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

/**
 * Endpoint para Depósito da Novibet
 * URL: POST /novibet/deposito
 * Parâmetros esperados (body ou query):
 * - t1: click_id (nosso lead_id/afp)
 * - registration_id: ID do registro na Novibet
 * - value: valor do depósito
 * - currency: moeda (opcional, default BRL)
 * - country_code: código do país (opcional)
 * - brand: identificador da marca (opcional)
 * - timestamp: Unix timestamp (opcional)
 * - is_ftd: se é primeiro depósito (opcional, para diferenciar FTD de depósito normal)
 */
app.post("/novibet/deposito", async (req, res) => {
  try {
    console.log("🔥 /novibet/deposito RECEBIDO");
    console.log("🕒", new Date().toISOString());
    console.log("📦 Body:", JSON.stringify(req.body || {}));
    console.log("🔎 Query:", JSON.stringify(req.query || {}));

    const data = { ...req.query, ...req.body };
    
    const afpKey = cleanStr(data.t1) || cleanStr(data.subid) || cleanStr(data.click_id) || "";
    
    if (!isValidUUID(afpKey)) {
      console.log("🚫 [NOVIBET] t1 não é UUID válido, ignorando:", afpKey || "(vazio)");
      return res.json({
        ok: true,
        filtered: true,
        reason: "t1_not_valid_uuid",
        t1: afpKey || null,
      });
    }

    console.log("✅ [NOVIBET] t1 é UUID válido, processando depósito:", afpKey);

    const savedContext = await getLeadContextByAfp(afpKey);
    const hasContext = !!savedContext;
    
    console.log("📊 [MATCH]", hasContext ? "Contexto encontrado no banco" : "Usando dados do postback (fallback)");

    // Determinar se é FTD ou depósito normal
    const isFtd = data.is_ftd === "true" || data.is_ftd === true || data.status === "ftd";
    const metaEventName = isFtd ? NOVIBET_EVENT_MAP.ftd : NOVIBET_EVENT_MAP.deposito;
    
    const event_time = parseInt(data.timestamp) || Math.floor(Date.now() / 1000);
    const baseId = cleanStr(data.registration_id) || afpKey || crypto.randomUUID();
    const event_id = `${baseId}_${metaEventName}_${event_time}`;

    const fbp = cleanStr(savedContext?.fbp) || cleanStr(data.fbp);
    const fbc = cleanStr(savedContext?.fbc) || cleanStr(data.fbc);
    const fbclid = cleanStr(savedContext?.fbclid) || cleanStr(data.fbclid);
    const external_id = afpKey ? sha256(afpKey) : undefined;

    const utm_source = cleanStr(savedContext?.utm_source) || cleanStr(data.utm_source);
    const utm_medium = cleanStr(savedContext?.utm_medium) || cleanStr(data.utm_medium);
    const utm_campaign = cleanStr(savedContext?.utm_campaign) || cleanStr(data.utm_campaign);
    const utm_content = cleanStr(savedContext?.utm_content) || cleanStr(data.utm_content);

    const client_ip = cleanStr(savedContext?.client_ip_address) || cleanStr(getClientIp(req));
    const client_ua = cleanStr(savedContext?.client_user_agent) || cleanStr(getUserAgent(req));

    const value = parseValue(data.value) ?? parseValue(data.amount) ?? parseValue(data.deposit_amount);
    const currency = cleanStr(data.currency) || "BRL";

    const event = {
      event_name: metaEventName,
      event_time,
      action_source: "website",
      event_id,
      user_data: {
        client_ip_address: client_ip,
        client_user_agent: client_ua,
        external_id,
        fbp,
        fbc,
      },
      custom_data: {
        origem: "novibet",
        context_matched: hasContext,
        is_ftd: isFtd,
        registration_id: cleanStr(data.registration_id),
        country_code: cleanStr(data.country_code),
        brand: cleanStr(data.brand),
        value: value ?? undefined,
        currency,
        t1: afpKey,
        utm_source,
        utm_medium,
        utm_campaign,
        utm_content,
        fbclid,
      },
    };

    console.log("🚀 Enviando Novibet Depósito -> Meta:", JSON.stringify(event, null, 2));
    const metaResp = await sendToMeta(event);
    console.log("✅ Meta OK:", JSON.stringify(metaResp));

    res.json({
      ok: true,
      event_type: isFtd ? "ftd" : "deposito",
      event_name: metaEventName,
      event_id,
      context_matched: hasContext,
      value,
      currency,
      meta: metaResp,
    });
  } catch (err) {
    console.error("❌ /novibet/deposito ERROR:", err?.message || err);
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`🚀 sp-meta-capi listening on port ${port}`);
});
