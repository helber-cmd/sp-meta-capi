# sp-meta-capi — Multi-Evento (SendPulse + Telegram + Meta CAPI)

Serviço de tracking server-side para Meta Ads (Conversions API),
integrado com SendPulse (Telegram).

Este projeto recebe webhooks do SendPulse e envia eventos personalizados
para o Meta Ads de forma dinâmica (multi-evento).

---

## 🌐 URL Base (produção)

https://sp-meta-capi.onrender.com

---

## 📡 Endpoint Único (Multi-Evento)

Todos os eventos utilizam o MESMO endpoint, variando apenas o parâmetro `e`:

POST /sp/event?e=EVENT_NAME

---

## 🧠 Eventos Disponíveis (Meta Ads)

| Evento Meta        | Parâmetro `e`     | Descrição |
|-------------------|-------------------|-----------|
| Lead_Telegram     | lead_telegram     | Lead entrando no bot |
| Registro_Casa     | registro_casa     | Cadastro realizado |
| Grupo_Telegram    | grupo_telegram    | Entrada em grupo |
| Bilhete_MGM       | bilhete_mgm       | Bilhete / oferta MGM |

---

## 🔗 URLs de Webhook (SendPulse)

Utilizar exatamente estas URLs nos fluxos do SendPulse:

https://sp-meta-capi.onrender.com/sp/event?e=lead_telegram  
https://sp-meta-capi.onrender.com/sp/event?e=registro_casa  
https://sp-meta-capi.onrender.com/sp/event?e=grupo_telegram  
https://sp-meta-capi.onrender.com/sp/event?e=bilhete_mgm  

---

## 📦 Payload Recebido

- O payload é recebido diretamente do SendPulse
- Pode chegar como ARRAY ou OBJETO (normalização automática)
- O sistema extrai automaticamente:

lead_id  
fbp  
fbc  
fbclid  
utm_source  
utm_medium  
utm_campaign  
utm_content  
telegram_id  

---

## 🔐 Variáveis de Ambiente (Obrigatórias)

Configurar no Render (ou ambiente local):

META_PIXEL_ID=SEU_PIXEL_ID  
META_ACCESS_TOKEN=SEU_TOKEN_CAPI  

---

## 🧩 Deduplicação de Eventos

- `event_id` é gerado com base no `lead_id`
- Evita duplicação no Meta Ads
- Compatível com Pixel + Conversions API

---

## 🚀 Status do Projeto

- Arquitetura multi-evento
- Pronto para replicar em outros funis
- Um único endpoint para todos os eventos
- Estrutura estável e escalável
