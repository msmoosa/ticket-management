import { timingSafeEqual } from "node:crypto";
import express, { Router, type RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "../db.ts";
import { Prisma } from "../generated/prisma/client.ts";
import { TicketReplySender, TicketStatus } from "../generated/prisma/enums.ts";
import { htmlToText, stripQuotedReply } from "../lib/email.ts";
import { HttpError } from "../middleware/error-handler.ts";

const messageIdField = z.string().trim().min(1).max(1000);

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
    messageId: messageIdField.optional(),
    // Threading headers of a reply: the Message-ID it answers, and the thread's earlier
    // Message-IDs (an array, or the raw space-separated header).
    inReplyTo: messageIdField.optional(),
    references: z
      .union([z.array(z.string()), z.string()])
      .optional()
      .transform((refs) =>
        (typeof refs === "string" ? refs.split(/\s+/) : (refs ?? []))
          .map((ref) => ref.trim())
          .filter(Boolean)
          // Long threads: the most recent references are the ones that matter.
          .slice(-100),
      ),
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
  category: true,
  createdAt: true,
} as const;

const replySelect = {
  id: true,
  sender: true,
  body: true,
  author: { select: { id: true, name: true } },
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

function isUniqueViolation(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

// Message-IDs are compared with and without their angle brackets, since providers differ.
function messageIdVariants(ids: string[]) {
  return [...new Set(ids.flatMap((id) => [id, id.replace(/^<|>$/g, ""), `<${id.replace(/^<|>$/g, "")}>`]))];
}

// The ticket an emailed reply belongs to: one whose original email, or an earlier reply on it,
// has a Message-ID the email references. Only the ticket's own sender can reply into it; mail
// from anyone else (or that references nothing we know) starts a new ticket instead.
async function findThreadedTicket(email: InboundEmail) {
  const refs = [email.inReplyTo, ...email.references].filter((id): id is string => !!id);
  if (refs.length === 0) return null;
  const ids = messageIdVariants(refs);

  return prisma.ticket.findFirst({
    where: {
      fromEmail: email.from,
      OR: [{ messageId: { in: ids } }, { replies: { some: { messageId: { in: ids } } } }],
    },
    // If a thread somehow spans tickets, the newest one is the live conversation.
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
}

async function findByMessageId(messageId: string) {
  const ticket = await prisma.ticket.findUnique({ where: { messageId }, select: ticketSelect });
  if (ticket) return { ticket, reply: null };
  const reply = await prisma.ticketReply.findUnique({
    where: { messageId },
    select: { ...replySelect, ticket: { select: ticketSelect } },
  });
  if (!reply) return null;
  const { ticket: replyTicket, ...rest } = reply;
  return { ticket: replyTicket, reply: rest };
}

// Turns an email into a new ticket, or into a customer reply on the ticket it answers (see
// findThreadedTicket); a reply reopens a resolved or closed ticket. Returns the ticket, the reply
// (null for a new ticket) and whether anything was created (false for a repeated Message-ID).
export async function createTicketFromEmail(email: InboundEmail) {
  if (!isAddressedToSupport(email.to)) {
    throw new HttpError(422, "Not addressed to the support address");
  }

  const body = (email.text?.trim() ? email.text : htmlToText(email.html ?? "")).trim();
  if (!body) throw new HttpError(400, "The email body is empty");

  const { messageId } = email;
  if (messageId) {
    const existing = await findByMessageId(messageId);
    if (existing) return { ...existing, created: false };
  }

  try {
    const threaded = await findThreadedTicket(email);
    if (threaded) {
      const [reply, ticket] = await prisma.$transaction([
        prisma.ticketReply.create({
          data: {
            ticketId: threaded.id,
            sender: TicketReplySender.customer,
            body: stripQuotedReply(body),
            messageId,
          },
          select: replySelect,
        }),
        prisma.ticket.update({
          where: { id: threaded.id },
          data: { status: TicketStatus.open },
          select: ticketSelect,
        }),
      ]);
      return { ticket, reply, created: true };
    }

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
    return { ticket, reply: null, created: true };
  } catch (err) {
    // A concurrent retry of the same email created it first.
    if (messageId && isUniqueViolation(err)) {
      const existing = await findByMessageId(messageId);
      if (existing) return { ...existing, created: false };
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
    const { ticket, reply, created } = await createTicketFromEmail(parsed.data);
    // `reply` is set when the email was threaded onto an existing ticket.
    res.status(created ? 201 : 200).json(reply ? { ticket, reply } : { ticket });
  },
);
