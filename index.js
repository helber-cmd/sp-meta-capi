import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";

const app = express();
app.use(express.json({ limit: "2mb" }));

// =========================
// ENV (Render -> Environment)
// =========================
const PIXEL_ID = process.env.META_PIXEL_ID;
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;

// (opcional) se quiser um "code" de segurança no webhook
// no Render: SP_WEBHOOK_SECRET=algum_texto
const WEBHOOK_SECRET = process.env.SP_WEBHOOK_SECRET || "";

// =========================
// Helpers
// =========================
function sha256(value) {
  if (!value) return undefined;
  const v = String(value).trim().toLowerCase();
  if (!v) return undefined;
  return crypto.createHash("sha256").update(v).digest("hex");
}

/**
 * Extrai variáveis do payload do SendPulse Telegram (o que você viu no webhook.site)
 */
function extractSendPulse(body) {
  const item = Array.isArray(body) ? body[0] : body;

  const contact = item?.contact || {};
  const vars = contact?.variables || {};
  const telegram_id =
    item?.last_message_data?.telegram_id ||
    item?.last_message_data?.message?.chat_id ||
    item?.last_message_data?.chat_id ||
    "";

  // dados úteis
  const name = contact?.name || "";
  const username = contact?.username || "";

  return { item, contact, vars, telegram_id, name, username };
}

/**
 * Dispara evento para Meta CAPI
 */
async function sendToMeta(event) {
  if (!PIXEL_ID || !ACCESS_TOKEN) {
    throw new Error(
      `Missing env vars: META_PIXEL_ID or META_ACCESS_TOKEN (PIXEL_ID=${!!PIXEL_ID}, TOKEN=${!!ACCESS_TOKEN})`
    );
  }

  const url = `https://graph.facebook.com/v20.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: [event] }),
  });

  const json = await res.json();

  if (!res.ok) {
    throw new Error(`Meta API error: ${JSON.stringify(json)}`);
  }

  return json;
}

/**
 * Monta um event_id estável (pra deduplicação)
 * Se você já manda lead_id, usamos ele. Caso não, geramos.
 */
function getEventId(vars, fallback) {
  return vars?.lead_id || vars?.event_id || fallback;
}

/**
 * IP/UA: como o SendPulse não manda IP/UA do navegador,
 * usamos placeholders mínimos. Isso é OK pro início.
 */
function buildUserData({ vars, telegram_id, name, username }) {
  // Importante: não inventar dados. Só o que você tem.
  // Como você não tem email/phone, a gente usa external_id.
  // fbp/fbc ajudam MUITO no match.
  const user_data = {
    external_id: [sha256(telegram_id || username || name || "unknown")].filter(Boolean),
    fbp: vars?.fbp || undefined,
    fbc: vars?.fbc || undefined,
  };

  // Remove undefined
  Object.keys(user_data).forEach((k) => user_data[k] === undefined && delete user_data[k]);
  return user_data;
}

/**
 * (Opcional) valida segredo simples do webhook
 * Você pode enviar ?secret=XXXX na URL do SendPulse
 */
function checkSecret(req) {
  if (!WEBHOOK_SECRET) return true; // sem segredo configurado -> não valida
  const secret = req.query?.secret;
  return secret && secret === WEBHOOK_SECRET;
}

// =========================
// Rotas
// =========================
app.get("/health", (req, res) => {
  res.json({ ok: true, service: "sp-meta-capi" });
});

/**
 * LEAD - Telegram
 * Conecte o SendPulse aqui:
 * POST https://SEU_RENDER.onrender.com/sp/lead
 */
app.post("/sp/lead", async (req, res) => {
  try {
    console.log("==================================================");
    console.log("🔥 /sp/lead WEBHOOK RECEBIDO");
    console.log("🕒", new Date().toISOString());
    console.log("📦 BODY:", JSON.stringify(req.body, null, 2));

    if (!checkSecret(req)) {
      console.log("⛔ Secret inválido");
      return res.status(401).json({ ok: false, error: "invalid secret" });
    }

    const { vars, telegram_id, name, username } = extractSendPulse(req.body);

    const now = Math.floor(Date.now() / 1000);
    const fallbackEventId = crypto.randomUUID();
    const event_id = getEventId(vars, fallbackEventId);

    const event = {
      event_name: "Lead",
      event_time: now,
      action_source: "chat",
      event_id,
      user_data: buildUserData({ vars, telegram_id, name, username }),
      custom_data: {
        // UTMs para análise
        utm_source: vars?.utm_source,
        utm_medium: vars?.utm_medium,
        utm_campaign: vars?.utm_campaign,
        utm_content: vars?.utm_content,
        fbclid: vars?.fbclid,
        telegram_id,
        username,
      },
    };

    // limpa undefined do custom_data
    Object.keys(event.custom_data).forEach(
      (k) => event.custom_data[k] === undefined && delete event.custom_data[k]
    );

    const metaResp = await sendToMeta(event);

    console.log("✅ Meta OK:", JSON.stringify(metaResp));
    return res.json({ ok: true, sent: true, meta: metaResp, event_id });
  } catch (err) {
    console.error("❌ ERRO /sp/lead:", err?.message || err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

/**
 * REGISTRO - Telegram (use depois)
 * POST https://SEU_RENDER.onrender.com/sp/register
 */
app.post("/sp/register", async (req, res) => {
  try {
    console.log("==================================================");
    console.log("🔥 /sp/register WEBHOOK RECEBIDO");
    console.log("🕒", new Date().toISOString());
    console.log("📦 BODY:", JSON.stringify(req.body, null, 2));

    if (!checkSecret(req)) {
      console.log("⛔ Secret inválido");
      return res.status(401).json({ ok: false, error: "invalid secret" });
    }

    const { vars, telegram_id, name, username } = extractSendPulse(req.body);

    const now = Math.floor(Date.now() / 1000);
    const fallbackEventId = crypto.randomUUID();
    const event_id = getEventId(vars, fallbackEventId);

    const event = {
      event_name: "CompleteRegistration",
      event_time: now,
      action_source: "chat",
      event_id,
      user_data: buildUserData({ vars, telegram_id, name, username }),
      custom_data: {
        utm_source: vars?.utm_source,
        utm_medium: vars?.utm_medium,
        utm_campaign: vars?.utm_campaign,
        utm_content: vars?.utm_content,
        fbclid: vars?.fbclid,
        telegram_id,
        username,
      },
    };

    Object.keys(event.custom_data).forEach(
      (k) => event.custom_data[k] === undefined && delete event.custom_data[k]
    );

    const metaResp = await sendToMeta(event);

    console.log("✅ Meta OK:", JSON.stringify(metaResp));
    return res.json({ ok: true, sent: true, meta: metaResp, event_id });
  } catch (err) {
    console.error("❌ ERRO /sp/register:", err?.message || err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// =========================
// Start
// =========================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 sp-meta-capi listening on port ${PORT}`);
});
