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
// META_PIXEL_SLOT3 / META_TOKEN_SLOT3    -> Esportivabet Pixel 1 (Deles)
// META_PIXEL_SLOT4 / META_TOKEN_SLOT4    -> Esportivabet Pixel 2
// META_PIXEL_SLOT5 / META_TOKEN_SLOT5    -> SuperBet Isolado
// =====================================================================

import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const app = express();

// =========================
// RELATÓRIO GERAL (VERSÃO FINAL - NOVIBET S1/S2/S3)
// =========================
async function relatorioGeral() {
  try {
    const agora = new Date();
    const hojeInicio = new Date(agora);
    hojeInicio.setHours(0, 0, 0, 0);

    const ontemInicio = new Date(hojeInicio);
    ontemInicio.setDate(ontemInicio.getDate() - 1);
    
    const ontemFim = new Date(hojeInicio);
    ontemFim.setMilliseconds(-1);

    // Busca estatísticas agrupadas
    const getStats = async (inicio, fim) => {
      return await prisma.eventLog.groupBy({
        by: ['provider', 'extra', 'type'],
        where: { 
          createdAt: { gte: inicio, lte: fim },
          provider: 'novibet',
          extra: { notIn: ["", "direto"] } // Filtra apenas os que têm algum S1/S2/S3 real
        },
        _count: { type: true },
        orderBy: [{ extra: 'asc' }, { type: 'asc' }]
      });
    };

    const statsHoje = await getStats(hojeInicio, agora);
    const statsOntem = await getStats(ontemInicio, ontemFim);

    const formatarBloco = (stats, titulo) => {
      if (stats.length === 0) return `\n*${titulo}:* Sem dados de S1/S2/S3 hoje.\n`;
      
      let bloco = `\n*${titulo}:*\n`;
      let currentExtra = "";

      stats.forEach(s => {
        const extra = s.extra;
        const type = s.type;
        const count = s._count.type;

        if (extra !== currentExtra) {
          bloco += `\n🏠 *Campanha/S1:* \`${extra}\`\n`;
          currentExtra = extra;
        }

        const emoji = type === "ftd" ? "💎" : type === "deposito" ? "💰" : "📝";
        bloco += `    ${emoji} ${type}: *${count}*\n`;
      });
      return bloco;
    };

    let msg = `📊 *DASHBOARD NOVIBET (POR EXPERT)*\n`;
    msg += `--------------------------------\n`;
    msg += formatarBloco(statsHoje, "📅 RESULTADOS DE HOJE");
    msg += `--------------------------------\n`;
    msg += formatarBloco(statsOntem, "⏪ RESULTADOS DE ONTEM");
    msg += `\n🔗 *Dashboard Web:* https://sp-meta-capi.onrender.com/dashboard`;
    
    return msg;
  } catch (err ) {
    console.error("❌ Erro no relatório:", err.message);
    return "Erro ao gerar o resumo diário.";
  }
}
// =====================================================================
// BUSCAR DADOS DO DASHBOARD (SUPORTE A PERÍODOS E CÁLCULO REAL)
// =====================================================================
async function buscarDadosDashboard(dataInicioFiltro = null, dataFimFiltro = null) {
  // 1. Configuração de Datas e Fuso Horário (Brasília)
  const agora = new Date();
  const offsetBrasilia = -3 * 60;
  const agoraBrasilia = new Date(agora.getTime() + (offsetBrasilia - agora.getTimezoneOffset()) * 60000);
  const hojeStr = agoraBrasilia.toISOString().split("T")[0];

  const inicioStr = dataInicioFiltro || hojeStr;
  const fimStr = dataFimFiltro || hojeStr;

  const diaInicio = new Date(`${inicioStr}T00:00:00-03:00`);
  const diaFim    = new Date(`${fimStr}T23:59:59-03:00`);

  // 2. Tabela 1: Resumo Geral de Eventos
  const stats = await prisma.eventLog.groupBy({
    by: ['provider', 'type', 'extra'],
    where: { createdAt: { gte: diaInicio, lte: diaFim } },
    _count: { type: true },
    orderBy: [{ provider: 'asc' }, { type: 'asc' }]
  });

  const totais = stats.map(s => ({
    provider: s.provider,
    evento: s.type,
    subOrigem: s.extra || null,
    contagem: s._count.type
  }));

  // 3. Array de dias para o formato texto do Meta Ads ("DD/MM/YYYY")
  const daysArray = [];
  let currentDay = new Date(diaInicio);
  while (currentDay <= diaFim) {
    const dd = String(currentDay.getDate()).padStart(2, '0');
    const mm = String(currentDay.getMonth() + 1).padStart(2, '0');
    const yyyy = currentDay.getFullYear();
    daysArray.push(`${dd}/${mm}/${yyyy}`);
    currentDay.setDate(currentDay.getDate() + 1);
  }

  // 4. Métricas de Ads (Agora soma tudo e calcula médias reais)
  const adStats = await prisma.adMetrics.groupBy({
    by: ['funil'],
    where: { day: { in: daysArray } },
    _sum: {
      amountSpent: true,
      impressions: true,
      linkClicks: true,
    },
    orderBy: { funil: 'asc' }
  });

  const adsPorFunil = adStats.map(s => {
    const gasto = s._sum.amountSpent || 0;
    const imps = s._sum.impressions || 0;
    const clicks = s._sum.linkClicks || 0;
    
    // Cálculo estatístico real
    const ctr = imps > 0 ? ((clicks / imps) * 100).toFixed(2) : "0.00";
    const cpm = imps > 0 ? ((gasto / imps) * 1000).toFixed(2) : "0.00";

    return {
      funil: s.funil || "sem funil",
      gasto: gasto.toFixed(2),
      impressoes: imps,
      cliques: clicks,
      ctr: ctr,
      cpm: cpm,
    };
  });

  // 5. Cruzamento de Funil (SendPulse e Novibet)
  const eventosNovibet = await prisma.eventLog.groupBy({
    by: ['type', 'extra'],
    where: {
      createdAt: { gte: diaInicio, lte: diaFim },
      provider: 'novibet',
      extra: { not: null }
    },
    _count: { type: true }
  });

  const eventosSendpulse = await prisma.eventLog.groupBy({
    by: ['type'],
    where: {
      createdAt: { gte: diaInicio, lte: diaFim },
      provider: 'sendpulse',
      type: { startsWith: 'Start_' }
    },
    _count: { type: true }
  });

  const eventosPorFunil = {};

  for (const e of eventosSendpulse) {
    const match = e.type.toLowerCase().match(/(f[0-9]+)/);
    if (!match) continue;
    const funil = match[1];
    if (!eventosPorFunil[funil]) eventosPorFunil[funil] = { start: 0, registro: 0, ftd: 0 };
    eventosPorFunil[funil].start += e._count.type;
  }

  for (const e of eventosNovibet) {
    const funil = (e.extra || "").toLowerCase();
    if (!eventosPorFunil[funil]) eventosPorFunil[funil] = { start: 0, registro: 0, ftd: 0 };
    if (e.type === 'registro') eventosPorFunil[funil].registro += e._count.type;
    if (e.type === 'ftd' || e.type === 'deposito') eventosPorFunil[funil].ftd += e._count.type;
  }

  return { totais, adsPorFunil, eventosPorFunil };
}

// Roda o relatório sozinho a cada 1 hora (para não sujar o log)
setInterval(relatorioGeral, 60 * 60 * 1000);

// 👆👆👆 FIM DA COLAGEM 👆👆👆

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
  // --- EVENTOS ORIGINAIS ---
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

  // ✅ ADICIONADO: GOA NOVIBET
  goa_novibet: { 
    event_name: "Lead_Novibet", 
    extra_custom_data: { origem: "whatsapp", produto: "novibet", versao: "goa" } 
  },

  // --- NOVOS EVENTOS (SUPERBET & MGM) ---
  superbet_goa_v1: {
    event_name: "SuperBet_GOA_V1",
    extra_custom_data: { origem: "whatsapp", versao: "goa_v1" }
  },
  
  superbet_goa_v2: {
    event_name: "SuperBet_GOA_V2",
    extra_custom_data: { origem: "whatsapp", versao: "goa_v2" }
  },
  
  mgm_goa_v1: {
    event_name: "MGM_GOA_V1",
    extra_custom_data: { origem: "whatsapp", produto: "mgm", versao: "goa_v1" }
  },
  
  novi_goa_v1: {
    event_name: "NOVI_GOA_V1",
    extra_custom_data: { origem: "whatsapp", produto: "NOVI", versao: "goa_v1" }
  },
  
  bilhete_superbet: {
    event_name: "Bilhete_Superbet",
    extra_custom_data: { origem: "whatsapp", produto: "bilhete_superbet" }
  },

f01: {
  event_name: "Start_F01",
  extra_custom_data: { origem: "whatsapp", funil: "f01" }
},

start_f03: {
  event_name: "Start_F03",
  extra_custom_data: { origem: "whatsapp", funil: "f03" }
},

start_f04: {
  event_name: "Start_F04",
  extra_custom_data: { origem: "whatsapp", funil: "f04" }
}
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

async function getLeadContextSmart(key, playerId) {
  try {
    if (!key) return null;
    const cleanKey = String(key).trim();
    
    // Se vier a variável bruta do SendPulse, não adianta buscar no banco
    if (cleanKey === "" || cleanKey.includes("{{")) return null;

    // Busca direta pelo lead_id (como era no seu código que funcionava)
    const context = await prisma.leadContext.findUnique({ 
      where: { lead_id: cleanKey } 
    });
    
    if (context) {
      console.log(`✅ [MATCH] Sucesso! Contexto recuperado para: ${cleanKey}`);
      return context;
    }

    return null;
  } catch (e) {
    console.error(`❌ [getLeadContextSmart] Erro:`, e.message);
    return null;
  }
}

async function sendToPixel(event, pixelId, accessToken) {
  if (!pixelId || !accessToken) return { skipped: true };
  const res = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${pixelId}/events?access_token=${accessToken}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: [event] }),
  });
  return await res.json();
}

// =========================
// ENCAMINHAMENTO PARA RAPZ
// =========================
async function forwardToRapz(data) {
  try {
    const rapzUrl = "https://n.rapz.com.br/webhook/novibet";
    
    // Enviamos exatamente os mesmos dados que recebemos da Novibet
    const response = await fetch(rapzUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data )
    });

    if (response.ok) {
      console.log("✅ [RAPZ] Dados encaminhados com sucesso.");
    } else {
      console.log(`⚠️ [RAPZ] Erro ao encaminhar: ${response.status}`);
    }
  } catch (err) {
    console.error("❌ [RAPZ] Erro fatal no encaminhamento:", err.message);
  }
}

// =========================
// Rastreamento de Erros de Envio para o Meta
// =========================
async function sendToMeta(event, slotNumber = null) {
  const results = { master: null, slot: null };

  // 1. Enviar para Pixel Mestre
  if (PIXEL_MASTER.id && PIXEL_MASTER.token) {
    try {
      console.log(`📤 [MASTER] Enviando evento '${event.event_name}' para pixel mestre...`);
      results.master = await sendToPixel(event, PIXEL_MASTER.id, PIXEL_MASTER.token);
      // Verifica se o Facebook retornou um erro na resposta
      if (results.master.error) {
          console.error(`❌ [MASTER] Facebook retornou um erro:`, JSON.stringify(results.master.error));
      } else {
          console.log(`✅ [MASTER] OK:`, JSON.stringify(results.master));
      }
    } catch (err) {
      // Loga o erro de conexão/fetch
      console.error(`❌ [MASTER] Erro CRÍTICO ao tentar enviar:`, err.message);
      results.master = { error: err.message };
    }
  } else {
      console.warn("⚠️ [MASTER] Pixel mestre não configurado. Pulando envio.");
  }

  // 2. Enviar para Slot específico
  if (slotNumber && PIXEL_SLOTS[slotNumber]) {
    const slot = PIXEL_SLOTS[slotNumber];
    if (slot.id && slot.token) {
      try {
        console.log(`📤 [SLOT ${slotNumber}] Enviando evento '${event.event_name}' para ${slot.name}...`);
        results.slot = await sendToPixel(event, slot.id, slot.token);
        results.slotName = slot.name;
        if (results.slot.error) {
            console.error(`❌ [SLOT ${slotNumber}] Facebook retornou um erro:`, JSON.stringify(results.slot.error));
        } else {
            console.log(`✅ [SLOT ${slotNumber}] OK:`, JSON.stringify(results.slot));
        }
      } catch (err) {
        console.error(`❌ [SLOT ${slotNumber}] Erro CRÍTICO ao tentar enviar para ${slot.name}:`, err.message);
        results.slot = { error: err.message };
      }
    } else {
        console.warn(`⚠️ [SLOT ${slotNumber}] Slot ${slot.name} não configurado corretamente. Pulando envio.`);
    }
  }
  return results;
}

async function saveLeadContext(data) {
  try {
    const { lead_id, afp, fbp, fbc, fbclid, utm_source, utm_medium, utm_campaign, utm_content, client_ip_address, client_user_agent } = data;
    if (!lead_id) {
        console.warn("⚠️ [saveLeadContext] Tentativa de salvar contexto sem lead_id. Pulando.");
        return null;
    }
    const saved = await prisma.leadContext.upsert({
      where: { lead_id },
      update: { afp, fbp, fbc, fbclid, utm_source, utm_medium, utm_campaign, utm_content, client_ip_address, client_user_agent },
      create: { lead_id, afp, fbp, fbc, fbclid, utm_source, utm_medium, utm_campaign, utm_content, client_ip_address, client_user_agent },
    });
    // Log de sucesso removido para não poluir, o importante é o erro.
    return saved;
  } catch (err) {
    // AGORA ELE AVISA DO ERRO!
    console.error(`❌ [saveLeadContext] Erro CRÍTICO ao salvar contexto para lead_id ${data.lead_id}:`, err.message);
    return null; 
  }
}

async function getLeadContextByAfp(afp) {
  try {
    if (!afp) return null;
    return await prisma.leadContext.findFirst({ where: { afp } });
  } catch (err) {
    // AGORA ELE AVISA DO ERRO!
    console.error(`❌ [getLeadContextByAfp] Erro CRÍTICO ao buscar contexto para afp ${afp}:`, err.message);
    return null; 
  }
}

// --- FUNÇÃO QUE ESTAVA FALTANDO ---
function buildSendPulseEvent({ cfg, vars, telegram_id, req }) {
  const email = normalizeEmail(vars.email || vars.em);
  const phone = normalizePhone(vars.phone || vars.ph || vars.whatsapp);
  const client_ip = getClientIp(req);
  const client_ua = getUserAgent(req);
  const fbp = cleanStr(vars.fbp);
  const fbc = cleanStr(vars.fbc);
  
  // Cria ID único para dedup
  const event_id = vars.lead_id 
    ? `${vars.lead_id}_${cfg.event_name}` 
    : `sp_${telegram_id || Date.now()}_${cfg.event_name}`;

  return {
    event_name: cfg.event_name,
    event_time: Math.floor(Date.now() / 1000),
    action_source: "chat",
    event_id: event_id,
    user_data: {
      em: email ? [sha256(email)] : undefined,
      ph: phone ? [sha256(phone)] : undefined,
      client_ip_address: client_ip,
      client_user_agent: client_ua,
      fbp: fbp,
      fbc: fbc,
      external_id: telegram_id ? [sha256(telegram_id)] : undefined
    },
    custom_data: {
      ...cfg.extra_custom_data,
      lead_id: vars.lead_id,
      telegram_id: telegram_id,
      origem_url: vars.origem_url
    }
  };
}
// =========================
// SENDPULSE -> META
// =========================
app.post("/sp/event", async (req, res) => {
  try {
    const eventKey = safeString(req.query.e || req.query.event).toLowerCase().trim(); // Corrigido e com .trim()
    const slotNumber = parseInt(req.query.slot) || EVENT_SLOT_MAP[eventKey] || null;
    
    const cfg = EVENT_MAP[eventKey];
    if (!cfg) {
        // Adicionando log para eventos não mapeados para facilitar a depuração
        console.warn(`⚠️ [ROTA /sp/event] Evento não mapeado recebido: "${eventKey}"`);
        return res.status(400).json({ ok: false, error: "EVENT_NOT_MAPPED" });
    }

    const { vars, telegram_id } = extractVarsAndTelegramId(req.body);
    const event = buildSendPulseEvent({ cfg, vars, telegram_id, req });
    
    console.log(`🚀 [ROTA /sp/event] Recebido: ${eventKey}. Enviando para Meta...`);
    const metaResp = await sendToMeta(event, slotNumber);
    
    saveLeadContext({
      lead_id: vars.lead_id || event.custom_data?.lead_id, 
      afp: vars.lead_id || event.custom_data?.lead_id,
      fbp: cleanStr(vars.fbp), 
      fbc: cleanStr(vars.fbc), 
      fbclid: cleanStr(vars.fbclid),
      utm_source: cleanStr(vars.utm_source), 
      client_ip_address: getClientIp(req), 
      client_user_agent: getUserAgent(req)
    });

    await prisma.eventLog.create({ 
      data: { type: event.event_name, provider: "sendpulse" } 
    });

    res.json({ ok: true, meta: metaResp });
  } catch (err) { 
      console.error(`❌ [ROTA /sp/event] Erro fatal:`, err.message);
      res.status(500).json({ ok: false, error: err.message }); 
  }
});

// =========================
// ROTAS DE COMPATIBILIDADE E OUTRAS CASAS (VERSÃO CORRETA)
// =========================

// Função auxiliar para rotas antigas do SendPulse
async function compatHandler(req, res, key) {
  try {
    const cfg = EVENT_MAP[key];
    if (!cfg) {
        console.warn(`⚠️ [ROTA DE COMPATIBILIDADE] Evento não mapeado: "${key}"`);
        return res.status(400).json({ ok: false, error: "EVENT_NOT_MAPPED", key });
    }

    const slotNumber = EVENT_SLOT_MAP[key] || null;
    const { vars, telegram_id } = extractVarsAndTelegramId(req.body);
    const event = buildSendPulseEvent({ cfg, vars, telegram_id, req });

    console.log(`🚀 [ROTA DE COMPATIBILIDADE] Recebido em /sp/${key}. Enviando para Meta...`);
    const metaResp = await sendToMeta(event, slotNumber);
    
    await prisma.eventLog.create({ 
      data: { type: event.event_name, provider: "sendpulse" } 
    });

    res.json({ ok: true, event_name: event.event_name, event_id: event.event_id, slot: slotNumber, meta: metaResp });
  } catch (err) {
    console.error(`❌ /sp/${key} ERROR:`, err?.message || err);
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}

// Restaurando as rotas de compatibilidade
app.post("/sp/lead", (req, res) => compatHandler(req, res, "lead_telegram"));
app.post("/sp/register", (req, res) => compatHandler(req, res, "registro_casa"));
app.post("/sp/group", (req, res) => compatHandler(req, res, "grupo_telegram"));
app.post("/sp/bilhete", (req, res) => compatHandler(req, res, "bilhete_mgm"));

// =========================
// SMARTICO -> META (GET) - SLOT1 (Vupibet)
// =========================
app.get("/smartico/postback", async (req, res) => {
  try {
    const q = req.query || {};
    const evKey = safeString(q.ev || "").toLowerCase().trim();
    const metaEventName = SMARTICO_EVENT_MAP[evKey];

    if (!metaEventName) return res.status(400).json({ ok: false, error: "SMARTICO_EVENT_NOT_MAPPED" });

    const afpKey = cleanStr(q.afp) || cleanStr(q.click_id) || cleanStr(q.afp1) || "";
    if (!isValidUUID(afpKey)) {
      return res.json({ ok: true, filtered: true, reason: "afp_not_uuid" });
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
        client_user_agent: savedContext?.client_user_agent || getUserAgent(req),
        fbp: savedContext?.fbp || cleanStr(q.fbp),
        fbc: savedContext?.fbc || cleanStr(q.fbc),
      },
      custom_data: { origem: "smartico", ...q }
    };

    const metaResp = await sendToMeta(event, 1);
    res.json({ ok: true, meta: metaResp });
  } catch (err) {
    console.error("❌ /smartico/postback ERROR:", err?.message || err);
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// =====================================================================
// ROTA ESPORTIVABET - SLOT 3 - DASHBOARD ON / META AGUARDANDO UUID
// =====================================================================
app.get("/esportivabet/postback", async (req, res) => {
  try {
    const q = req.query;
    
    console.log("\n---------------------------------------------------------");
    console.log("⚽ [ESPORTIVABET] Postback recebido.");
    console.log("📦 DADOS BRUTOS:", JSON.stringify(q, null, 2));

    // 1. Identifica o Evento
    const evType = (q.ev || "").toLowerCase().trim();
    let metaEventName = "";
    let isFtd = false;

    if (evType === "reg") {
        metaEventName = "registro"; // Nome limpo para o dashboard somar
    } else if (evType === "ftd" || evType === "qftd") {
        metaEventName = "ftd"; // Nome limpo para o dashboard somar
        isFtd = true;
    } else {
        console.log(`⚠️ [ESPORTIVABET] Evento ignorado: ${evType}`);
        return res.json({ ok: true, reason: "event_ignored" });
    }

    // 2. SLOT DEFINIDO: SLOT 3
    const slotNumber = 3; 

    // 3. MAPEAMENTO DO FUNIL (Vindo no afp conforme solicitado)
    const funil = (q.afp || "").toLowerCase().trim() || "direto";
    
    // VARIÁVEL QUE O TIME VAI DEFINIR (Aguardando)
    const leadId = q.VARIAVEL_DO_TIME; 

    // 4. SALVA NO DASHBOARD (Aparece no Log Geral, Painel de Ads e Taxas)
    await prisma.eventLog.create({
        data: { 
            type: metaEventName, 
            provider: "esportivabet", 
            extra: funil // Aqui garante que o f03 seja contabilizado em todas as tabelas
        }
    }).catch((e)=>{ console.error("Erro ao salvar no banco:", e.message) });

    // 5. TRAVA DE SEGURANÇA PRO META
    if (!isValidUUID(leadId)) {
        console.log(`🚫 [ESPORTIVABET] Salvo no Dash (${funil}), mas bloqueado pro Meta (Slot ${slotNumber} aguardando UUID)`);
        return res.json({ ok: true, dash: "salvo", meta: "bloqueado_sem_uuid" });
    }

    // =================================================================
    // LOGICA DO META (SÓ RODA COM LEAD_ID VÁLIDO)
    // =================================================================
    const context = await getLeadContextByAfp(leadId);
    const valueParam = parseFloat(q.first_deposit_amount || q.value) || (isFtd ? 30 : 0);

    const event = {
      event_name: metaEventName === "registro" ? "CompleteRegistration" : "Purchase",
      event_time: Math.floor(Date.now() / 1000),
      action_source: "website",
      event_id: `esp_${leadId}_${metaEventName}_${Date.now()}`,
      user_data: {
        client_ip_address: context?.client_ip_address || getClientIp(req),
        client_user_agent: context?.client_user_agent || getUserAgent(req), 
        fbp: context?.fbp,
        fbc: context?.fbc,
        external_id: [sha256(leadId)] 
      },
      custom_data: {
        origem: "esportivabet",
        funil: funil, 
        value: valueParam,
        currency: "BRL"
      }
    };

    await sendToMeta(event, slotNumber);
    console.log(`🚀 [ESPORTIVABET] Enviado ao Meta (Slot ${slotNumber})`);

    res.json({ ok: true, dash: "salvo", meta: "enviado" });

  } catch (err) {
    console.error("❌ [ERRO ESPORTIVABET]:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// =====================================================================
// NOVIBET REGISTRO (VERSÃO CORRIGIDA E OTIMIZADA)
// =====================================================================
app.post("/novibet/registro", async (req, res) => {
  try {
    console.log("\n---------------------------------------------------------");
    console.log("🚨 [NOVIBET] Novo REGISTRO recebido.");
    const data = { ...req.query, ...req.body };
    console.log("📦 DADOS BRUTOS (REGISTRO):", JSON.stringify(data, null, 2));
    
    // -> NOVO: Encaminha para a Rapz sem travar o seu fluxo principal
    forwardToRapz(data);

    // -> PASSO 1: Identificar a chave de busca correta (o lead_id da SendPulse)
    // A Novibet retorna o nosso lead_id nos parâmetros s1, s2, etc.
    // Priorizamos o s2, depois s1, como fallback.
    const leadIdFromNovibet = cleanStr(data.s2) || cleanStr(data.s1);
    
    if (!leadIdFromNovibet) {
      console.log(`🚫 [FILTRO NOVIBET] Registro ignorado. Nenhum lead_id (s1/s2) encontrado no postback.`);
      return res.json({ ok: true, filtered: true, reason: "missing_lead_id" });
    }
    console.log(`🔑 Chave de busca (lead_id) identificada: ${leadIdFromNovibet}`);

    // -> PASSO 2: Buscar o contexto no banco de dados USANDO A CHAVE CORRETA
    const context = await prisma.leadContext.findUnique({
        where: { lead_id: leadIdFromNovibet }
    });

    if (!context) {
        console.warn(`⚠️ [MATCH] Contexto não encontrado no banco para o lead_id: ${leadIdFromNovibet}. O evento será enviado com menos dados.`);
    } else {
        console.log(`✅ [MATCH] Sucesso! Contexto recuperado para ${leadIdFromNovibet}: fbp=${!!context.fbp}, fbc=${!!context.fbc}`);
    }

    // -> PASSO 3: Construir o evento para o Meta, usando os dados do contexto recuperado
    const playerId = cleanStr(data.player_id) || cleanStr(data.registration_id);
    const event_id = `reg_${playerId || leadIdFromNovibet}_${Date.now()}`;

    const event = {
      event_name: "Registration", // Usando evento padrão do Meta para melhor otimização
      event_time: Math.floor(Date.now()/1000), 
      action_source: "website",
      event_id: event_id,
      user_data: {
        // -> A MÁGICA ACONTECE AQUI: Usamos os dados do 'context' como prioridade
        client_ip_address: context?.client_ip_address || getClientIp(req),
        client_user_agent: context?.client_user_agent || getUserAgent(req),
        fbp: context?.fbp || undefined, // Se não achar, não envia nada.
        fbc: context?.fbc || undefined, // Se não achar, não envia nada.
        external_id: [sha256(leadIdFromNovibet)] // Usando o lead_id como ID externo
      },
      custom_data: { 
          origem: "novibet", 
          lead_id: leadIdFromNovibet,
          player_id: playerId, 
          s1: data.s1, 
          s2: data.s2, 
          s3: data.s3 
      }
    };

    console.log(`🚀 [META] Enviando evento 'Registration' para o Facebook...`);
    await sendToMeta(event, 2); // Envia para o Slot 2 (Novibet)

    await prisma.eventLog.create({ 
      data: { type: "registro", provider: "novibet", extra: cleanStr(data.s1) || cleanStr(data.s2) || cleanStr(data.s3) || "direto"} 
    });

    console.log("✅ [SUCESSO] Processamento de Registro finalizado.");
    console.log("---------------------------------------------------------\n");
    
    res.json({ ok: true });
  } catch (e) { 
    console.error("❌ [ERRO FATAL REGISTRO]:", e.message, e.stack);
    res.status(500).json({ error: e.message }); 
  }
});


// =====================================================================
// NOVIBET DEPOSITO (VERSÃO CORRIGIDA E OTIMIZADA)
// =====================================================================
app.post("/novibet/deposito", async (req, res) => {
  try {
    console.log("\n---------------------------------------------------------");
    console.log("💰 [NOVIBET] Novo DEPÓSITO recebido.");
    const data = { ...req.query, ...req.body };
    console.log("📦 DADOS BRUTOS (DEPÓSITO):", JSON.stringify(data, null, 2));

     // -> NOVO: Encaminha para a Rapz (sem await para não atrasar o seu fluxo)
    forwardToRapz(data);

    // -> PASSO 1: Mesma lógica do registro para encontrar a chave
    const leadIdFromNovibet = cleanStr(data.s2) || cleanStr(data.s1);

    if (!leadIdFromNovibet) {
      console.log(`🚫 [FILTRO NOVIBET] Depósito ignorado. Nenhum lead_id (s1/s2) encontrado.`);
      return res.json({ ok: true, filtered: true, reason: "missing_lead_id" });
    }
    console.log(`🔑 Chave de busca (lead_id) identificada: ${leadIdFromNovibet}`);

    // -> PASSO 2: Buscar o contexto
    const context = await prisma.leadContext.findUnique({
        where: { lead_id: leadIdFromNovibet }
    });

    if (!context) {
        console.warn(`⚠️ [MATCH] Contexto não encontrado para o lead_id: ${leadIdFromNovibet}.`);
    } else {
        console.log(`✅ [MATCH] Sucesso! Contexto recuperado para ${leadIdFromNovibet}.`);
    }

    // -> PASSO 3: Construir o evento
    const isFtd = data.is_ftd === "true" || data.is_ftd === true || data.status === "ftd" || data.ev === "ftd";
    const metaEventName = isFtd ? "Purchase" : "deposito_novibet"; // 'Purchase' para FTD, custom para recorrente
    const value = parseValue(data.value) ?? parseValue(data.amount);
    const playerId = cleanStr(data.player_id) || cleanStr(data.registration_id);
    const event_id = `dep_${playerId || leadIdFromNovibet}_${Date.now()}`;

    const event = {
      event_name: metaEventName, 
      event_time: Math.floor(Date.now()/1000), 
      action_source: "website",
      event_id: event_id,
      user_data: {
        client_ip_address: context?.client_ip_address || getClientIp(req),
        client_user_agent: context?.client_user_agent || getUserAgent(req),
        fbp: context?.fbp || undefined,
        fbc: context?.fbc || undefined,
        external_id: [sha256(leadIdFromNovibet)]
      },
      custom_data: { 
          origem: "novibet", 
          value: value,
          currency: 'BRL', // Adicionando a moeda, que é uma boa prática
          lead_id: leadIdFromNovibet,
          player_id: playerId, 
          s1: data.s1, 
          s2: data.s2, 
          s3: data.s3 
      }
    };
    
    // Adiciona o valor apenas se ele for um número válido
    if (value !== undefined) {
        event.custom_data.value = value;
        event.custom_data.currency = 'BRL';
    }

    console.log(`🚀 [META] Enviando evento '${metaEventName}' para o Facebook...`);
    await sendToMeta(event, 2); // Slot 2 (Novibet)

    await prisma.eventLog.create({ 
      data: { type: isFtd ? "ftd" : "deposito", provider: "novibet", extra: cleanStr(data.s1) || cleanStr(data.s2) || cleanStr(data.s3) || "direto"} 
    });

    console.log(`✅ [SUCESSO] Processamento de ${metaEventName} finalizado.`);
    console.log("---------------------------------------------------------\n");

    res.json({ ok: true });
  } catch (e) { 
    console.error("❌ [ERRO FATAL DEPÓSITO]:", e.message, e.stack);
    res.status(500).json({ error: e.message }); 
  }
});
// =====================================================================
// ROTA SUPERBET (INCOME ACCESS) - PADRÃO FINAL [ACID] & [ET]
// =====================================================================
app.get("/superbet", async (req, res) => {
  try {
    const q = req.query;
    
    // LOG VISUAL (Igual da Novibet)
    console.log("\n---------------------------------------------------------");
    console.log("💰 [SUPERBET] Postback recebido.");
    console.log("📦 DADOS BRUTOS:", JSON.stringify(q, null, 2));
    
    // 1. Identifica Evento (reg ou ftd)
    const etType = safeString(q.et).toLowerCase().trim();
    
    let metaEventName = "registro_superbet"; // Padrão se for 'reg'
    let isFtd = false;

    // Se o gerente mandar 'ftd', viramos a chave para Compra
    if (etType === "ftd" || etType.includes("dep")) {
        metaEventName = "ftd_superbet"; 
        isFtd = true;
    }

    // 2. O Cruzamento: Pegamos o ID no parâmetro 'cid' (que é o [acid])
    const leadId = cleanStr(q.cid) || cleanStr(q.uid); // Mantive uid de backup
    
    // Validação de Segurança
    if (!isValidUUID(leadId)) {
        console.log(`🚫 [SUPERBET] Lead ID inválido ou ausente (cid): ${leadId}`);
        return res.json({ ok: true, filtered: true, reason: "invalid_uuid" });
    }

    // Busca no Banco (Recupera FBP, FBC do SendPulse)
    const context = await getLeadContextByAfp(leadId); 

    if (context) {
        console.log(`✅ [SUPERBET] Match confirmado para ${leadId}`);
    } else {
        console.warn(`⚠️ [SUPERBET] Sem Match no banco para ${leadId}`);
    }

    // 3. Monta o Evento pro Facebook
    // Se for FTD e não vier valor, assume R$ 30 (padrão de mercado)
    const value = parseValue(q.val) || parseValue(q.amount) || (isFtd ? 30 : 0);
    const currency = cleanStr(q.cur) || cleanStr(q.currency) || "BRL";
    
    const event_id = `superbet_${leadId}_${metaEventName}_${Math.floor(Date.now()/1000)}`;

    const event = {
      event_name: metaEventName,
      event_time: Math.floor(Date.now() / 1000),
      action_source: "website",
      event_id: event_id,
      user_data: {
        client_ip_address: context?.client_ip_address || getClientIp(req),
        client_user_agent: context?.client_user_agent || getUserAgent(req),
        fbp: context?.fbp || undefined,
        fbc: context?.fbc || undefined,
        external_id: [sha256(leadId)]
      },
      custom_data: {
        origem: "superbet",
        currency: currency,
        value: value,
        lead_id: leadId,
        income_event: etType // Guarda o que veio no 'et' para debug
      }
    };

    // 4. Envia para o Facebook (Slot 5 - Ajuste se tiver slot exclusivo)
    await sendToMeta(event, 5); 

    // 5. Log Dashboard (Sem usar coluna 'extra')
    await prisma.eventLog.create({ 
    data: { 
        type: isFtd ? "ftd" : "registro", 
        provider: "superbet", 
        extra: cleanStr(q.cid) || "direto"
    } 
}).catch(e=>{});
    
    res.json({ ok: true });

  } catch (err) {
    console.error("❌ [ERRO SUPERBET]:", err.message);
    res.status(500).json({ error: err.message });
  }
});
// ROTA PARA FTD (Primeiro Depósito)
app.post("/superbet/ftd", async (req, res) => {
  try {
    console.log("\n---------------------------------------------------------");
    console.log("💎 [SUPERBET] Novo FTD (Primeiro Depósito) recebido.");
    const data = { ...req.query, ...req.body };
    console.log("📦 DADOS BRUTOS (SUPERBET FTD):", JSON.stringify(data, null, 2));

    const leadId = cleanStr(data.s2) || cleanStr(data.s1);
    const context = await getLeadContextSmart(leadId);

    const value = parseValue(data.value) || parseValue(data.amount);
    const event_id = `ftd_superbet_${cleanStr(data.player_id) || leadId}_${Date.now()}`;

    const event = {
      event_name: "Purchase", // FTD sempre enviamos como 'Purchase' para o Meta otimizar melhor
      event_time: Math.floor(Date.now()/1000),
      action_source: "website",
      event_id: event_id,
      user_data: {
        client_ip_address: context?.client_ip_address || getClientIp(req),
        client_user_agent: context?.client_user_agent || getUserAgent(req),
        fbp: context?.fbp,
        fbc: context?.fbc,
        external_id: [sha256(leadId)]
      },
      custom_data: { 
        origem: "superbet", 
        value: value, 
        currency: "BRL", 
        lead_id: leadId,
        s1: data.s1,
        s2: data.s2
      }
    };

    console.log(`🚀 [META] Enviando 'Purchase' (FTD) para o Facebook (Slot 5)...`);
    await sendToMeta(event, 5); // SLOT 5

    await prisma.eventLog.create({ 
      data: { type: "ftd", provider: "superbet", extra: cleanStr(data.s1) || "direto" } 
    });

    res.json({ ok: true });
  } catch (e) { 
    console.error("❌ [ERRO SUPERBET FTD]:", e.message);
    res.status(500).json({ error: e.message }); 
  }
});

// =========================
// FACEBOOK ADS METRICS (N8N)
// =========================
app.post("/ads/metrics", async (req, res) => {
  try {
    const items = Array.isArray(req.body) ? req.body : [req.body];
    const extrairFunil = (campaignName) => {
  const match = (campaignName || "").toLowerCase().match(/(f[0-9]+)/);
  return match ? match[1] : null;
};
    let salvos = 0;

    for (const item of items) {
      const d = item.json || item;
      if (!d.UniqueID || !d.CampaignName) continue;

      await prisma.adMetrics.upsert({
        where: { uniqueId: d.UniqueID },
        update: {
          funil: extrairFunil(d.CampaignName),
          amountSpent: d.AmountSpent || 0,
          impressions: d.Impressions || 0,
          linkClicks: d.LinkClicks || 0,
          cpm: d.CPM || 0,
          ctr: d.CTR || 0,
        },
        create: {
          funil: extrairFunil(d.CampaignName),
          uniqueId: d.UniqueID,
          day: d.Day,
          accountId: d.AccountID || "",
          accountName: d.AccountName || "",
          campaignName: d.CampaignName,
          adsetName: d.AdSetName || "",
          adName: d.AdName || "",
          amountSpent: d.AmountSpent || 0,
          impressions: d.Impressions || 0,
          linkClicks: d.LinkClicks || 0,
          cpm: d.CPM || 0,
          ctr: d.CTR || 0,
        }
      });
      salvos++;
    }

    res.json({ ok: true, salvos });
  } catch (e) {
    console.error("❌ [ADS] Erro:", e.message);
    res.status(500).json({ error: e.message });
  }
});
app.get("/debug/ads", async (req, res) => {
  const registros = await prisma.adMetrics.findMany({ take: 5 });
  res.json(registros);
});
// =========================
// DASHBOARD DE MÉTRICAS - 3C SPORTS | PROJETO PILHADO
// =========================
app.get("/dashboard", async (req, res) => {
  try {
    const dataInicioFiltro = req.query.data_inicio || null;
    const dataFimFiltro = req.query.data_fim || null;

    const displayDate = (dateFiltro) => {
        if (!dateFiltro) return new Date().toISOString().split("T")[0];
        return dateFiltro;
    }
    const dataInicioStr = displayDate(dataInicioFiltro);
    const dataFimStr = displayDate(dataFimFiltro);

    const [anoI, mesI, diaI] = dataInicioStr.split("-");
    const dataInicioExibida = `${diaI}/${mesI}/${anoI}`;
    const [anoF, mesF, diaF] = dataFimStr.split("-");
    const dataFimExibida = `${diaF}/${mesF}/${anoF}`;

    const { totais, adsPorFunil, eventosPorFunil } = await buscarDadosDashboard(dataInicioFiltro, dataFimFiltro);

    const formatBRL = (valor) => {
      const num = parseFloat(valor) || 0;
      return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    };

    // --- CÁLCULO DOS KPIs GERAIS ---
    let kpiGasto = 0;
    let kpiStarts = 0;
    let kpiRegistros = 0;
    let kpiFtds = 0;

    adsPorFunil.forEach(a => { 
        kpiGasto += parseFloat(a.gasto || 0); 
        const ev = eventosPorFunil[a.funil] || { start: 0, registro: 0, ftd: 0 };
        kpiStarts += ev.start;
        kpiRegistros += ev.registro;
        kpiFtds += ev.ftd;
    });

    const kpiCustoFtdNum = kpiFtds > 0 ? (kpiGasto / kpiFtds) : 0;

    // --- TABELA 1: EVENTOS BRUTOS ---
    const linhasTabela = totais.map(item => `
      <tr class="hover:bg-gray-50 transition-colors border-b border-gray-100">
        <td class="px-6 py-4 whitespace-nowrap">
          <span class="px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-800">
            ${item.provider === 'sendpulse' ? '📱' : '🎰'} ${item.provider.toUpperCase()}
          </span>
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
          ${item.evento} 
          ${item.subOrigem ? `<span class="ml-2 px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-500 border border-gray-200">🎯 ${item.subOrigem}</span>` : ''}
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-bold">
          ${item.contagem}
        </td>
      </tr>
    `).join('');

    // --- TABELAS 2 E 3: ADS E TAXAS ---
    let linhasAds = "";
    let linhasTaxas = "";

    adsPorFunil.forEach(a => {
      const ev = eventosPorFunil[a.funil] || { start: 0, registro: 0, ftd: 0 };
      const gasto = parseFloat(a.gasto);
      
      const cStartNum = ev.start > 0 ? (gasto / ev.start) : 0;
      const cRegNum = ev.registro > 0 ? (gasto / ev.registro) : 0;
      const cFtdNum = ev.ftd > 0 ? (gasto / ev.ftd) : 0;

      const txStartReg = ev.start > 0 ? ((ev.registro / ev.start) * 100).toFixed(2) : "0.00";
      const txRegFtd = ev.registro > 0 ? ((ev.ftd / ev.registro) * 100).toFixed(2) : "0.00";
      const txStartFtd = ev.start > 0 ? ((ev.ftd / ev.start) * 100).toFixed(2) : "0.00";
      
      linhasAds += `
        <tr class="hover:bg-gray-50 transition-colors border-b border-gray-100">
          <td class="px-4 py-4 whitespace-nowrap text-sm font-bold text-gray-900 uppercase">🎯 ${a.funil}</td>
          <td class="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-800">${formatBRL(gasto)}</td>
          <td class="px-4 py-4 whitespace-nowrap text-sm text-gray-600">${a.impressoes.toLocaleString('pt-BR')}</td>
          <td class="px-4 py-4 whitespace-nowrap text-sm text-gray-600">${a.cliques.toLocaleString('pt-BR')}</td>
          <td class="px-4 py-4 whitespace-nowrap text-sm text-gray-600">${a.ctr}%</td>
          <td class="px-4 py-4 whitespace-nowrap text-sm text-gray-600">${formatBRL(a.cpm)}</td>
          
          <td class="px-4 py-4 whitespace-nowrap text-sm font-semibold text-gray-800 bg-blue-50/30">${ev.start}</td>
          <td class="px-4 py-4 whitespace-nowrap text-sm font-semibold text-gray-800 bg-blue-50/30">${ev.registro}</td>
          <td class="px-4 py-4 whitespace-nowrap text-sm font-bold text-emerald-600 bg-emerald-50/30">${ev.ftd}</td>
          
          <td class="px-4 py-4 whitespace-nowrap text-sm text-gray-600">${ev.start > 0 ? formatBRL(cStartNum) : '-'}</td>
          <td class="px-4 py-4 whitespace-nowrap text-sm text-gray-600">${ev.registro > 0 ? formatBRL(cRegNum) : '-'}</td>
          <td class="px-4 py-4 whitespace-nowrap text-sm font-bold ${cFtdNum > 50 ? 'text-red-600' : 'text-emerald-600'}">${ev.ftd > 0 ? formatBRL(cFtdNum) : '-'}</td>
        </tr>
      `;

      linhasTaxas += `
        <tr class="border-b border-gray-50 hover:bg-gray-50 transition-colors">
          <td class="px-4 py-2 whitespace-nowrap text-xs font-bold text-gray-800 uppercase">${a.funil}</td>
          <td class="px-4 py-2 whitespace-nowrap text-xs font-medium text-gray-600">${txStartReg}%</td>
          <td class="px-4 py-2 whitespace-nowrap text-xs font-medium text-gray-600">${txRegFtd}%</td>
          <td class="px-4 py-2 whitespace-nowrap text-xs font-bold text-indigo-600">${txStartFtd}%</td>
        </tr>
      `;
    });

    // --- HTML FINAL ---
    const html = `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>3C Sports | Analytics</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Montserrat:wght@800;900&display=swap" rel="stylesheet">
        <style>
          body { font-family: 'Inter', sans-serif; background-color: #f8f9fa; color: #111; }
          .font-logo { font-family: 'Montserrat', sans-serif; letter-spacing: -0.05em; }
          ::-webkit-scrollbar { height: 8px; width: 8px; }
          ::-webkit-scrollbar-track { background: #f1f1f1; border-radius: 4px; }
          ::-webkit-scrollbar-thumb { background: #c1c1c1; border-radius: 4px; }
          ::-webkit-scrollbar-thumb:hover { background: #a8a8a8; }
          /* Setup do acordeão das observações */
          details > summary { list-style: none; }
          details > summary::-webkit-details-marker { display: none; }
        </style>
      </head>
      <body class="antialiased flex flex-col min-h-screen">
        
        <header class="bg-[#0a0a0a] text-white shadow-lg border-b border-gray-800">
          <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col sm:flex-row justify-between items-center">
            
            <div class="flex items-center gap-2">
              <h1 class="flex items-center">
                <span class="font-logo font-black text-4xl tracking-tighter text-white">3C</span>
                <span class="font-logo font-extrabold text-2xl ml-1 text-white">Sports</span>
                <span class="text-gray-400 font-light hidden md:inline text-lg ml-3 border-l border-gray-700 pl-3">Projeto Pilhado - Tráfego.</span>
              </h1>
            </div>
            
            <form method="GET" action="/dashboard" class="mt-4 sm:mt-0 flex flex-col sm:flex-row items-center gap-3 bg-gray-900 p-2 rounded-lg border border-gray-700">
              <div class="flex items-center gap-2">
                  <label class="text-xs text-gray-400 font-medium">De:</label>
                  <input type="date" name="data_inicio" value="${dataInicioStr}"
                    class="bg-black text-white border border-gray-700 rounded-md px-3 py-1.5 text-sm focus:ring-1 focus:ring-gray-400 outline-none color-scheme-dark">
              </div>
              <div class="flex items-center gap-2">
                  <label class="text-xs text-gray-400 font-medium">Até:</label>
                  <input type="date" name="data_fim" value="${dataFimStr}"
                    class="bg-black text-white border border-gray-700 rounded-md px-3 py-1.5 text-sm focus:ring-1 focus:ring-gray-400 outline-none color-scheme-dark">
              </div>
              <button type="submit" class="bg-gray-100 hover:bg-white text-black font-bold px-5 py-2 rounded-md text-sm transition-colors shadow-sm w-full sm:w-auto">
                Filtrar
              </button>
            </form>
          </div>
        </header>

        <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6 flex-grow">
          
          <h2 class="text-lg text-center text-gray-500 font-medium">Resumo do Período: <span class="font-bold text-gray-800">${dataInicioExibida}</span> a <span class="font-bold text-gray-800">${dataFimExibida}</span></h2>

          <div class="grid grid-cols-2 lg:grid-cols-5 gap-4">
            
            <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex items-center gap-4">
              <div class="bg-gray-100 p-2.5 rounded-lg"><span class="text-lg">💸</span></div>
              <div class="min-w-0">
                <p class="text-[10px] md:text-xs font-bold text-gray-500 uppercase tracking-wide">Total Gasto (Ads)</p>
                <p class="text-lg md:text-xl font-bold text-gray-900 mt-0.5">${formatBRL(kpiGasto)}</p>
              </div>
            </div>

            <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex items-center gap-4">
              <div class="bg-gray-100 p-2.5 rounded-lg"><span class="text-lg">🚀</span></div>
              <div class="min-w-0">
                <p class="text-[10px] md:text-xs font-bold text-gray-500 uppercase tracking-wide">Total Starts</p>
                <p class="text-lg md:text-xl font-bold text-gray-900 mt-0.5">${kpiStarts}</p>
              </div>
            </div>

            <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex items-center gap-4">
              <div class="bg-gray-100 p-2.5 rounded-lg"><span class="text-lg">📝</span></div>
              <div class="min-w-0">
                <p class="text-[10px] md:text-xs font-bold text-gray-500 uppercase tracking-wide">Total Cadastros</p>
                <p class="text-lg md:text-xl font-bold text-gray-900 mt-0.5">${kpiRegistros}</p>
              </div>
            </div>

            <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex items-center gap-4">
              <div class="bg-gray-100 p-2.5 rounded-lg"><span class="text-lg">💎</span></div>
              <div class="min-w-0">
                <p class="text-[10px] md:text-xs font-bold text-gray-500 uppercase tracking-wide">Total FTDs</p>
                <p class="text-lg md:text-xl font-bold text-emerald-600 mt-0.5">${kpiFtds}</p>
              </div>
            </div>

            <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex items-center gap-4 col-span-2 lg:col-span-1">
              <div class="bg-gray-100 p-2.5 rounded-lg"><span class="text-lg">🎯</span></div>
              <div class="min-w-0">
                <p class="text-[10px] md:text-xs font-bold text-gray-500 uppercase tracking-wide">CPA Médio (FTD)</p>
                <p class="text-lg md:text-xl font-bold text-gray-900 mt-0.5">${formatBRL(kpiCustoFtdNum)}</p>
              </div>
            </div>

          </div>

          <div class="bg-white shadow-sm rounded-xl border border-gray-200 overflow-hidden">
            <div class="px-6 py-4 border-b border-gray-200 bg-gray-50">
              <h3 class="text-base font-bold text-gray-800 uppercase tracking-wide">📊 Performance por Funil</h3>
            </div>
            <div class="overflow-x-auto">
              ${adsPorFunil.length > 0 ? `
              <table class="min-w-full divide-y divide-gray-200">
                <thead class="bg-gray-50 whitespace-nowrap">
                  <tr>
                    <th class="px-4 py-3 text-left text-xs font-bold text-gray-900 uppercase">Funil</th>
                    <th class="px-4 py-3 text-left text-xs font-bold text-gray-900 uppercase">Gasto</th>
                    <th class="px-4 py-3 text-left text-xs font-bold text-gray-900 uppercase">Impr.</th>
                    <th class="px-4 py-3 text-left text-xs font-bold text-gray-900 uppercase">Cliques</th>
                    <th class="px-4 py-3 text-left text-xs font-bold text-gray-900 uppercase">CTR (%)</th>
                    <th class="px-4 py-3 text-left text-xs font-bold text-gray-900 uppercase">CPM</th>
                    <th class="px-4 py-3 text-left text-xs font-bold text-gray-900 uppercase bg-blue-50/50">Start</th>
                    <th class="px-4 py-3 text-left text-xs font-bold text-gray-900 uppercase bg-blue-50/50">Reg</th>
                    <th class="px-4 py-3 text-left text-xs font-bold text-emerald-600 uppercase bg-emerald-50/50">FTD</th>
                    <th class="px-4 py-3 text-left text-xs font-bold text-gray-900 uppercase">CPA Start</th>
                    <th class="px-4 py-3 text-left text-xs font-bold text-gray-900 uppercase">CPA Reg</th>
                    <th class="px-4 py-3 text-left text-xs font-bold text-gray-900 uppercase">CPA FTD</th>
                  </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-100">
                  ${linhasAds}
                </tbody>
              </table>
              ` : `<div class="text-center py-12"><p class="text-sm text-gray-500">Nenhuma métrica de tráfego importada.</p></div>`}
            </div>
          </div>

          ${adsPorFunil.length > 0 ? `
          <div class="bg-white shadow-sm rounded-xl border border-gray-200 overflow-hidden max-w-2xl">
            <div class="px-6 py-3 border-b border-gray-200 bg-gray-50">
              <h3 class="text-sm font-bold text-gray-700 uppercase">📉 Taxas de Conversão do Funil</h3>
            </div>
            <div class="overflow-x-auto">
              <table class="min-w-full divide-y divide-gray-200">
                <thead class="bg-gray-50 whitespace-nowrap">
                  <tr>
                    <th class="px-4 py-2 text-left text-xs font-bold text-gray-500 uppercase">Funil</th>
                    <th class="px-4 py-2 text-left text-xs font-bold text-gray-500 uppercase">Entrada > Registro</th>
                    <th class="px-4 py-2 text-left text-xs font-bold text-gray-500 uppercase">Registro > FTD</th>
                    <th class="px-4 py-2 text-left text-xs font-bold text-gray-500 uppercase">Entrada > FTD</th>
                  </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-50">
                  ${linhasTaxas}
                </tbody>
              </table>
            </div>
          </div>
          ` : ''}

          <div class="bg-white shadow-sm rounded-xl border border-gray-200 overflow-hidden opacity-90 mt-8">
            <div class="px-6 py-4 border-b border-gray-200">
              <h3 class="text-base font-bold text-gray-800 uppercase tracking-wide">📡 Log Geral de Eventos</h3>
            </div>
            <div class="overflow-x-auto">
              ${totais.length > 0 ? `
              <table class="min-w-full divide-y divide-gray-200">
                <thead class="bg-gray-50 whitespace-nowrap">
                  <tr>
                    <th class="px-6 py-3 text-left text-xs font-bold text-gray-900 uppercase">Plataforma</th>
                    <th class="px-6 py-3 text-left text-xs font-bold text-gray-900 uppercase">Nome do Evento</th>
                    <th class="px-6 py-3 text-left text-xs font-bold text-gray-900 uppercase">Quantidade</th>
                  </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-200">
                  ${linhasTabela}
                </tbody>
              </table>
              ` : `<div class="text-center py-12"><p class="text-sm text-gray-500">Nenhum evento registrado.</p></div>`}
            </div>
          </div>

          <div class="bg-white shadow-sm rounded-xl border border-gray-200 overflow-hidden mt-8">
            <details class="group">
              <summary class="flex items-center justify-between px-6 py-4 cursor-pointer bg-gray-50 hover:bg-gray-100 transition-colors list-none outline-none">
                <span class="text-sm font-bold text-gray-700 uppercase flex items-center gap-2">📝 Observações e Notas Técnicas</span>
                <span class="text-gray-400 group-open:rotate-180 transition-transform duration-200 text-xs">▼ Expandir</span>
              </summary>
              <div class="p-6 text-sm text-gray-600 border-t border-gray-200 bg-white">
                <ul class="list-disc pl-5 space-y-2">
                  <li><strong>01/03/2026:</strong> Evento de FTD começou a marcar perfeitamente na Novibet.</li>
                  <li><strong>02/03/2026:</strong> Link do funil F03 ajustado para passar S2 (agora as tags chegam completas).</li>
                  <li><strong>Superbet:</strong> Operando isolado no Slot 5 do Meta.</li>
                </ul>
              </div>
            </details>
          </div>

        </main>
      </body>
      </html>
    `;

    res.send(html);

  } catch (e) {
    res.status(500).send(`<div style="padding: 40px; text-align: center; color: red;"><h1>Erro no Dashboard</h1><p>${e.message}</p></div>`);
  }
});

app.get("/relatorio", async (req, res) => {
  try {
    const { totais } = await buscarDadosDashboard();
    res.json({ ok: true, stats: totais });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`🚀 v2.0.0 listening on port ${port}`);
});
