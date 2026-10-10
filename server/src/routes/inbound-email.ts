import { timingSafeEqual } from "node:crypto";
import express, { Router, type RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "../db.ts";
import { Prisma } from "../generated/prisma/client.ts";
import { htmlToText } from "../lib/email.ts";
import { HttpError } from "../middleware/error-handler.ts";

// Provider-neutral inbound email. When an email provider (SendGrid/Mailgun) is added, its
// webhook adapter should map the provider's payload to this shape and reuse createTicketFromEmail.
const inboundEmailSchema = z
  .object({
    from: z.string().trim().toLowerCase().pipe(z.email("`from` must be an email address")),
    fromName: z.string().trim().max(200).optional(),
    to: z.array(z.string().trim()).min(1, "`to` must list at least one recipient"),
    subject: z.string().max(1000).optional(),
    text: z.string().optional(),
    html: z.string().optional(),
    messageId: z.string().trim().min(1).max(1000).optional(),
  })
  .refine((email) => email.text !== undefined || email.html !== undefined, {
    message: "The email needs a `text` or `html` body",
  });

export type InboundEmail = z.infer<typeof inboundEmailSchema>;

const ticketSelect = {
  id: true,
  subject: true,
  body: true,
  fromEmail: true,
  fromName: true,
  status: true,
  createdAt: true,
} as const;

// Machine-to-machine auth: the caller must send the shared secret. Fails closed when unset.
const requireWebhookSecret: RequestHandler = (req, _res, next) => {
  const expected = process.env.INBOUND_EMAIL_SECRET;
  if (!expected) throw new HttpError(503, "Inbound email is not configured");

  const given = req.get("X-Webhook-Secret") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new HttpError(401, "Unauthorized");
  }
  next();
};

function isAddressedToSupport(recipients: string[]) {
  const support = process.env.SUPPORT_EMAIL?.trim().toLowerCase();
  if (!support) throw new HttpError(503, "Inbound email is not configured");
  // Accept bare addresses and "Name <address>" forms.
  return recipients.some((r) => {
    const address = (r.match(/<([^>]+)>/)?.[1] ?? r).trim().toLowerCase();
    return address === support;
  });
}

// Returns the ticket and whether it was newly created (false for a repeated Message-ID).
export async function createTicketFromEmail(email: InboundEmail) {
  if (!isAddressedToSupport(email.to)) {
    throw new HttpError(422, "Not addressed to the support address");
  }

  const body = (email.text?.trim() ? email.text : htmlToText(email.html ?? "")).trim();
  if (!body) throw new HttpError(400, "The email body is empty");

  const { messageId } = email;
  if (messageId) {
    const existing = await prisma.ticket.findUnique({ where: { messageId }, select: ticketSelect });
    if (existing) return { ticket: existing, created: false };
  }

  try {
    const ticket = await prisma.ticket.create({
      data: {
        subject: email.subject?.trim() || "(no subject)",
        body,
        fromEmail: email.from,
        fromName: email.fromName || null,
        messageId,
      },
      select: ticketSelect,
    });
    return { ticket, created: true };
  } catch (err) {
    // A concurrent retry of the same email created it first.
    if (messageId && err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const ticket = await prisma.ticket.findUniqueOrThrow({
        where: { messageId },
        select: ticketSelect,
      });
      return { ticket, created: false };
    }
    throw err;
  }
}

export const inboundEmailRouter = Router();

// Mounted before the app-wide express.json(): emails can exceed its 100kb default.
inboundEmailRouter.post(
  "/",
  requireWebhookSecret,
  express.json({ limit: "1mb" }),
  async (req, res) => {
    const parsed = inboundEmailSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid email payload");
    }
    const { ticket, created } = await createTicketFromEmail(parsed.data);
    res.status(created ? 201 : 200).json({ ticket });
  },
);
