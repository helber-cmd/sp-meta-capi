import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";

const app = express();
app.use(express.json({ limit: "2mb" }));

const PIXEL_ID = process.env.META_PIXEL_ID;
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;

function sha256(str) {
  return crypto.createHash("sha256").update(String(str)).digest("hex");
}

function extract(body) {
  const item = Array.isArray(body) ? body[0] : body;
  const vars = item?.contact?.variables || {};
  const telegram_id = item?.contact?.last_message_data?.telegram_id || "";
  return { vars, telegram_id };
}

async function sendLead(event) {
  const res = await fetch(
    `https://graph.facebook.com/v20.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [event] })
    }
  );

  const json = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json));
  return json;
}

app.post("/sp/lead", async (req, res) => {
  try {
    const { vars, telegram_id } = extract(req.body);
    const lead_id = vars.lead_id;
    if (!lead_id) return res.status(400).json({ error: "missing lead_id" });

    const event = {
      event_name: "Lead",
      event_time: Math.floor(Date.now() / 1000),
      event_id: `lead_${lead_id}`,
      action_source: "chat",
      user_data: {
        external_id: sha256(lead_id),
        fbp: vars.fbp || undefined,
        fbc: vars.fbc || undefined
      },
      custom_data: {
        channel: "telegram",
        telegram_id,
        lead_id
      }
    };

    const result = await sendLead(event);
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/", (_, res) => res.send("OK"));
app.listen(process.env.PORT || 3000);
