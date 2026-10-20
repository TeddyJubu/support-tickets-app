import { listTickets } from "@/lib/helpdesk-db";
import { createSimTicket, getSimTicketDetail, listSimTickets, type TicketQuery } from "@/lib/sim-db";
import { audit } from "@/lib/auth";
import { requireStaff, staffFromRequest } from "@/lib/request-auth";
import { createHash } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const p = url.searchParams;
  const limit = Math.min(Number(p.get("limit")) || 50, 100);
  const offset = Math.max(Number(p.get("offset")) || 0, 0);
  const q = p.get("q") ?? "";
  // source=sim lists the inbox (simulated, emailed and staff tickets); default is the historical export
  if (p.get("source") === "sim") {
    return Response.json(
      listSimTickets({
        q,
        limit,
        offset,
        view: (p.get("view") || undefined) as TicketQuery["view"],
        status: p.get("status") ?? "",
        priority: p.get("priority") ?? undefined,
        assignee: p.get("assignee") ?? undefined,
        tag: p.get("tag") ?? undefined,
        channel: p.get("channel") ?? undefined,
        sort: p.get("sort") === "oldest" ? "oldest" : "newest",
        viewer: staffFromRequest(request)?.id ?? 0,
      }),
    );
  }
  return Response.json(
    listTickets({
      q,
      limit,
      offset,
      includeAutomated: p.get("automated") === "1",
    }),
  );
}

// Staff open a ticket for a customer: { email, name?, subject, body?, note? }.
// The first email to the customer is then sent through the normal reply route.
export async function POST(request: Request) {
  const user = requireStaff(request);
  if (user instanceof Response) return user;
  const input = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const email = typeof input?.email === "string" ? input.email.trim().toLowerCase() : "";
  const subject = typeof input?.subject === "string" ? input.subject.trim() : "";
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  const note = typeof input?.note === "string" ? input.note.trim() : "";
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) return Response.json({ error: "Enter the customer's email address" }, { status: 400 });
  if (!subject || subject.length > 300) return Response.json({ error: "Enter a subject (up to 300 characters)" }, { status: 400 });
  const [firstName, ...rest] = (name || email.split("@")[0]).split(/\s+/);
  const id = createSimTicket({
    // Same customer key as inbound email, so the customer's replies thread onto this ticket
    customer: {
      sourceKey: `email:${createHash("sha256").update(email).digest("hex")}`,
      firstName,
      lastName: rest.join(" "),
      email,
    },
    subject,
    body: note.slice(0, 10000),
    firstAuthor: "note",
    firstSender: user.displayName,
    tags: "email",
    channel: "email",
    assigneeId: user.id,
  });
  audit(user.username, "ticket_create", id, { channel: "email" });
  return Response.json(getSimTicketDetail(id, user.id), { status: 201 });
}
