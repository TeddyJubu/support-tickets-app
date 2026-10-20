// Shapes returned by the helpdesk API routes (app/api/helpdesk/*).
import type { AiDraftState } from "./drafting/state";
export type { AiDraftState, DraftInfo, DraftJobInfo } from "./drafting/state";
// Shared by the server data layer and the client.

export interface TicketSummary {
  id: string;
  subject: string | null;
  customerName: string | null;
  customerEmail: string | null;
  priority: string | null;
  tags: string | null;
  aiIntent: string | null;
  createdAt: string | null;
  closedAt: string | null;
  agentMessages: number;
  customerMessages: number;
  /** True for tickets created by the simulator (data/sim.db) */
  simulated?: boolean;
  /** Simulated tickets only: open | pending | closed */
  status?: string | null;
  /** Simulated tickets only: last activity */
  updatedAt?: string | null;
  /** How the ticket arrived. Inbox: simulator | email | staff (TicketChannel); archive: Gorgias channel */
  channel?: string | null;
  assignee?: { id: number; displayName: string } | null;
  snoozedUntil?: string | null;
  trashed?: boolean;
  spam?: boolean;
  tagList?: string[];
  /** A customer message the viewer hasn't opened yet */
  unread?: boolean;
}

export type TicketChannel = "simulator" | "email" | "staff";
export type TicketPriority = "low" | "normal" | "high" | "critical";
export const PRIORITIES: TicketPriority[] = ["low", "normal", "high", "critical"];

export type InboxView = "all" | "open" | "pending" | "closed" | "mine" | "unassigned" | "snoozed" | "trash" | "spam";
export const INBOX_VIEWS: InboxView[] = ["all", "open", "pending", "mine", "unassigned", "snoozed", "closed", "trash", "spam"];

export interface Attachment {
  id: number;
  filename: string;
  contentType: string;
  size: number;
  /** false: not stored (too large or a blocked type), metadata only */
  stored: boolean;
}

export interface Ticket extends TicketSummary {
  channel: string | null;
  integration: string | null;
  createdByAgent: boolean;
  assigneeName: string | null;
  assigneeEmail: string | null;
  firstResponseSeconds: number | null;
  resolutionSeconds: number | null;
  url: string | null;
  contactReason: string | null;
  product: string | null;
  resolution: string | null;
  sentiment: string | null;
  customerType: string | null;
  automated: boolean;
  /** Simulated tickets: the store order the customer is writing about */
  orderName?: string | null;
  /** Simulated tickets: the historical ticket this was replayed from */
  sourceTicketId?: string | null;
}

export interface SimMessage {
  id: number;
  /** note: internal staff note, never sent */
  author: "customer" | "agent" | "system" | "note";
  sender: string | null;
  body: string;
  createdAt: string;
  /** The original was longer and was cut when it arrived */
  truncated?: boolean;
  attachments?: Attachment[];
}

export interface Customer {
  id: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
  zip: string | null;
  acceptsEmail: boolean;
  acceptsSms: boolean;
  totalSpent: number;
  totalOrders: number;
  note: string | null;
  tags: string | null;
  taxExempt: boolean;
}

export interface CustomerStats {
  ticketCount: number;
  ticketsLast90Days: number;
  criticalTickets: number;
  avgFirstResponseSeconds: number | null;
  avgResolutionSeconds: number | null;
  topIntents: Array<{ intent: string; count: number }>;
}

export interface TicketDetail {
  ticket: Ticket;
  customer: Customer | null;
  history: TicketSummary[];
  stats: CustomerStats;
  /** Full conversation (simulated tickets only; the Gorgias export has no bodies) */
  messages?: SimMessage[];
  /** Inbox tickets: the latest AI draft and drafting job */
  ai?: AiDraftState;
  /** Inbox tickets: a reply whose delivery isn't confirmed yet (blocks new replies) */
  pendingSend?: PendingSend | null;
}

export interface Product {
  handle: string;
  title: string | null;
  vendor: string | null;
  category: string | null;
  type: string | null;
  tags: string | null;
  status: string | null;
  published: boolean;
  description: string | null;
  image: string | null;
  priceMin: number | null;
  priceMax: number | null;
  compareAtMax: number | null;
  variantCount: number;
  inventory: number;
  options: string | null;
  finalSale: boolean;
}

export interface SimilarTicket extends TicketSummary {
  similarity: number;
  resolutionSeconds: number | null;
}

export interface TicketListResponse {
  tickets: TicketSummary[];
  total: number;
  offset: number;
  limit: number;
  /** Inbox only: ticket count per view */
  counts?: Record<InboxView, number>;
}

export interface PendingSend {
  key: string;
  createdAt: string;
  excerpt: string;
  hasMessageId: boolean;
  /** Older than two minutes, or emailed but not saved: a person must check */
  uncertain: boolean;
}
