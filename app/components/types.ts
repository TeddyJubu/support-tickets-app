import type { TicketDetail, TicketSummary } from "@/lib/helpdesk-types";

// ============================================
// DASHBOARD STATE TYPES
// ============================================

export interface CustomerRisk {
  level: "low" | "medium" | "high";
  score: number;
  reasons: string[];
}

export interface Sentiment {
  emoji: string;
  label: string;
  score: number;
  reasons: string[];
}

export interface LinkedTicket {
  id: string;
  title: string;
  status: string;
  resolution?: string;
}

export interface CustomerContext {
  ltv: string;
  tier: string;
  orderCount: number;
  ticketCount: number;
  avgResponseTime: string;
  ticketsLast90Days: number;
  riskFactors: string[];
  recommendations: string[];
}

// Message types for the conversation
export interface TicketMessage {
  id: number;
  type: "system" | "customer" | "agent";
  content: string;
  timestamp: string;
  /** Raw timestamp, for day dividers */
  date?: string | null;
  sender?: string;
  avatar?: string;
  channel?: "Chat" | "Email" | "WhatsApp";
  hasEmoji?: boolean;
  // Email-specific fields
  emailSubject?: string;
  // User status
  isOnline?: boolean;
}

// Ticket status
export type TicketStatus = "open" | "pending" | "resolved" | "closed";

export interface DashboardState {
  // Conversation
  messages: TicketMessage[];
  ticketStatus: TicketStatus;
  // Compose
  composeText: string;
  // AI Insights
  customerRisk: CustomerRisk | null;
  sentiment: Sentiment | null;
  customerContext: CustomerContext | null;
  // Actions taken
  linkedTickets: LinkedTicket[];
  appliedResolution: string | null;
  sentOffer: { type: string; value: string } | null;
  // Refund/Exchange tracking
  refundProcessed: { orderId: string; amount: number; reason: string } | null;
  exchangeProcessed: { from: string; to: string } | null;
  callbackScheduled: { date: string; time: string } | null;
  escalatedTo: string | null;
}

export interface DashboardContextType extends DashboardState {
  // Ticket list: simulator tickets or the historical export
  ticketSource: "sim" | "history";
  setTicketSource: (source: "sim" | "history") => void;
  statusFilter: "all" | "open" | "pending" | "closed";
  setStatusFilter: (filter: "all" | "open" | "pending" | "closed") => void;
  // Right-hand panel; null when collapsed
  sidePanel: "copilot" | "customer" | null;
  setSidePanel: (panel: "copilot" | "customer" | null) => void;
  // Toast notifications
  toasts: Array<{ id: number; message: string; tone: "success" | "error" | "info" }>;
  notify: (message: string, tone?: "success" | "error" | "info") => void;
  dismissToast: (id: number) => void;
  /** A reply is being sent */
  sending: boolean;
  refreshSelected: () => Promise<void>;
  tickets: TicketSummary[];
  ticketTotal: number;
  ticketQuery: string;
  ticketsLoading: boolean;
  ticketsError: string | null;
  retryTickets: () => void;
  setTicketQuery: (query: string) => void;
  loadMoreTickets: () => void;
  // Selected ticket
  selectedTicketId: string | null;
  ticketDetail: TicketDetail | null;
  detailLoading: boolean;
  /** The selected ticket failed to load */
  detailError: string | null;
  selectTicket: (id: string) => void;
  selectAdjacentTicket: (direction: -1 | 1) => void;
  // Message management
  addMessage: (message: Omit<TicketMessage, "id">) => void;
  sendAgentMessage: (
    content: string,
    channel?: "Chat" | "Email",
    emailSubject?: string,
  ) => Promise<boolean>;
  // Ticket status
  /** Defaults to the selected ticket */
  setTicketStatus: (status: TicketStatus, ticketId?: string) => Promise<boolean>;
  // Compose
  setComposeText: (text: string) => void;
  // AI Insights
  setCustomerRisk: (risk: CustomerRisk) => void;
  setSentiment: (sentiment: Sentiment) => void;
  setCustomerContext: (context: CustomerContext) => void;
  // Actions
  addLinkedTicket: (ticket: LinkedTicket) => void;
  setAppliedResolution: (resolution: string) => void;
  setSentOffer: (offer: { type: string; value: string }) => void;
  setRefundProcessed: (refund: {
    orderId: string;
    amount: number;
    reason: string;
  }) => void;
  setExchangeProcessed: (exchange: { from: string; to: string }) => void;
  setCallbackScheduled: (callback: { date: string; time: string }) => void;
  setEscalatedTo: (supervisor: string) => void;
}

// Re-export ToolRendererProps from SDK for convenience
export type { ToolRendererProps } from "@yourgpt/copilot-sdk/ui";
