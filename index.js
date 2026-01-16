import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";

const app = express();
app.use(express.json({ limit: "2mb" }));

const PIXEL_ID = process.env.META_PIXEL_ID;
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;

// -------- utils ----------
function sha256(str) {
  if (!str) return undefined;
  return crypto.createHash("sha256").update(String(str)).digest("hex");
}

// O SendPulse manda um ARRAY com 1 item. Aqui a gente normaliza.
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
  return { item, vars, telegram_id: String(telegram_id) };
}

async function sendToMeta(event) {
  if (!PIXEL_ID || !ACCESS_TOKEN) {
    throw new Error(
      "Missing META_PIXEL_ID or META_ACCESS_TOKEN in environment variables."
    );
  }

  const url = `https://graph.facebook.com/v20.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: [event] }),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json));
  return json;
}

// -------- routes ----------
app.get("/", (req, res) => {
  res.status(200).send("OK");
});

// LEAD -> Lead_Telegram (evento personalizado)
app.post("/sp/lead", async (req, res) => {
  try {
    console.log("🔥 /sp/lead WEBHOOK RECEBIDO");
    console.log("🕒", new Date().toISOString());
    console.log("📦 BODY:", JSON.stringify(req.body, null, 2));

    const { vars, telegram_id } = extractVarsAndTelegramId(req.body);

    const leadId = vars.lead_id || crypto.randomUUID();
    const event_id = `${leadId}_lead`;

    const event = {
      event_name: "Lead_Telegram",
      event_time: Math.floor(Date.now() / 1000),
      action_source: "chat",
      event_id,
      user_data: {
        fbp: vars.fbp || undefined,
        fbc: vars.fbc || undefined,
        external_id: sha256(telegram_id) || undefined,
      },
      custom_data: {
        lead_id: leadId,
        telegram_id,
        utm_source: vars.utm_source,
        utm_medium: vars.utm_medium,
        utm_campaign: vars.utm_campaign,
        utm_content: vars.utm_content,
        fbclid: vars.fbclid,
      },
    };

    const metaResp = await sendToMeta(event);
    console.log("✅ Meta OK:", JSON.stringify(metaResp));

    res.json({ ok: true, meta: metaResp });
  } catch (err) {
    console.error("❌ /sp/lead ERROR:", err?.message || err);
    res
      .status(500)
      .json({ ok: false, error: String(err?.message || err) });
  }
});

// REGISTER -> Registro_Casa (evento personalizado)
app.post("/sp/register", async (req, res) => {
  try {
    console.log("🔥 /sp/register WEBHOOK RECEBIDO");
    console.log("🕒", new Date().toISOString());
    console.log("📦 BODY:", JSON.stringify(req.body, null, 2));

    const { vars, telegram_id } = extractVarsAndTelegramId(req.body);

    const leadId = vars.lead_id || crypto.randomUUID();
    const event_id = `${leadId}_register`;

    const event = {
      event_name: "Registro_Casa",
      event_time: Math.floor(Date.now() / 1000),
      action_source: "chat",
      event_id,
      user_data: {
        fbp: vars.fbp || undefined,
        fbc: vars.fbc || undefined,
        external_id: sha256(telegram_id) || undefined,
      },
      custom_data: {
        lead_id: leadId,
        telegram_id,
        utm_source: vars.utm_source,
        utm_medium: vars.utm_medium,
        utm_campaign: vars.utm_campaign,
        utm_content: vars.utm_content,
        fbclid: vars.fbclid,
      },
    };

    const metaResp = await sendToMeta(event);
    console.log("✅ Meta OK:", JSON.stringify(metaResp));

    res.json({ ok: true, meta: metaResp });
  } catch (err) {
    console.error("❌ /sp/register ERROR:", err?.message || err);
    res
      .status(500)
      .json({ ok: false, error: String(err?.message || err) });
  }
});

// GROUP -> Grupo_Telegram (evento personalizado)
app.post("/sp/group", async (req, res) => {
  try {
    console.log("🔥 /sp/group WEBHOOK RECEBIDO");
    console.log("🕒", new Date().toISOString());
    console.log("📦 BODY:", JSON.stringify(req.body, null, 2));

    const { vars, telegram_id } = extractVarsAndTelegramId(req.body);

    const leadId = vars.lead_id || crypto.randomUUID();
    const event_id = `${leadId}_group`;

    const event = {
      event_name: "Grupo_Telegram",
      event_time: Math.floor(Date.now() / 1000),
      action_source: "chat",
      event_id,
      user_data: {
        fbp: vars.fbp || undefined,
        fbc: vars.fbc || undefined,
        external_id: sha256(telegram_id) || undefined,
      },
      custom_data: {
        lead_id: leadId,
        telegram_id,
        utm_source: vars.utm_source,
        utm_medium: vars.utm_medium,
        utm_campaign: vars.utm_campaign,
        utm_content: vars.utm_content,
        fbclid: vars.fbclid,
      },
    };

    const metaResp = await sendToMeta(event);
    console.log("✅ Meta OK:", JSON.stringify(metaResp));

    res.json({ ok: true, meta: metaResp });
  } catch (err) {
    console.error("❌ /sp/group ERROR:", err?.message || err);
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// BILHETE MGM -> Bilhete_MGM (evento personalizado)
app.post("/sp/bilhete", async (req, res) => {
  try {
    console.log("🔥 /sp/bilhete WEBHOOK RECEBIDO");
    console.log("🕒", new Date().toISOString());
    console.log("📦 BODY:", JSON.stringify(req.body, null, 2));

    const { vars, telegram_id } = extractVarsAndTelegramId(req.body);

    const leadId = vars.lead_id || crypto.randomUUID();
    const event_id = `${leadId}_bilhete_mgm`;

    const event = {
      event_name: "Bilhete_MGM",
      event_time: Math.floor(Date.now() / 1000),
      action_source: "chat",
      event_id,
      user_data: {
        fbp: vars.fbp || undefined,
        fbc: vars.fbc || undefined,
        external_id: sha256(telegram_id) || undefined,
      },
      custom_data: {
        lead_id: leadId,
        telegram_id,
        origem: "telegram",
        produto: "bilhete_mgm",
        utm_source: vars.utm_source,
        utm_medium: vars.utm_medium,
        utm_campaign: vars.utm_campaign,
        utm_content: vars.utm_content,
        fbclid: vars.fbclid,
      },
    };

    const metaResp = await sendToMeta(event);
    console.log("✅ Meta OK:", JSON.stringify(metaResp));

    res.json({ ok: true, meta: metaResp });
  } catch (err) {
    console.error("❌ /sp/bilhete ERROR:", err?.message || err);
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// Start
const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`🚀 sp-meta-capi listening on port ${port}`);
});
