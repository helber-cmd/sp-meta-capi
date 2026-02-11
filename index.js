
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
// 9) ✅ FILTRO DE QUALIDADE (Smartico):
//    - Apenas eventos com afp UUID válido são enviados para Meta
// 10) ✅ MULTI-PIXEL:
//    - Suporte a 5 slots + 1 pixel mestre
//    - Pixel mestre recebe 100% dos eventos
//    - Cada slot pode ser associado a uma casa específica
//    - Esportivabet: Slot 3 e Slot 4 (2 pixels isolados)
//
// ✅ EVENTOS ATIVOS (TOPO — para referência rápida)
// SendPulse (/sp/event?e=...&slot=X)
// - lead_telegram         -> Lead_Telegram
// - registro_casa         -> Registro_Casa
// - grupo_telegram        -> Grupo_Telegram
// - bilhete_mgm           -> Bilhete_MGM           (slot=5)
// - bilhete_novibet       -> Bilhete_Novibet       (slot=2)
// - bilhete_novibet       -> Bilhete_Novibet       (slot=2)
// - bilhete_esportivabet  -> Bilhete_Esportivabet  (slot=3)
// - bilhete_esportivabet2 -> Bilhete_Esportivabet  (slot=4)
// - lead_whatsapp         -> Lead_Whatsapp
// - lead_comunidadewpp    -> Lead_ComunidadeWPP
//
// Smartico (/smartico/postback?ev=...) -> SLOT1 (Vupibet)
// - registro              -> Registro_vupibet
// - ftd                   -> ftd_vupibet
// - qftd                  -> qftd_vupibet
// - deposito              -> deposito_vupibet
//
// Novibet (/novibet/registro, /novibet/deposito) -> SLOT2 (Novibet)
// - registro              -> Registro_novibet
// - deposito              -> deposito_novibet
// - ftd                   -> ftd_novibet
//
// Esportivabet (/esportivabet/postback?ev=...&slot=3|4) -> SLOT3 e SLOT4
// - registro              -> Registro_esportivabet
// - ftd                   -> ftd_esportivabet
// - qftd                  -> qftd_esportivabet
// - deposito              -> deposito_esportivabet
//
// ✅ CONFIGURAÇÃO DE PIXELS (Render Environment Variables)
// META_PIXEL_MASTER / META_TOKEN_MASTER  -> Recebe 100% dos eventos
// META_PIXEL_SLOT1 / META_TOKEN_SLOT1    -> Vupibet
// META_PIXEL_SLOT2 / META_TOKEN_SLOT2    -> Novibet
// META_PIXEL_SLOT3 / META_TOKEN_SLOT3    -> Esportivabet Pixel 1
// META_PIXEL_SLOT4 / META_TOKEN_SLOT4    -> Esportivabet Pixel 2
// META_PIXEL_SLOT5 / META_TOKEN_SLOT5    -> MGM (stand-by)
// =====================================================================

import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";
import { PrismaClient } from "@prisma/client";

// Prisma Client (singleton)
const prisma = new PrismaClient();

const app = express();
// --- FUNÇÃO DO PLACAR (Adicione isso no topo) ---
async function imprimirPlacar() {
  try {
    // Pega o dia de hoje (UTC 00:00)
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const regs = await prisma.eventLog.count({
      where: { type: "registro", provider: "novibet", createdAt: { gte: hoje } }
    });

    const deps = await prisma.eventLog.count({
      where: { type: "deposito", provider: "novibet", createdAt: { gte: hoje } }
    });

    console.log(`\n📊 [PLACAR HOJE] Registros: ${regs} | Depósitos: ${deps}\n`);
  } catch (e) {
    console.log("Erro no placar:", e.message);
  }
}

// IMPORTANT: atrás do Render/proxy, isso melhora req.ip e headers
app.set("trust proxy", true);

app.use(express.json({ limit: "2mb" }));

// =========================
// CONFIGURAÇÃO MULTI-PIXEL
// =========================

const META_API_VERSION = process.env.META_API_VERSION || "v20.0";
const DEFAULT_ACTION_SOURCE = process.env.META_ACTION_SOURCE || "chat";

// Pixel Mestre (recebe 100% dos eventos)
const PIXEL_MASTER = {
  id: process.env.META_PIXEL_MASTER || process.env.META_PIXEL_ID, // fallback para config antiga
  token: process.env.META_TOKEN_MASTER || process.env.META_ACCESS_TOKEN,
};

// Slots de Pixels (1-5)
const PIXEL_SLOTS = {
  1: { // Vupibet
    id: process.env.META_PIXEL_SLOT1,
    token: process.env.META_TOKEN_SLOT1,
    name: "Vupibet",
  },
  2: { // Novibet
    id: process.env.META_PIXEL_SLOT2,
    token: process.env.META_TOKEN_SLOT2,
    name: "Novibet",
  },
  3: { // Esportivabet Pixel 1
    id: process.env.META_PIXEL_SLOT3,
    token: process.env.META_TOKEN_SLOT3,
    name: "Esportivabet_1",
  },
  4: { // Esportivabet Pixel 2
    id: process.env.META_PIXEL_SLOT4,
    token: process.env.META_TOKEN_SLOT4,
    name: "Esportivabet_2",
  },
  5: { // MGM (stand-by)
    id: process.env.META_PIXEL_SLOT5,
    token: process.env.META_TOKEN_SLOT5,
    name: "MGM",
  },
};

// Mapeamento de eventos SendPulse -> Slot padrão
const EVENT_SLOT_MAP = {
  bilhete_vupibet: 1,
  bilhete_novibet: 2,
  bilhete_esportivabet: 3, // Esportivabet Pixel 1 (padrão)
  bilhete_esportivabet2: 4, // Esportivabet Pixel 2
  bilhete_mgm: 5,
};

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
  bilhete_esportivabet: {
    event_name: "Bilhete_Esportivabet",
    extra_custom_data: { origem: "telegram", produto: "bilhete_esportivabet", pixel: "1" },
  },
  bilhete_esportivabet2: {
    event_name: "Bilhete_Esportivabet",
    extra_custom_data: { origem: "telegram", produto: "bilhete_esportivabet", pixel: "2" },
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
// EVENTOS (Smartico -> Meta) - Vupibet (SLOT1)
// =========================
const SMARTICO_EVENT_MAP = {
  registro: "Registro_vupibet",
  ftd: "ftd_vupibet",
  qftd: "qftd_vupibet",
  deposito: "deposito_vupibet",
};

// =========================
// EVENTOS (Novibet -> Meta) - SLOT2
// =========================
const NOVIBET_EVENT_MAP = {
  registro: "Registro_novibet",
  deposito: "deposito_novibet",
  ftd: "ftd_novibet",
};

// =========================
// EVENTOS (Esportivabet -> Meta) - SLOT3 e SLOT4
// =========================
const ESPORTIVABET_EVENT_MAP = {
  registro: "Registro_esportivabet",
  ftd: "ftd_esportivabet",
  qftd: "qftd_esportivabet",
  deposito: "deposito_esportivabet",
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

// =========================
// MULTI-PIXEL: Envio para Meta
// =========================

/**
 * Envia evento para um pixel específico.
 * @param {Object} event - Evento a ser enviado
 * @param {string} pixelId - ID do pixel
 * @param {string} accessToken - Token de acesso
 * @returns {Object} Resposta da API do Meta
 */
async function sendToPixel(event, pixelId, accessToken) {
  if (!pixelId || !accessToken) {
    return { skipped: true, reason: "pixel_not_configured" };
  }

  const url = `https://graph.facebook.com/${META_API_VERSION}/${pixelId}/events?access_token=${accessToken}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: [event] }),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json));
  return json;
}

/**
 * Envia evento para múltiplos pixels (mestre + slot específico).
 * @param {Object} event - Evento a ser enviado
 * @param {number|null} slotNumber - Número do slot (1-5) ou null para só mestre
 * @returns {Object} Resultado do envio para cada pixel
 */
async function sendToMeta(event, slotNumber = null) {
  const results = {
    master: null,
    slot: null,
    slotNumber: slotNumber,
  };

  // 1. Enviar para Pixel Mestre (sempre, se configurado)
  if (PIXEL_MASTER.id && PIXEL_MASTER.token) {
    try {
      console.log(`📤 [MASTER] Enviando para pixel mestre...`);
      results.master = await sendToPixel(event, PIXEL_MASTER.id, PIXEL_MASTER.token);
      console.log(`✅ [MASTER] OK:`, JSON.stringify(results.master));
    } catch (err) {
      console.error(`❌ [MASTER] Erro:`, err?.message || err);
      results.master = { error: String(err?.message || err) };
    }
  } else {
    console.warn(`⚠️ [MASTER] Pixel mestre não configurado`);
    results.master = { skipped: true, reason: "not_configured" };
  }

  // 2. Enviar para Slot específico (se informado e configurado)
  if (slotNumber && PIXEL_SLOTS[slotNumber]) {
    const slot = PIXEL_SLOTS[slotNumber];
    if (slot.id && slot.token) {
      try {
        console.log(`📤 [SLOT${slotNumber}] Enviando para ${slot.name}...`);
        results.slot = await sendToPixel(event, slot.id, slot.token);
        results.slotName = slot.name;
        console.log(`✅ [SLOT${slotNumber}] OK:`, JSON.stringify(results.slot));
      } catch (err) {
        console.error(`❌ [SLOT${slotNumber}] Erro:`, err?.message || err);
        results.slot = { error: String(err?.message || err) };
      }
    } else {
      console.warn(`⚠️ [SLOT${slotNumber}] ${slot.name} não configurado`);
      results.slot = { skipped: true, reason: "not_configured", name: slot.name };
    }
  }

  return results;
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

    console.log(`✅ [saveLeadContext] Contexto salvo:`, { lead_id: saved.lead_id, afp: saved.afp });
    return saved;
  } catch (err) {
    console.error(`❌ [saveLeadContext] Erro ao salvar:`, err?.message || err);
    return null;
  }
}

/**
 * Busca o contexto do lead pelo afp (click_id).
 * Retorna null se não encontrar ou se houver erro.
 */
async function getLeadContextByAfp(afp) {
  try {
    if (!afp) {
      console.warn("⚠️ [getLeadContextByAfp] afp ausente, não buscando.");
      return null;
    }

    const context = await prisma.leadContext.findFirst({
      where: { afp },
    });

    if (context) {
      console.log(`✅ [getLeadContextByAfp] Contexto encontrado:`, { afp: context.afp, lead_id: context.lead_id });
    } else {
      console.log(`⚠️ [getLeadContextByAfp] Contexto não encontrado para afp:`, afp);
    }

    return context;
  } catch (err) {
    console.error(`❌ [getLeadContextByAfp] Erro ao buscar:`, err?.message || err);
    return null;
  }
}

// =========================
// Builders
// =========================

function buildUserDataFromSendPulse({ vars, telegram_id, req }) {
  const user_data = {
    client_ip_address: getClientIp(req),
    client_user_agent: getUserAgent(req),
  };

  // external_id: hash do telegram_id (identificador forte)
  if (telegram_id) {
    user_data.external_id = sha256(String(telegram_id));
  }

  // fbp e fbc em user_data para atribuição
  const fbp = cleanStr(vars.fbp);
  const fbc = cleanStr(vars.fbc);
  if (fbp) user_data.fbp = fbp;
  if (fbc) user_data.fbc = fbc;

  // email e telefone (se existirem)
  const rawEmail = vars.email || vars.em;
  const rawPhone = vars.phone || vars.ph || vars.telefone;

  const em = normalizeEmail(rawEmail);
  const ph = normalizePhone(rawPhone);

  if (em) user_data.em = sha256(em);
  if (ph) user_data.ph = sha256(ph);

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

// =========================
// ROTA: /status (Health Check + Pixel Status)
// =========================
app.get("/status", (req, res) => {
  const pixelStatus = {
    master: {
      configured: !!(PIXEL_MASTER.id && PIXEL_MASTER.token),
      pixelId: PIXEL_MASTER.id ? `${PIXEL_MASTER.id.slice(0, 4)}...${PIXEL_MASTER.id.slice(-4)}` : null,
    },
    slots: {},
  };

  for (const [num, slot] of Object.entries(PIXEL_SLOTS)) {
    pixelStatus.slots[`slot${num}`] = {
      name: slot.name,
      configured: !!(slot.id && slot.token),
      pixelId: slot.id ? `${slot.id.slice(0, 4)}...${slot.id.slice(-4)}` : null,
    };
  }

  res.json({
    ok: true,
    service: "sp-meta-capi",
    version: "2.0.0",
    timestamp: new Date().toISOString(),
    pixels: pixelStatus,
    endpoints: {
      sendpulse: "POST /sp/event?e=EVENTO&slot=SLOT",
      smartico: "GET /smartico/postback?ev=EVENTO",
      esportivabet: "GET /esportivabet/postback?ev=EVENTO&slot=3|4",
      novibet_registro: "POST /novibet/registro",
      novibet_deposito: "POST /novibet/deposito",
    },
  });
});

// =========================
// ROTA: /health (Simple Health Check)
// =========================
app.get("/health", (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

// =========================
// SENDPULSE -> META (POST)
// =========================
app.post("/sp/event", async (req, res) => {
  try {
    console.log("🔥 /sp/event WEBHOOK RECEBIDO");
    console.log("🕒", new Date().toISOString());
    console.log("🔎 Query:", JSON.stringify(req.query || {}));

    const eventKey = safeString(req.query.e || req.query.event || "").toLowerCase().trim();
    const slotParam = parseInt(req.query.slot) || null;

    // Determinar slot: parâmetro > mapeamento automático > null
    const slotNumber = slotParam || EVENT_SLOT_MAP[eventKey] || null;

    const cfg = EVENT_MAP[eventKey];
    if (!cfg) {
      const titleFallback = safeString(req.body?.title || req.body?.[0]?.title || "").toLowerCase().trim();
      const fallbackCfg = EVENT_MAP[titleFallback];
      if (!fallbackCfg) {
        console.warn("⚠️ Evento não mapeado:", eventKey, "| title:", titleFallback);
        return res.status(400).json({
          ok: false,
          error: "EVENT_NOT_MAPPED",
          received: eventKey,
          title: titleFallback,
          known: Object.keys(EVENT_MAP),
        });
      }
    }

    const finalCfg = cfg || EVENT_MAP[safeString(req.body?.title || req.body?.[0]?.title || "").toLowerCase().trim()];
    const { vars, telegram_id } = extractVarsAndTelegramId(req.body);

    const event = buildSendPulseEvent({ cfg: finalCfg, vars, telegram_id, req });

    console.log(`🚀 Enviando SendPulse -> Meta (slot=${slotNumber || 'master'}):`, JSON.stringify(event, null, 2));

    const metaResp = await sendToMeta(event, slotNumber);
    console.log("✅ Meta Response:", JSON.stringify(metaResp));

    // Salvar contexto do lead no banco (async, não bloqueia resposta)
    const leadId = vars.lead_id || event.custom_data?.lead_id;
    const contextData = {
      lead_id: leadId,
      afp: leadId, // afp = lead_id para SendPulse
      fbp: cleanStr(vars.fbp),
      fbc: cleanStr(vars.fbc),
      fbclid: cleanStr(vars.fbclid),
      utm_source: cleanStr(vars.utm_source),
      utm_medium: cleanStr(vars.utm_medium),
      utm_campaign: cleanStr(vars.utm_campaign),
      utm_content: cleanStr(vars.utm_content),
      client_ip_address: getClientIp(req),
      client_user_agent: getUserAgent(req),
    };

    saveLeadContext(contextData).catch(err => {
      console.error("❌ [saveLeadContext] Erro async:", err?.message || err);
    });

    res.json({
      ok: true,
      event_name: event.event_name,
      event_id: event.event_id,
      slot: slotNumber,
      context_saved: true,
      meta: metaResp,
    });
  } catch (err) {
    console.error("❌ /sp/event ERROR:", err?.message || err);
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// =========================
// ROTAS ANTIGAS (compatibilidade)
// =========================
async function compatHandler(req, res, key) {
  try {
    const cfg = EVENT_MAP[key];
    if (!cfg) {
      return res.status(400).json({ ok: false, error: "EVENT_NOT_MAPPED", key });
    }

    const slotNumber = EVENT_SLOT_MAP[key] || null;
    const { vars, telegram_id } = extractVarsAndTelegramId(req.body);
    const event = buildSendPulseEvent({ cfg, vars, telegram_id, req });

    console.log(`🚀 Enviando /sp/${key} -> Meta (slot=${slotNumber || 'master'}):`, JSON.stringify(event, null, 2));

    const metaResp = await sendToMeta(event, slotNumber);
    console.log("✅ Meta OK:", JSON.stringify(metaResp));

    res.json({ ok: true, event_name: event.event_name, event_id: event.event_id, slot: slotNumber, meta: metaResp });
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
// SMARTICO -> META (GET) - SLOT1 (Vupibet)
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
        afp9: cleanStr(q.afp9),
        fbclid,
        // ✅ valor convertido
        value: value ?? undefined,
        currency,
      },
    };

    console.log("🚀 Enviando Smartico -> Meta (SLOT1 - Vupibet):", JSON.stringify(event, null, 2));

    // Smartico sempre vai para SLOT1 (Vupibet)
    const metaResp = await sendToMeta(event, 1);
    console.log("✅ Meta OK:", JSON.stringify(metaResp));

    res.json({
      ok: true,
      ev: evKey,
      event_name: metaEventName,
      event_id,
      slot: 1,
      context_matched: hasContext,
      meta: metaResp
    });
  } catch (err) {
    console.error("❌ /smartico/postback ERROR:", err?.message || err);
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// =========================
// NOVIBET -> META (POST) - SLOT2
// =========================

/**
 * Endpoint para Registro da Novibet
 * URL: POST /novibet/registro
 */
app.post("/novibet/registro", async (req, res) => {
  try {
    console.log("🔥 /novibet/registro RECEBIDO");
    console.log("🕒", new Date().toISOString());
    console.log("📦 Body:", JSON.stringify(req.body || {}));
    console.log("🔎 Query:", JSON.stringify(req.query || {}));

    // Novibet pode enviar via body ou query
    const data = { ...req.query, ...req.body };

    // ✅ Suportar: tracking_tag (oficial), t1 (legado), s2 (backup)
    // PRIORIDADE ALTERADA: s2 (Lead/Contact ID) vem antes da tracking_tag
    const afpKey = cleanStr(data.s2) || cleanStr(data.tracking_tag) || cleanStr(data.t1) || cleanStr(data.subid) || cleanStr(data.click_id) || "";

   // === NOVA VALIDAÇÃO (ACEITA RAVENTRACK) ===
    // Aceita letras, números, traço e underline (ex: 2007430_8400875089)
    const isIdValido = afpKey && afpKey.length > 2 && /^[a-zA-Z0-9_-]+$/.test(afpKey);

    if (!isIdValido) {
      console.log("🚫 [NOVIBET] ID inválido ou vazio, ignorando:", afpKey || "(vazio)");
      return res.json({
        ok: true,
        filtered: true,
        reason: "id_invalid_format",
        t1: afpKey || null,
      });
    }
    // ==========================================

    console.log("✅ [NOVIBET] t1 é UUID válido, processando registro:", afpKey);

    // Buscar contexto salvo
    const savedContext = await getLeadContextByAfp(afpKey);
    const hasContext = !!savedContext;

    console.log("📊 [MATCH]", hasContext ? "Contexto encontrado no banco" : "Usando dados do postback (fallback)");

    const metaEventName = NOVIBET_EVENT_MAP.registro;
    
    // ✅ Suportar ambos: action_date (oficial Y-m-d) e timestamp (legado Unix)
    let event_time;
    if (data.action_date) {
      // Converter Y-m-d para timestamp Unix
      event_time = Math.floor(new Date(data.action_date).getTime() / 1000);
    } else {
      event_time = parseInt(data.timestamp) || Math.floor(Date.now() / 1000);
    }
    
    const baseId = cleanStr(data.player_id) || cleanStr(data.registration_id) || afpKey || crypto.randomUUID();
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
        vendor_id: cleanStr(data.vendor_id),
        action: cleanStr(data.action) || "registration",
        player_id: cleanStr(data.player_id),
        registration_id: cleanStr(data.registration_id),
        country_code: cleanStr(data.country_code),
        brand: cleanStr(data.brand),
        currency: cleanStr(data.currency) || "BRL",
        promo_code: cleanStr(data.promo_code),
        tracking_tag: afpKey,
        // Parâmetros customizados (c1-c5)
        c1: cleanStr(data.c1),
        c2: cleanStr(data.c2),
        c3: cleanStr(data.c3),
        c4: cleanStr(data.c4),
        c5: cleanStr(data.c5),
        // Sub source tagging (s1-s3) - Analytics
        s1: cleanStr(data.s1),
        s2: cleanStr(data.s2),
        s3: cleanStr(data.s3),
        // Transaction tagging (t2-t3) - Pixels/Exports (t1 é tracking_tag)
        t2: cleanStr(data.t2),
        t3: cleanStr(data.t3),
        // UTMs
        utm_source,
        utm_medium,
        utm_campaign,
        utm_content,
        fbclid,
      },
    };

    console.log("🚀 Enviando Novibet Registro -> Meta (SLOT2):", JSON.stringify(event, null, 2));

    // Novibet sempre vai para SLOT2
    const metaResp = await sendToMeta(event, 2);
    console.log("✅ Meta OK:", JSON.stringify(metaResp));
    // COLE ISSO AQUI 👇
    await prisma.eventLog.create({ data: { type: "registro", provider: "novibet" } });
    placar();

    res.json({
      ok: true,
      event_type: "registro",
      event_name: metaEventName,
      event_id,
      slot: 2,
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
 */
app.post("/novibet/deposito", async (req, res) => {
  try {
    console.log("🔥 /novibet/deposito RECEBIDO");
    console.log("🕒", new Date().toISOString());
    console.log("📦 Body:", JSON.stringify(req.body || {}));
    console.log("🔎 Query:", JSON.stringify(req.query || {}));

    const data = { ...req.query, ...req.body };

    // ✅ Suportar: tracking_tag (oficial), t1 (legado), s2 (backup)
    // PRIORIDADE ALTERADA: s2 (Lead/Contact ID) vem antes da tracking_tag
    const afpKey = cleanStr(data.s2) || cleanStr(data.tracking_tag) || cleanStr(data.t1) || cleanStr(data.subid) || cleanStr(data.click_id) || "";

   // === NOVA VALIDAÇÃO (ACEITA RAVENTRACK) ===
    const isIdValido = afpKey && afpKey.length > 2 && /^[a-zA-Z0-9_-]+$/.test(afpKey);

    if (!isIdValido) {
      console.log("🚫 [NOVIBET] ID inválido ou vazio, ignorando:", afpKey || "(vazio)");
      return res.json({
        ok: true,
        filtered: true,
        reason: "id_invalid_format",
        t1: afpKey || null,
      });
    }
    // ==========================================

    console.log("✅ [NOVIBET] t1 é UUID válido, processando depósito:", afpKey);

    const savedContext = await getLeadContextByAfp(afpKey);
    const hasContext = !!savedContext;

    console.log("📊 [MATCH]", hasContext ? "Contexto encontrado no banco" : "Usando dados do postback (fallback)");

    // Determinar se é FTD ou depósito normal
    const isFtd = data.is_ftd === "true" || data.is_ftd === true || data.status === "ftd";
    const metaEventName = isFtd ? NOVIBET_EVENT_MAP.ftd : NOVIBET_EVENT_MAP.deposito;

    // ✅ Suportar ambos: action_date (oficial Y-m-d) e timestamp (legado Unix)
    let event_time;
    if (data.action_date) {
      event_time = Math.floor(new Date(data.action_date).getTime() / 1000);
    } else {
      event_time = parseInt(data.timestamp) || Math.floor(Date.now() / 1000);
    }
    
    const baseId = cleanStr(data.player_id) || cleanStr(data.registration_id) || afpKey || crypto.randomUUID();
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
        vendor_id: cleanStr(data.vendor_id),
        action: cleanStr(data.action) || "deposit",
        player_id: cleanStr(data.player_id),
        registration_id: cleanStr(data.registration_id),
        country_code: cleanStr(data.country_code),
        brand: cleanStr(data.brand),
        promo_code: cleanStr(data.promo_code),
        value: value ?? undefined,
        currency,
        tracking_tag: afpKey,
        // Parâmetros customizados (c1-c5)
        c1: cleanStr(data.c1),
        c2: cleanStr(data.c2),
        c3: cleanStr(data.c3),
        c4: cleanStr(data.c4),
        c5: cleanStr(data.c5),
        // Sub source tagging (s1-s3) - Analytics
        s1: cleanStr(data.s1),
        s2: cleanStr(data.s2),
        s3: cleanStr(data.s3),
        // Transaction tagging (t2-t3) - Pixels/Exports (t1 é tracking_tag)
        t2: cleanStr(data.t2),
        t3: cleanStr(data.t3),
        // UTMs
        utm_source,
        utm_medium,
        utm_campaign,
        utm_content,
        fbclid,
      },
    };

    console.log("🚀 Enviando Novibet Depósito -> Meta (SLOT2):", JSON.stringify(event, null, 2));

    // Novibet sempre vai para SLOT2
    const metaResp = await sendToMeta(event, 2);
    console.log("✅ Meta OK:", JSON.stringify(metaResp));
    // COLE ISSO AQUI 👇
    await prisma.eventLog.create({ data: { type: "deposito", provider: "novibet" } });
    placar();

    res.json({
      ok: true,
      event_type: isFtd ? "ftd" : "deposito",
      event_name: metaEventName,
      event_id,
      slot: 2,
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

// =========================
// ESPORTIVABET -> META (GET) - SLOT3 e SLOT4
// =========================

/**
 * Endpoint para postbacks da Smartico (Esportivabet)
 * URL: GET /esportivabet/postback?ev=EVENTO&slot=SLOT&...
 * 
 * Suporta 2 slots:
 * - slot=3 -> Esportivabet Pixel 1
 * - slot=4 -> Esportivabet Pixel 2
 * - sem slot -> padrão Slot 3
 */
app.get("/esportivabet/postback", async (req, res) => {
  try {
    console.log("🔥 /esportivabet/postback RECEBIDO");
    console.log("🕒", new Date().toISOString());
    console.log("🔎 Query:", JSON.stringify(req.query || {}));

    const q = req.query;
    const evKey = safeString(q.ev).toLowerCase().trim();
    const slotParam = parseInt(q.slot) || 3; // Padrão: Slot 3

    // Validar slot (apenas 3 ou 4)
    const slotNumber = [3, 4].includes(slotParam) ? slotParam : 3;

    const metaEventName = ESPORTIVABET_EVENT_MAP[evKey];
    if (!metaEventName) {
      console.warn("⚠️ Evento Esportivabet não mapeado:", evKey);
      return res.status(400).json({
        ok: false,
        error: "EVENT_NOT_MAPPED",
        received: evKey,
        known: Object.keys(ESPORTIVABET_EVENT_MAP),
      });
    }

    // ✅ FILTRO DE QUALIDADE: apenas UUID v4 válido
    const afpKey = cleanStr(q.afp);
    if (!isValidUUID(afpKey)) {
      console.log("🚫 [ESPORTIVABET] afp não é UUID válido, ignorando:", afpKey || "(vazio)");
      return res.json({
        ok: true,
        filtered: true,
        reason: "afp_not_valid_uuid",
        afp: afpKey || null,
      });
    }

    console.log("✅ [ESPORTIVABET] afp é UUID válido, processando:", afpKey);

    // Buscar contexto salvo
    const savedContext = await getLeadContextByAfp(afpKey);
    const hasContext = !!savedContext;

    console.log("📊 [MATCH]", hasContext ? "Contexto encontrado no banco" : "Usando dados do postback (fallback)");

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
      user_data: {
        client_ip_address: client_ip,
        client_user_agent: client_ua,
        external_id,
        fbp,
        fbc,
      },
      custom_data: {
        origem: "smartico",
        casa: "esportivabet",
        pixel_slot: slotNumber,
        context_matched: hasContext,
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
        afp9: cleanStr(q.afp9),
        fbclid,
        value: value ?? undefined,
        currency,
      },
    };

    console.log(`🚀 Enviando Esportivabet -> Meta (SLOT${slotNumber}):`, JSON.stringify(event, null, 2));

    const metaResp = await sendToMeta(event, slotNumber);
    console.log("✅ Meta OK:", JSON.stringify(metaResp));

    res.json({
      ok: true,
      ev: evKey,
      event_name: metaEventName,
      event_id,
      slot: slotNumber,
      context_matched: hasContext,
      meta: metaResp
    });
  } catch (err) {
    console.error("❌ /esportivabet/postback ERROR:", err?.message || err);
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// =========================
// Start
// =========================
const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`🚀 sp-meta-capi v2.0.0 listening on port ${port}`);
  console.log(`📊 Pixels configurados:`);
  console.log(`   - Master: ${PIXEL_MASTER.id ? '✅' : '❌'}`);
  for (const [num, slot] of Object.entries(PIXEL_SLOTS)) {
    console.log(`   - Slot${num} (${slot.name}): ${slot.id ? '✅' : '❌'}`);
  }
});
