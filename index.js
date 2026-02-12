// =====================================================================
// ✅ VERSÃO FINAL ESTÁVEL (V3.1)
// - Banco de Dados: Modo Seguro (Não tenta salvar colunas que não existem)
// - Rastreamento: Lê afp, s2, tracking_tag, t1 (não perde nada)
// - Facebook: Envia s1, s2, s3, c1... no custom_data
// - Eventos: Registro_novibet, deposito_novibet, ftd_novibet
// =====================================================================

import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const app = express();

app.set("trust proxy", true);
app.use(express.json({ limit: "2mb" }));

// =========================
// CONFIGURAÇÃO PIXELS
// =========================
const META_API_VERSION = process.env.META_API_VERSION || "v20.0";
const DEFAULT_ACTION_SOURCE = "website";

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

// Mapas de Eventos
const EVENT_SLOT_MAP = {
  bilhete_vupibet: 1, bilhete_novibet: 2, 
  bilhete_esportivabet: 3, bilhete_esportivabet2: 4, bilhete_mgm: 5
};

const NOVIBET_EVENT_MAP = { 
  registro: "Registro_novibet", 
  deposito: "deposito_novibet", 
  ftd: "ftd_novibet" 
};

// =========================
// HELPERS
// =========================
function isValidUUID(value) {
  if (!value || typeof value !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function sha256(str) { return str ? crypto.createHash("sha256").update(String(str)).digest("hex") : undefined; }
function safeString(v) { return (v === null || v === undefined) ? "" : String(v); }
function cleanStr(v) { const s = (v ?? "").toString().trim(); return s.length ? s : undefined; }
function parseValue(v) { const n = Number(String(v).replace(",", ".")); return Number.isFinite(n) ? n : undefined; }

function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) return safeString(xff).split(",")[0].trim();
  return safeString(req.ip || req.connection?.remoteAddress || "");
}
function getUserAgent(req) { return safeString(req.headers["user-agent"] || ""); }

// --- PLACAR SIMPLES (Seguro) ---
async function placarSimples() {
  try {
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const count = await prisma.eventLog.count({ where: { provider: "novibet", type: "registro", createdAt: { gte: hoje } } });
    console.log(`\n📊 [PLACAR HOJE] Novibet Registros: ${count}\n`);
  } catch (e) {}
}

// --- BUSCA LEAD (Segura: Pelo AFP ou LeadID) ---
async function getLeadContextByAfp(afp) {
  if (!afp || afp.length < 5) return null;
  try {
    // Busca na coluna AFP (que existe no banco original)
    const context = await prisma.leadContext.findFirst({ where: { afp } });
    if (context) console.log(`✅ [MATCH] Contexto encontrado: ${afp}`);
    return context;
  } catch (err) { return null; }
}

// --- ENVIO META ---
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
    try { results.master = await sendToPixel(event, PIXEL_MASTER.id, PIXEL_MASTER.token); } catch (e) { results.master = { error: e.message }; }
  }
  if (slotNumber && PIXEL_SLOTS[slotNumber]) {
    try { results.slot = await sendToPixel(event, PIXEL_SLOTS[slotNumber].id, PIXEL_SLOTS[slotNumber].token); } catch (e) { results.slot = { error: e.message }; }
  }
  return results;
}

// =========================
// ROTA SP (Mantida para salvar o Lead Inicial)
// =========================
app.post("/sp/event", async (req, res) => {
  try {
    const eventKey = safeString(req.query.e).toLowerCase();
    const slotNumber = parseInt(req.query.slot) || EVENT_SLOT_MAP[eventKey] || null;
    const body = Array.isArray(req.body) ? req.body[0] : req.body;
    const vars = body?.contact?.variables || {};
    const leadId = vars.lead_id || crypto.randomUUID();
    
    // Salva no Banco (Schema Original)
    await prisma.leadContext.upsert({
      where: { lead_id: leadId },
      update: { 
        afp: leadId, // Garante que o AFP seja o LeadID
        fbp: cleanStr(vars.fbp), fbc: cleanStr(vars.fbc), fbclid: cleanStr(vars.fbclid),
        utm_source: cleanStr(vars.utm_source), client_ip_address: getClientIp(req), client_user_agent: getUserAgent(req)
      },
      create: { 
        lead_id: leadId, afp: leadId,
        fbp: cleanStr(vars.fbp), fbc: cleanStr(vars.fbc), fbclid: cleanStr(vars.fbclid),
        utm_source: cleanStr(vars.utm_source), client_ip_address: getClientIp(req), client_user_agent: getUserAgent(req)
      }
    });

    const event = {
      event_name: "Lead_Generic", // Ou mapear do EVENT_MAP
      event_time: Math.floor(Date.now() / 1000),
      action_source: DEFAULT_ACTION_SOURCE,
      user_data: {
        external_id: vars.telegram_id ? sha256(vars.telegram_id) : undefined,
        client_ip_address: getClientIp(req), client_user_agent: getUserAgent(req),
        fbp: cleanStr(vars.fbp), fbc: cleanStr(vars.fbc)
      },
      custom_data: { lead_id: leadId, ...vars }
    };

    const metaResp = await sendToMeta(event, slotNumber);
    res.json({ ok: true, meta: metaResp });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// =========================
// 1. NOVIBET REGISTRO
// =========================
app.post("/novibet/registro", async (req, res) => {
  try {
    console.log("🔥 /novibet/registro");
    const data = { ...req.query, ...req.body };

    // Captura ID (Tenta tudo)
    const afpKey = cleanStr(data.tracking_tag) || cleanStr(data.t1) || cleanStr(data.s2) || cleanStr(data.afp) || cleanStr(data.click_id) || "";
    const playerId = cleanStr(data.player_id) || cleanStr(data.registration_id);

    // Se não tem ID, ignora
    if (!afpKey && !playerId) return res.json({ ok: true, filtered: true });

    // Busca contexto
    const context = await getLeadContextByAfp(afpKey);

    const event = {
      event_name: NOVIBET_EVENT_MAP.registro, // "Registro_novibet"
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
        // ✅ REPASSA AS TAGS QUE VOCÊ PEDIU
        s1: cleanStr(data.s1),
        s2: cleanStr(data.s2),
        s3: cleanStr(data.s3),
        c1: cleanStr(data.c1),
        utm_source: context?.utm_source || cleanStr(data.utm_source) 
      }
    };

    const metaResp = await sendToMeta(event, 2);
    await prisma.eventLog.create({ data: { type: "registro", provider: "novibet" } });
    placarSimples();

    res.json({ ok: true, meta: metaResp });
  } catch (e) { 
    console.error("Erro Reg:", e.message); 
    res.status(500).json({ error: e.message }); 
  }
});

// =========================
// 2. NOVIBET DEPÓSITO
// =========================
app.post("/novibet/deposito", async (req, res) => {
  try {
    console.log("🔥 /novibet/deposito");
    const data = { ...req.query, ...req.body };

    const afpKey = cleanStr(data.tracking_tag) || cleanStr(data.t1) || cleanStr(data.s2) || cleanStr(data.afp) || "";
    const playerId = cleanStr(data.player_id) || cleanStr(data.registration_id);

    const context = await getLeadContextByAfp(afpKey);

    // Verifica se é FTD baseado no que a Novibet diz (Mais seguro agora)
    const isFtd = data.is_ftd === "true" || data.is_ftd === true || data.status === "ftd" || data.ev === "ftd";
    
    // Escolhe o nome do evento (conforme seu padrão original)
    const metaEventName = isFtd ? NOVIBET_EVENT_MAP.ftd : NOVIBET_EVENT_MAP.deposito;
    
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
        tipo: isFtd ? "ftd" : "redeposito", 
        value: value, 
        currency: "BRL",
        // ✅ REPASSA AS TAGS AQUI TAMBÉM
        s1: cleanStr(data.s1),
        s2: cleanStr(data.s2),
        s3: cleanStr(data.s3),
        c1: cleanStr(data.c1),
        utm_source: context?.utm_source || cleanStr(data.utm_source)
      }
    };

    const metaResp = await sendToMeta(event, 2);
    await prisma.eventLog.create({ data: { type: isFtd ? "ftd" : "redeposito", provider: "novibet" } });
    placarSimples();

    res.json({ ok: true, type: isFtd ? "ftd" : "redeposito", meta: metaResp });
  } catch (e) { 
    console.error("Erro Dep:", e.message); 
    res.status(500).json({ error: e.message }); 
  }
});

// =========================
// 3. SMARTICO & ESPORTIVABET (Mantidos)
// =========================
app.get("/esportivabet/postback", async (req, res) => {
  try {
    const q = req.query;
    const evKey = safeString(q.ev).toLowerCase().trim();
    const slotNumber = parseInt(q.slot) || 3;
    const afpKey = cleanStr(q.afp);
    
    if (!isValidUUID(afpKey)) return res.json({ ok: true, filtered: true });
    
    const context = await getLeadContextByAfp(afpKey);
    const metaEventName = { registro: "Registro_esportivabet", ftd: "ftd_esportivabet", deposito: "deposito_esportivabet" }[evKey] || "Generic";
    
    const event = {
      event_name: metaEventName,
      event_time: Math.floor(Date.now()/1000),
      action_source: "website",
      user_data: {
        client_ip_address: context?.client_ip_address || getClientIp(req),
        fbp: context?.fbp || cleanStr(q.fbp),
        fbc: context?.fbc || cleanStr(q.fbc)
      },
      custom_data: { origem: "smartico", ...q }
    };
    
    const metaResp = await sendToMeta(event, slotNumber);
    res.json({ ok: true, meta: metaResp });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/smartico/postback", async (req, res) => {
  // Mantido endpoint Smartico para Vupibet (Slot 1)
  res.redirect(307, `/esportivabet/postback?slot=1&${new URLSearchParams(req.query).toString()}`);
});

// --- ROTA HEALTH ---
app.get("/", (req, res) => res.send("SP Meta CAPI v3.1 (Stable + Tags)"));
app.get("/health", (req, res) => res.json({ok: true}));

app.listen(process.env.PORT || 10000, () => console.log("🚀 Servidor Rodando (V3.1)"));
