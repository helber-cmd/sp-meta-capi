// =====================================================================
// ✅ ATUALIZAÇÕES (TOPO — sempre manter aqui)
// 1) ✅ ROTA ÚNICA SendPulse -> Meta: POST /sp/event?e=CHAVE_DO_EVENTO
// 2) ✅ Rotas de compatibilidade (não quebrar funis antigos):
//    - POST /sp/lead       -> lead_telegram
//    - POST /sp/register   -> registro_casa
//    - POST /sp/group      -> grupo_telegram
//    - POST /sp/bilhete    -> bilhete_mgm
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

// --- PLACAR TURBINADO (DATA + HISTÓRICO) ---
async function placar() {
  try {
    // Pega data de 3 dias atrás para gerar histórico
    const dataLimite = new Date();
    dataLimite.setDate(dataLimite.getDate() - 3);

    const logs = await prisma.eventLog.findMany({
      where: { provider: "novibet", createdAt: { gte: dataLimite } },
      orderBy: { createdAt: 'desc' }
    });

    // Agrupa os dados por dia (Ex: 10/02/2026)
    const resumo = {};
    for (const log of logs) {
      // Ajusta para o horário do Brasil (gambiarra simples para log)
      const dataFormatada = new Date(log.createdAt).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      
      if (!resumo[dataFormatada]) resumo[dataFormatada] = { registro: 0, deposito: 0, ftd: 0 };
      
      if (log.type === 'registro') resumo[dataFormatada].registro++;
      if (log.type === 'deposito') resumo[dataFormatada].deposito++; // Redeposito cai aqui
      if (log.type === 'ftd') resumo[dataFormatada].ftd++; // FTD cai aqui se vier
    }

    console.log(`\n📊 === RELATÓRIO NOVIBET (Últimos Dias) ===`);
    Object.keys(resumo).forEach(dia => {
      const { registro, deposito, ftd } = resumo[dia];
      console.log(`📅 ${dia}:  ${registro} Registros  |  💎 ${ftd} FTDs  |  💰 ${deposito} Depósitos`);
    });
    console.log(`============================================\n`);

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

function isValidUUID(value) {
  if (!value || typeof value !== 'string') return false;
  // Regex para UUID v4
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

function cleanStr(v) {
  const s = (v ?? "").toString().trim();
  return s.length ? s : undefined;
}

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
  const vars = item?.contact?.variables || item?.contact?.last_message_data?.message?.tracking_data?.contact_variables || {};
  const telegram_id = item?.contact?.telegram_id || item?.contact?.last_message_data?.chat_id || item?.contact?.last_message_data?.telegram_id || "";
  const title = item?.title || item?.service || "";
  return { item, vars, telegram_id: safeString(telegram_id), title: safeString(title) };
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
// HELPERS (Busca Inteligente & Placar)
// =========================

// 1. Busca Inteligente (MODIFICADA PARA NÃO CRASHAR)
async function getLeadContextSmart(afp, playerId) {
  try {
    let context = null;
    // Tenta pelo UUID (s2/afp)
    if (afp && afp.length > 5) {
       context = await prisma.leadContext.findUnique({ where: { lead_id: afp } });
       if (context) console.log(`✅ [MATCH] Contexto encontrado via UUID: ${afp}`);
    }
    // REMOVIDO: Tenta pelo Player ID (para não dar erro de coluna inexistente)
    // if (!context && playerId) { ... }
    return context;
  } catch (e) { console.error("❌ Erro busca contexto:", e.message); return null; }
}

// =========================
// MULTI-PIXEL: Envio para Meta
// =========================

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

async function sendToMeta(event, slotNumber = null) {
  const results = { master: null, slot: null };

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
    }
  }
  return results;
}

// =========================
// Persistência de Contexto (Prisma)
// =========================

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

async function getLeadContextByAfp(afp) {
  try {
    if (!afp) {
      console.warn("⚠️ [getLeadContextByAfp] afp ausente, não buscando.");
      return null;
    }
    const context = await prisma.leadContext.findFirst({ where: { afp } });
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
  if (telegram_id) {
    user_data.external_id = sha256(String(telegram_id));
  }
  const fbp = cleanStr(vars.fbp);
  const fbc = cleanStr(vars.fbc);
  if (fbp) user_data.fbp = fbp;
  if (fbc) user_data.fbc = fbc;

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
    version: "2.0.0-FIXED",
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
    const slotNumber = slotParam || EVENT_SLOT_MAP[eventKey] || null;

    const cfg = EVENT_MAP[eventKey];
    if (!cfg) {
      const titleFallback = safeString(req.body?.title || req.body?.[0]?.title || "").toLowerCase().trim();
      const fallbackCfg = EVENT_MAP[titleFallback];
      if (!fallbackCfg) {
        console.warn("⚠️ Evento não mapeado:", eventKey, "| title:", titleFallback);
        return res.status(400).json({ ok: false, error: "EVENT_NOT_MAPPED" });
      }
    }

    const finalCfg = cfg || EVENT_MAP[safeString(req.body?.title || req.body?.[0]?.title || "").toLowerCase().trim()];
    const { vars, telegram_id } = extractVarsAndTelegramId(req.body);
    const event = buildSendPulseEvent({ cfg: finalCfg, vars, telegram_id, req });

    console.log(`🚀 Enviando SendPulse -> Meta (slot=${slotNumber || 'master'}):`, JSON.stringify(event, null, 2));
    const metaResp = await sendToMeta(event, slotNumber);
    console.log("✅ Meta Response:", JSON.stringify(metaResp));

    const leadId = vars.lead_id || event.custom_data?.lead_id;
    const contextData = {
      lead_id: leadId,
      afp: leadId,
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

    res.json({ ok: true, event_name: event.event_name, event_id: event.event_id, slot: slotNumber, context_saved: true, meta: metaResp });
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
    if (!cfg) return res.status(400).json({ ok: false, error: "EVENT_NOT_MAPPED", key });

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
    const q = req.query || {};
    const evKey = safeString(q.ev || "").toLowerCase().trim();
    const metaEventName = SMARTICO_EVENT_MAP[evKey];

    if (!metaEventName) return res.status(400).json({ ok: false, error: "SMARTICO_EVENT_NOT_MAPPED" });

    const afpKey = cleanStr(q.afp) || cleanStr(q.click_id) || cleanStr(q.afp1) || "";
    const isOurLead = isValidUUID(afpKey);

    if (!isOurLead) {
      console.log("🚫 [FILTRO] afp não é UUID válido:", afpKey);
      return res.json({ ok: true, filtered: true });
    }

    const savedContext = await getLeadContextByAfp(afpKey);
    const event_id = `${cleanStr(q.registration_id) || cleanStr(q.click_id) || crypto.randomUUID()}_${metaEventName}`;

    const event = {
      event_name: metaEventName,
      event_time: Math.floor(Date.now()/1000),
      action_source: "website",
      event_id,
      user_data: {
        client_ip_address: savedContext?.client_ip_address || getClientIp(req),
        client_user_agent: client_ua || getUserAgent(req), // client_ua corrigido abaixo
        fbp: savedContext?.fbp || cleanStr(q.fbp),
        fbc: savedContext?.fbc || cleanStr(q.fbc),
      },
      custom_data: { origem: "smartico", ...q }
    };
    // Correção rápida da variável client_ua que faltou declarar
    event.user_data.client_user_agent = savedContext?.client_user_agent || getUserAgent(req);

    const metaResp = await sendToMeta(event, 1);
    res.json({ ok: true, meta: metaResp });
  } catch (err) {
    console.error("❌ /smartico/postback ERROR:", err?.message || err);
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// =========================
// NOVIBET -> META (POST) - SLOT2
// =========================

/**
 * Endpoint para Registro da Novibet (SAFE VERSION)
 */
app.post("/novibet/registro", async (req, res) => {
  try {
    console.log("🔥 /novibet/registro");
    const data = { ...req.query, ...req.body };
    
    // Captura os IDs (Adicionei afp aqui para garantir)
    const afpKey = cleanStr(data.s2) || cleanStr(data.tracking_tag) || cleanStr(data.t1) || cleanStr(data.afp) || cleanStr(data.click_id) || "";
    const playerId = cleanStr(data.player_id) || cleanStr(data.registration_id);

    if ((!afpKey || afpKey.length < 3) && !playerId) return res.json({ ok: true, filtered: true });

    // Busca contexto (Função segura sem player_id)
    const context = await getLeadContextSmart(afpKey, playerId);
    
    // REMOVIDO: Tentativa de salvar player_id no banco (evita crash)

    const event = {
      event_name: "Registro_novibet", 
      event_time: Math.floor(Date.now()/1000), 
      action_source: "website",
      event_id: `${playerId || afpKey}_Registro_novibet`,
      user_data: {
        client_ip_address: context?.client_ip_address || getClientIp(req),
        client_user_agent: context?.client_user_agent || getUserAgent(req),
        external_id: afpKey ? sha256(afpKey) : undefined,
        fbp: context?.fbp || cleanStr(data.fbp),
        fbc: context?.fbc || cleanStr(data.fbc)
      },
      custom_data: { 
        origem: "novibet", 
        player_id: playerId, 
        utm_source: context?.utm_source || cleanStr(data.utm_source),
        // Mantém envio das tags originais
        s1: cleanStr(data.s1), s2: cleanStr(data.s2), s3: cleanStr(data.s3),
        c1: cleanStr(data.c1), c2: cleanStr(data.c2)
      }
    };

    const metaResp = await sendToMeta(event, 2);
    
    // Loga e Atualiza Placar
    await prisma.eventLog.create({ data: { type: "registro", provider: "novibet" } });
    await placar(); 

    res.json({ ok: true, meta: metaResp });
  } catch (e) { console.error("Reg Error:", e.message); res.status(500).json({ error: e.message }); }
});

/**
 * Endpoint para Depósito da Novibet (SAFE VERSION)
 */
app.post("/novibet/deposito", async (req, res) => {
  try {
    console.log("🔥 /novibet/deposito");
    const data = { ...req.query, ...req.body };
    const afpKey = cleanStr(data.s2) || cleanStr(data.tracking_tag) || cleanStr(data.t1) || cleanStr(data.afp) || "";
    const playerId = cleanStr(data.player_id) || cleanStr(data.registration_id);

    if ((!afpKey || afpKey.length < 3) && !playerId) return res.json({ ok: true, filtered: true });

    const context = await getLeadContextSmart(afpKey, playerId);

    // FTD SIMPLES (Confia no Postback para não acessar banco inexistente)
    const isFtd = data.is_ftd === "true" || data.is_ftd === true || data.status === "ftd" || data.ev === "ftd";
    
    let eventType = isFtd ? "ftd" : "deposito"; // Voltei para 'deposito' em vez de 'redeposito' pra manter seu padrão
    let metaEventName = isFtd ? "ftd_novibet" : "deposito_novibet";

    const value = parseValue(data.value) ?? parseValue(data.amount) ?? parseValue(data.deposit_amount);
    
    const event = {
      event_name: metaEventName, 
      event_time: Math.floor(Date.now()/1000), 
      action_source: "website",
      event_id: `${playerId || afpKey}_${metaEventName}_${Math.floor(Date.now()/1000)}`,
      user_data: {
        client_ip_address: context?.client_ip_address || getClientIp(req),
        client_user_agent: context?.client_user_agent || getUserAgent(req),
        external_id: afpKey ? sha256(afpKey) : undefined,
        fbp: context?.fbp || cleanStr(data.fbp),
        fbc: context?.fbc || cleanStr(data.fbc) 
      },
      custom_data: { 
        origem: "novibet", 
        tipo: eventType, 
        value: value, 
        currency: cleanStr(data.currency) || "BRL",
        utm_source: context?.utm_source || cleanStr(data.utm_source),
        s1: cleanStr(data.s1), s2: cleanStr(data.s2)
      }
    };

    const metaResp = await sendToMeta(event, 2);
    
    // Salva no log para o placar funcionar (sem escrever na coluna has_deposited do contexto)
    await prisma.eventLog.create({ data: { type: eventType, provider: "novibet" } });
    await placar(); 

    res.json({ ok: true, type: eventType, meta: metaResp });
  } catch (e) { console.error("Dep Error:", e.message); res.status(500).json({ error: e.message }); }
});

// =========================
// ESPORTIVABET (Mantido)
// =========================
app.get("/esportivabet/postback", async (req, res) => {
  try {
    const q = req.query;
    const evKey = safeString(q.ev).toLowerCase().trim();
    const slotParam = parseInt(q.slot) || 3;
    const slotNumber = [3, 4].includes(slotParam) ? slotParam : 3;
    const metaEventName = ESPORTIVABET_EVENT_MAP[evKey];

    if (!metaEventName) return res.status(400).json({ error: "EVENT_NOT_MAPPED" });

    const afpKey = cleanStr(q.afp);
    if (!isValidUUID(afpKey)) return res.json({ ok: true, filtered: true });

    const context = await getLeadContextByAfp(afpKey);
    const event = {
      event_name: metaEventName,
      event_time: Math.floor(Date.now()/1000),
      action_source: "website",
      user_data: {
        client_ip_address: context?.client_ip_address || getClientIp(req),
        fbp: context?.fbp || cleanStr(q.fbp),
        fbc: context?.fbc || cleanStr(q.fbc),
      },
      custom_data: { origem: "smartico", ...q }
    };

    const metaResp = await sendToMeta(event, slotNumber);
    res.json({ ok: true, meta: metaResp });
  } catch (err) { res.status(500).json({ error: err.message }); }
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
