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

const prisma = new PrismaClient();
const app = express();

// --- PLACAR TURBINADO (DATA + HISTÓRICO) ---
async function placar() {
  try {
    const dataLimite = new Date();
    dataLimite.setDate(dataLimite.getDate() - 3);
    const logs = await prisma.eventLog.findMany({
      where: { provider: "novibet", createdAt: { gte: dataLimite } },
      orderBy: { createdAt: 'desc' }
    });
    const resumo = {};
    for (const log of logs) {
      const dataFormatada = new Date(log.createdAt).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      if (!resumo[dataFormatada]) resumo[dataFormatada] = { registro: 0, deposito: 0, ftd: 0 };
      if (log.type === 'registro') resumo[dataFormatada].registro++;
      if (log.type === 'deposito') resumo[dataFormatada].deposito++;
      if (log.type === 'ftd') resumo[dataFormatada].ftd++;
    }
    console.log(`\n📊 === RELATÓRIO NOVIBET (Últimos Dias) ===`);
    Object.keys(resumo).forEach(dia => {
      const { registro, deposito, ftd } = resumo[dia];
      console.log(`📅 ${dia}:  ${registro} Regs  |  💎 ${ftd} FTDs  |  💰 ${deposito} Deps`);
    });
    console.log(`============================================\n`);
  } catch (e) { console.log("Erro placar:", e.message); }
}

app.set("trust proxy", true);
app.use(express.json({ limit: "2mb" }));

const META_API_VERSION = process.env.META_API_VERSION || "v20.0";
const DEFAULT_ACTION_SOURCE = process.env.META_ACTION_SOURCE || "chat";

const PIXEL_MASTER = {
  id: process.env.META_PIXEL_MASTER || process.env.META_PIXEL_ID,
  token: process.env.META_TOKEN_MASTER || process.env.META_ACCESS_TOKEN,
};

const PIXEL_SLOTS = {
  1: { id: process.env.META_PIXEL_SLOT1, token: process.env.META_TOKEN_SLOT1, name: "Vupibet" },
  2: { id: process.env.META_PIXEL_SLOT2, token: process.env.META_TOKEN_SLOT2, name: "Novibet" },
  3: { id: process.env.META_PIXEL_SLOT3, token: process.env.META_TOKEN_SLOT3, name: "Esportivabet_1" },
  4: { id: process.env.META_PIXEL_SLOT4, token: process.env.META_TOKEN_SLOT4, name: "Esportivabet_2" },
  5: { id: process.env.META_PIXEL_SLOT5, token: process.env.META_TOKEN_SLOT5, name: "MGM" },
};

const EVENT_SLOT_MAP = {
  bilhete_vupibet: 1, bilhete_novibet: 2,
  bilhete_esportivabet: 3, bilhete_esportivabet2: 4, bilhete_mgm: 5,
};

const EVENT_MAP = {
  lead_telegram: { event_name: "Lead_Telegram", extra_custom_data: {} },
  registro_casa: { event_name: "Registro_Casa", extra_custom_data: {} },
  grupo_telegram: { event_name: "Grupo_Telegram", extra_custom_data: {} },
  bilhete_mgm: { event_name: "Bilhete_MGM", extra_custom_data: { origem: "telegram", produto: "bilhete_mgm" } },
  bilhete_novibet: { event_name: "Bilhete_Novibet", extra_custom_data: { origem: "telegram", produto: "bilhete_novibet" } },
  bilhete_vupibet: { event_name: "Bilhete_Vupibet", extra_custom_data: { origem: "telegram", produto: "bilhete_vupibet" } },
  bilhete_esportivabet: { event_name: "Bilhete_Esportivabet", extra_custom_data: { origem: "telegram", produto: "bilhete_esportivabet", pixel: "1" } },
  bilhete_esportivabet2: { event_name: "Bilhete_Esportivabet", extra_custom_data: { origem: "telegram", produto: "bilhete_esportivabet", pixel: "2" } },
  lead_whatsapp: { event_name: "Lead_Whatsapp", extra_custom_data: { origem: "whatsapp" } },
  lead_comunidadewpp: { event_name: "Lead_ComunidadeWPP", extra_custom_data: { origem: "whatsapp", etapa: "comunidade" } },
};

const SMARTICO_EVENT_MAP = { registro: "Registro_vupibet", ftd: "ftd_vupibet", qftd: "qftd_vupibet", deposito: "deposito_vupibet" };
const NOVIBET_EVENT_MAP = { registro: "Registro_novibet", deposito: "deposito_novibet", ftd: "ftd_novibet" };
const ESPORTIVABET_EVENT_MAP = { registro: "Registro_esportivabet", ftd: "ftd_esportivabet", qftd: "qftd_esportivabet", deposito: "deposito_esportivabet" };

function isValidUUID(value) {
  if (!value || typeof value !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function sha256(str) { return str ? crypto.createHash("sha256").update(String(str)).digest("hex") : undefined; }
function safeString(v) { return v === null || v === undefined ? "" : String(v); }
function cleanStr(v) { const s = (v ?? "").toString().trim(); return s.length ? s : undefined; }
function parseValue(v) { if (v === null || v === undefined) return undefined; const n = Number(String(v).replace(",", ".")); return Number.isFinite(n) ? n : undefined; }
function normalizeEmail(email) { if (!email) return ""; return String(email).trim().toLowerCase(); }
function normalizePhone(phone) { if (!phone) return ""; return String(phone).replace(/\D+/g, ""); }
function getItem(body) { return Array.isArray(body) ? body[0] : body; }

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
  return safeString(req.ip || req.connection?.remoteAddress || "");
}
function getUserAgent(req) { return safeString(req.headers["user-agent"] || ""); }

async function getLeadContextSmart(afp, playerId) {
  try {
    if (afp && afp.length > 5) {
       const context = await prisma.leadContext.findUnique({ where: { lead_id: afp } });
       if (context) return context;
    }
    return null;
  } catch (e) { return null; }
}

async function sendToPixel(event, pixelId, accessToken) {
  if (!pixelId || !accessToken) return { skipped: true };
  const res = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${pixelId}/events?access_token=${accessToken}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: [event] }),
  });
  return await res.json();
}

async function sendToMeta(event, slotNumber = null) {
  const results = { master: null, slot: null };
  if (PIXEL_MASTER.id) {
    try { results.master = await sendToPixel(event, PIXEL_MASTER.id, PIXEL_MASTER.token); } catch (err) {}
  }
  if (slotNumber && PIXEL_SLOTS[slotNumber]) {
    try { results.slot = await sendToPixel(event, PIXEL_SLOTS[slotNumber].id, PIXEL_SLOTS[slotNumber].token); } catch (err) {}
  }
  return results;
}

async function saveLeadContext(data) {
  try {
    const { lead_id, afp, fbp, fbc, fbclid, utm_source, utm_medium, utm_campaign, utm_content, client_ip_address, client_user_agent } = data;
    if (!lead_id) return null;
    return await prisma.leadContext.upsert({
      where: { lead_id },
      update: { afp, fbp, fbc, fbclid, utm_source, utm_medium, utm_campaign, utm_content, client_ip_address, client_user_agent },
      create: { lead_id, afp, fbp, fbc, fbclid, utm_source, utm_medium, utm_campaign, utm_content, client_ip_address, client_user_agent },
    });
  } catch (err) { return null; }
}

async function getLeadContextByAfp(afp) {
  try {
    if (!afp) return null;
    return await prisma.leadContext.findFirst({ where: { afp } });
  } catch (err) { return null; }
}

// =========================
// SENDPULSE -> META
// =========================
app.post("/sp/event", async (req, res) => {
  try {
    const eventKey = safeString(req.query.e || req.query.event).toLowerCase();
    const slotNumber = parseInt(req.query.slot) || EVENT_SLOT_MAP[eventKey] || null;
    const { vars, telegram_id } = extractVarsAndTelegramId(req.body);
    const cfg = EVENT_MAP[eventKey] || EVENT_MAP[safeString(req.body?.[0]?.title).toLowerCase()];
    if (!cfg) return res.status(400).json({ ok: false });
    const event = buildSendPulseEvent({ cfg, vars, telegram_id, req });
    const metaResp = await sendToMeta(event, slotNumber);
    saveLeadContext({
      lead_id: vars.lead_id || event.custom_data?.lead_id, afp: vars.lead_id || event.custom_data?.lead_id,
      fbp: cleanStr(vars.fbp), fbc: cleanStr(vars.fbc), fbclid: cleanStr(vars.fbclid),
      utm_source: cleanStr(vars.utm_source), client_ip_address: getClientIp(req), client_user_agent: getUserAgent(req)
    });
    res.json({ ok: true, meta: metaResp });
  } catch (err) { res.status(500).json({ ok: false }); }
});

// =====================================================================
// NOVIBET REGISTRO (DEDO DURO - ENVIANDO TUDO SEM FILTRO)
// =====================================================================
app.post("/novibet/registro", async (req, res) => {
  try {
    console.log("\n---------------------------------------------------------");
    console.log("🚨 [SISTEMA] NOVO REGISTRO DETECTADO NA PORTA");
    const data = { ...req.query, ...req.body };
    console.log("📦 DADOS BRUTOS RECEBIDOS (REGISTRO):", JSON.stringify(data, null, 2));
    console.log("---------------------------------------------------------\n");

    const afpKey = cleanStr(data.s1) || cleanStr(data.s2) || cleanStr(data.s3) || cleanStr(data.tracking_tag) || "";
    const playerId = cleanStr(data.player_id) || cleanStr(data.registration_id);
    const context = await getLeadContextSmart(afpKey, playerId);

    const event = {
      event_name: "Registro_novibet", 
      event_time: Math.floor(Date.now()/1000), action_source: "website",
      event_id: `${playerId || afpKey}_Registro_novibet`,
      user_data: {
        client_ip_address: context?.client_ip_address || getClientIp(req),
        client_user_agent: context?.client_user_agent || getUserAgent(req),
        fbp: context?.fbp || cleanStr(data.fbp), fbc: context?.fbc || cleanStr(data.fbc)
      },
      custom_data: { origem: "novibet", player_id: playerId, s1: data.s1, s2: data.s2, s3: data.s3 }
    };
    await sendToMeta(event, 2);
    await prisma.eventLog.create({ data: { type: "registro", provider: "novibet" } });
    await placar();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// =====================================================================
// NOVIBET DEPOSITO (DEDO DURO - ENVIANDO TUDO SEM FILTRO)
// =====================================================================
app.post("/novibet/deposito", async (req, res) => {
  try {
    console.log("\n---------------------------------------------------------");
    console.log("🚨 [SISTEMA] NOVO DEPÓSITO DETECTADO NA PORTA");
    const data = { ...req.query, ...req.body };
    console.log("📦 DADOS BRUTOS RECEBIDOS (DEPÓSITO):", JSON.stringify(data, null, 2));
    console.log("---------------------------------------------------------\n");

    const afpKey = cleanStr(data.s1) || cleanStr(data.s2) || cleanStr(data.s3) || cleanStr(data.tracking_tag) || "";
    const playerId = cleanStr(data.player_id) || cleanStr(data.registration_id);
    const context = await getLeadContextSmart(afpKey, playerId);

    const isFtd = data.is_ftd === "true" || data.is_ftd === true || data.status === "ftd" || data.ev === "ftd";
    const metaEventName = isFtd ? "ftd_novibet" : "deposito_novibet";
    const value = parseValue(data.value) ?? parseValue(data.amount) ?? parseValue(data.deposit_amount);

    const event = {
      event_name: metaEventName, 
      event_time: Math.floor(Date.now()/1000), action_source: "website",
      event_id: `${playerId || afpKey}_${metaEventName}_${Math.floor(Date.now()/1000)}`,
      user_data: {
        client_ip_address: context?.client_ip_address || getClientIp(req),
        client_user_agent: context?.client_user_agent || getUserAgent(req),
        fbp: context?.fbp || cleanStr(data.fbp), fbc: context?.fbc || cleanStr(data.fbc)
      },
      custom_data: { origem: "novibet", value, s1: data.s1, s2: data.s2, s3: data.s3 }
    };
    await sendToMeta(event, 2);
    await prisma.eventLog.create({ data: { type: isFtd ? "ftd" : "deposito", provider: "novibet" } });
    await placar();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`🚀 v2.0.0 listening on port ${port}`);
  placar();
});
