// Posts a sample email to the local inbound email webhook, as an email provider would.
// Usage: bun run email:simulate [--from addr] [--name "Sender"] [--subject text] [--text body] [--message-id id]
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    from: { type: "string", default: "student@example.com" },
    name: { type: "string", default: "Sam Student" },
    subject: { type: "string", default: "I can't access my course" },
    text: {
      type: "string",
      default: "Hi, I enrolled yesterday but the course page says I don't have access. Can you help?",
    },
    "message-id": { type: "string" },
  },
});

const secret = process.env.INBOUND_EMAIL_SECRET;
const support = process.env.SUPPORT_EMAIL;
if (!secret || !support) {
  console.error("Set INBOUND_EMAIL_SECRET and SUPPORT_EMAIL in server/.env");
  process.exit(1);
}

const url = `http://localhost:${process.env.PORT ?? 3000}/api/webhooks/inbound-email`;
const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Webhook-Secret": secret },
  body: JSON.stringify({
    from: values.from,
    fromName: values.name,
    to: [support],
    subject: values.subject,
    text: values.text,
    messageId: values["message-id"] ?? `<${crypto.randomUUID()}@simulated.local>`,
  }),
});

console.log(res.status, JSON.stringify(await res.json(), null, 2));
if (!res.ok) process.exit(1);
