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

// =========================
// RELATÓRIO GERAL (VERSÃO CORRIGIDA PARA O DASHBOARD)
// =========================
async function relatorioGeral() {
  try {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const stats = await prisma.eventLog.groupBy({
      by: ['type', 'provider'],
      where: { createdAt: { gte: hoje } },
      _count: { type: true },
      orderBy: [{ provider: 'asc' }, { type: 'asc' }]
    });

    const dataFormatada = hoje.toLocaleDateString('pt-BR');
    console.log(`\n📊 === RESUMO DO DIA (${dataFormatada}) ===`);

    // ✅ SEMPRE retorna um objeto com 'totais' sendo um array
    if (!stats || stats.length === 0) {
      console.log("Nenhum evento registrado hoje ainda.");
      return { hoje: dataFormatada, totais: [] };
    }

     const totais = stats.map(s => ({
      provider: s.provider,
      evento: s.type,
      subOrigem: s.extra || "", // Capturamos o s1 aqui
      contagem: s._count.type
    }));

    // Logs no console
    const sp = totais.filter(s => s.provider === 'sendpulse');
    const novi = totais.filter(s => s.provider === 'novibet');
    if (sp.length > 0) {
      console.log("📱 [SENDPULSE]");
      sp.forEach(s => console.log(`   - ${s.evento.padEnd(25)}: ${s.contagem}`));
    }
    if (novi.length > 0) {
      console.log("🎰 [NOVIBET]");
      novi.forEach(s => console.log(`   - ${s.evento.padEnd(25)}: ${s.contagem}`));
    }
    console.log("=================================================\n");

    return { hoje: dataFormatada, totais: totais };

  } catch (e) {
    console.error("❌ Erro no relatório:", e.message);
    return { hoje: new Date().toLocaleDateString('pt-BR'), totais: [], error: e.message };
  }
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
  
  bilhete_superbet: {
    event_name: "Bilhete_Superbet",
    extra_custom_data: { origem: "whatsapp", produto: "bilhete_superbet" }
  },
   lead_novi_spodd06: {
    event_name: "lead_novi_spodd06",
    extra_custom_data: { origem: "whatsapp", versao: "spodd06" }
  },
   entrou_vip: { 
    event_name: "NOVI_GOA", 
    extra_custom_data: { origem: "whatsapp", versao: "goa_v1" } 
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

async function getLeadContextSmart(afp, playerId) {
  try {
    if (afp && afp.length > 5) {
       const context = await prisma.leadContext.findUnique({ where: { lead_id: afp } });
       if (context) return context;
    }
    return null;
  } catch (e) {
    // AGORA ELE AVISA DO ERRO!
    console.error(`❌ [getLeadContextSmart] Erro CRÍTICO ao buscar contexto para afp ${afp} / playerId ${playerId}:`, e.message);
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

// =========================
// ESPORTIVABET
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

// =====================================================================
// NOVIBET REGISTRO (AGORA COM FILTRO DE QUALIDADE)
// =====================================================================
app.post("/novibet/registro", async (req, res) => {
  try {
    console.log("\n---------------------------------------------------------");
    console.log("🚨 [SISTEMA] NOVO REGISTRO DETECTADO NA PORTA");
    const data = { ...req.query, ...req.body };
    console.log("📦 DADOS BRUTOS RECEBIDOS (REGISTRO):", JSON.stringify(data, null, 2));

           // ✅ FILTRO DE QUALIDADE: Procura "pilhado" em qualquer um dos campos (s1, s2 ou s3)
    const buscaPilhado = `${data.s1 || ''}${data.s2 || ''}${data.s3 || ''}`;
    if (!buscaPilhado.toLowerCase().includes("pilhado")) {
      console.log(`🚫 [FILTRO NOVIBET] Registro ignorado. Identificador "pilhado" não encontrado.`);
      console.log(`📦 DADOS: s1:${data.s1} | s2:${data.s2} | s3:${data.s3}`);
      return res.json({ ok: true, filtered: true, reason: "identifier_not_found" });
    }
    console.log(`✅ [FILTRO NOVIBET] Registro APROVADO! Processando...`);
    console.log("---------------------------------------------------------\n");

    const afpKey = cleanStr(data.s1) || cleanStr(data.s2) || cleanStr(data.tracking_tag) || "";
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
    await prisma.eventLog.create({ data: { type: "registro", provider: "novibet", extra: cleanStr(data.s1) || "direto" } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// =====================================================================
// NOVIBET DEPOSITO (AGORA COM FILTRO DE QUALIDADE)
// =====================================================================
app.post("/novibet/deposito", async (req, res) => {
  try {
    console.log("\n---------------------------------------------------------");
    console.log("💰 [SISTEMA] NOVO DEPÓSITO DETECTADO NA PORTA");
    const data = { ...req.query, ...req.body };
    console.log("📦 DADOS BRUTOS RECEBIDOS (DEPÓSITO):", JSON.stringify(data, null, 2));

        // ✅ FILTRO DE QUALIDADE: Procura "pilhado" em qualquer um dos campos (s1, s2 ou s3)
    const buscaPilhado = `${data.s1 || ''}${data.s2 || ''}${data.s3 || ''}`;
    if (!buscaPilhado.toLowerCase().includes("pilhado")) {
      console.log(`🚫 [FILTRO NOVIBET] Registro ignorado. Identificador "pilhado" não encontrado.`);
      console.log(`📦 DADOS: s1:${data.s1} | s2:${data.s2} | s3:${data.s3}`);
      return res.json({ ok: true, filtered: true, reason: "identifier_not_found" });
    }
    console.log(`✅ [FILTRO NOVIBET] Depósito APROVADO! Processando...`);
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
    await prisma.eventLog.create({ data: { type: isFtd ? "ftd" : "deposito", provider: "novibet", extra: cleanStr(data.s1) || "direto" } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// =========================
// DASHBOARD DE MÉTRICAS DO DIA
// =========================
app.get("/dashboard", async (req, res) => {
  try {
    const { hoje, totais, error } = await relatorioGeral();

    if (error) {
      return res.status(500).send(`<h1>Erro ao gerar dashboard</h1><p>${error}</p>`);
    }

    // Monta as linhas da tabela HTML
       const linhasTabela = totais.map(item => `
      <tr>
        <td>${item.provider === 'sendpulse' ? '📱' : '🎰'} ${item.provider.toUpperCase()}</td>
        <td>${item.evento} ${item.subOrigem ? `  
<small style="color: #3498db;"><b>Funil:</b> ${item.subOrigem}</small>` : ''}</td>
        <td>${item.contagem}</td>
      </tr>
    `).join('');

    // Monta a página HTML completa
    const html = `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Dashboard de Eventos</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #f4f7f6; color: #333; margin: 0; padding: 20px; }
          .container { max-width: 800px; margin: 20px auto; background: #fff; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); overflow: hidden; }
          h1 { text-align: center; padding: 20px; background-color: #2c3e50; color: #fff; margin: 0; }
          h2 { text-align: center; color: #7f8c8d; font-weight: normal; }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 15px; text-align: left; border-bottom: 1px solid #ddd; }
          th { background-color: #ecf0f1; font-weight: bold; }
          tr:hover { background-color: #f9f9f9; }
          .no-data { text-align: center; padding: 40px; color: #95a5a6; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Dashboard de Eventos</h1>
          <h2>Resumo do Dia: ${hoje}</h2>
          ${totais.length > 0 ? `
            <table>
              <thead>
                <tr>
                  <th>Fonte</th>
                  <th>Evento</th>
                  <th>Contagem</th>
                </tr>
              </thead>
              <tbody>
                ${linhasTabela}
              </tbody>
            </table>
          ` : `<p class="no-data">Nenhum evento registrado hoje ainda.</p>`}
        </div>
      </body>
      </html>
    `;

    res.send(html);

  } catch (e) {
    res.status(500).send(`<h1>Erro inesperado ao construir a página</h1><p>${e.message}</p>`);
  }
});

app.get("/relatorio", async (req, res) => {
  try {
    const { totais } = await relatorioGeral();
    res.json({ ok: true, stats: totais });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`🚀 v2.0.0 listening on port ${port}`);
});
