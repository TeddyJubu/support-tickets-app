"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import type {
  DashboardState,
  DashboardContextType,
  CustomerRisk,
  Sentiment,
  CustomerContext,
  LinkedTicket,
  TicketMessage,
  TicketStatus,
} from "../types";
import type {
  TicketDetail,
  TicketListResponse,
  TicketSummary,
} from "@/lib/helpdesk-types";
import {
  formatDate,
  formatDuration,
  formatTime,
  initials,
} from "@/lib/helpdesk-format";
import { avatars } from "../data/mock-data";

const DashboardContext = createContext<DashboardContextType | null>(null);

export function useDashboard() {
  const context = useContext(DashboardContext);
  if (!context)
    throw new Error("useDashboard must be used within DashboardProvider");
  return context;
}

const PAGE_SIZE = 50;

export type TicketSource = "sim" | "history";

// Helper to get current time string
function getCurrentTime(): string {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Simulated tickets carry their full conversation
function simMessages(detail: TicketDetail): TicketMessage[] {
  const { ticket } = detail;
  const name = ticket.customerName ?? ticket.customerEmail ?? "Customer";
  const messages: TicketMessage[] = [
    {
      id: 0,
      type: "system",
      content: `Simulated ticket opened ${formatDate(ticket.createdAt)}${
        ticket.orderName ? ` about order ${ticket.orderName}` : ""
      }${ticket.sourceTicketId ? ` · replayed from #${ticket.sourceTicketId}` : ""}`,
      timestamp: formatTime(ticket.createdAt),
    },
  ];
  detail.messages!.forEach((m, i) => {
    const time = formatTime(m.createdAt);
    if (m.author === "system") {
      messages.push({ id: m.id, type: "system", content: m.body, timestamp: time });
      return;
    }
    const sender = m.sender ?? (m.author === "customer" ? name : "Agent");
    messages.push({
      id: m.id,
      type: m.author,
      sender,
      avatar: m.author === "agent" ? avatars.agent : initials(sender),
      channel: "Email",
      ...(i === 0 ? { emailSubject: ticket.subject ?? "(no subject)" } : {}),
      timestamp: time,
      content: m.body,
    });
  });
  if (ticket.closedAt) {
    messages.push({
      id: Number.MAX_SAFE_INTEGER,
      type: "system",
      content: `Closed ${formatDate(ticket.closedAt)}`,
      timestamp: formatTime(ticket.closedAt),
    });
  }
  return messages;
}

// The Gorgias export has ticket metadata but no message bodies, so the
// conversation is reconstructed from what the export does contain.
function messagesFromDetail(detail: TicketDetail): TicketMessage[] {
  if (detail.messages) return simMessages(detail);
  const { ticket } = detail;
  const name = ticket.customerName ?? ticket.customerEmail ?? "Customer";
  const messages: TicketMessage[] = [
    {
      id: 1,
      type: "system",
      content: `Ticket opened ${formatDate(ticket.createdAt)} via ${ticket.channel ?? "email"}${
        ticket.integration ? ` (${ticket.integration})` : ""
      }`,
      timestamp: formatTime(ticket.createdAt),
    },
    {
      id: 2,
      type: "customer",
      sender: name,
      avatar: initials(name),
      channel: "Email",
      emailSubject: ticket.subject ?? "(no subject)",
      timestamp: formatTime(ticket.createdAt),
      content: `${ticket.customerMessages} customer message${
        ticket.customerMessages === 1 ? "" : "s"
      } and ${ticket.agentMessages} agent repl${
        ticket.agentMessages === 1 ? "y" : "ies"
      } on this ticket. Message text isn't included in the Gorgias export.`,
    },
  ];
  if (ticket.closedAt) {
    messages.push({
      id: 3,
      type: "system",
      content: `Closed ${formatDate(ticket.closedAt)}${
        ticket.assigneeName ? ` by ${ticket.assigneeName}` : ""
      } · first response ${formatDuration(ticket.firstResponseSeconds)} · resolved in ${formatDuration(
        ticket.resolutionSeconds,
      )}`,
      timestamp: formatTime(ticket.closedAt),
    });
  }
  return messages;
}

const emptyTicketState = {
  messages: [] as TicketMessage[],
  ticketStatus: "open" as TicketStatus,
  composeText: "",
  customerRisk: null,
  sentiment: null,
  customerContext: null,
  linkedTickets: [] as LinkedTicket[],
  appliedResolution: null,
  sentOffer: null,
  refundProcessed: null,
  exchangeProcessed: null,
  callbackScheduled: null,
  escalatedTo: null,
};

export function DashboardProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DashboardState>(emptyTicketState);

  // Ticket list: "sim" (simulator tickets) or "history" (Gorgias export)
  const [ticketSource, setTicketSourceState] = useState<TicketSource>("sim");
  const sourceRef = useRef<TicketSource>("sim");
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [ticketTotal, setTicketTotal] = useState(0);
  const [ticketQuery, setTicketQuery] = useState("");
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [ticketsError, setTicketsError] = useState<string | null>(null);

  // Selected ticket
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [ticketDetail, setTicketDetail] = useState<TicketDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const detailRequest = useRef(0);

  const fetchTickets = useCallback(async (query: string, offset: number, quiet = false) => {
    if (!quiet) setTicketsLoading(true);
    setTicketsError(null);
    try {
      const params = new URLSearchParams({
        q: query,
        offset: String(offset),
        limit: String(PAGE_SIZE),
        source: sourceRef.current,
      });
      const res = await fetch(`/api/helpdesk/tickets?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as TicketListResponse;
      setTickets((prev) => (offset === 0 ? data.tickets : [...prev, ...data.tickets]));
      setTicketTotal(data.total);
      return data.tickets;
    } catch (err) {
      setTicketsError(err instanceof Error ? err.message : "Request failed");
      return [];
    } finally {
      setTicketsLoading(false);
    }
  }, []);

  const selectedRef = useRef<string | null>(null);

  const applyDetail = useCallback((detail: TicketDetail, keepInsights: boolean) => {
    setTicketDetail(detail);
    const ticketStatus: TicketStatus = detail.ticket.closedAt
      ? "closed"
      : detail.ticket.status === "pending"
        ? "pending"
        : "open";
    setState((prev) =>
      keepInsights
        ? { ...prev, messages: messagesFromDetail(detail), ticketStatus }
        : { ...emptyTicketState, messages: messagesFromDetail(detail), ticketStatus },
    );
  }, []);

  const selectTicket = useCallback(
    async (id: string) => {
      const request = ++detailRequest.current;
      selectedRef.current = id;
      setSelectedTicketId(id);
      setDetailLoading(true);
      try {
        const res = await fetch(`/api/helpdesk/tickets/${id}`);
        if (!res.ok) return;
        const detail = (await res.json()) as TicketDetail;
        if (request !== detailRequest.current) return;
        applyDetail(detail, false);
      } finally {
        if (request === detailRequest.current) setDetailLoading(false);
      }
    },
    [applyDetail],
  );

  // Re-read the open ticket without clearing AI insights (new messages, status)
  const refreshSelected = useCallback(async () => {
    const id = selectedRef.current;
    if (!id) return;
    const res = await fetch(`/api/helpdesk/tickets/${id}`);
    if (!res.ok || selectedRef.current !== id) return;
    applyDetail((await res.json()) as TicketDetail, true);
  }, [applyDetail]);

  // Debounced search; selects the first ticket when nothing is open
  useEffect(() => {
    const timer = setTimeout(async () => {
      const list = await fetchTickets(ticketQuery, 0);
      if (!selectedRef.current && list[0]) selectTicket(list[0].id);
    }, ticketQuery ? 300 : 0);
    return () => clearTimeout(timer);
  }, [ticketQuery, ticketSource, fetchTickets, selectTicket]);

  const setTicketSource = useCallback((source: TicketSource) => {
    sourceRef.current = source;
    selectedRef.current = null;
    setSelectedTicketId(null);
    setTicketDetail(null);
    setTickets([]);
    setTicketTotal(0);
    setState(emptyTicketState);
    setTicketSourceState(source);
  }, []);

  // Simulated tickets change while the simulator runs: poll for new tickets and messages
  useEffect(() => {
    if (ticketSource !== "sim") return;
    const timer = setInterval(() => {
      if (document.hidden) return;
      fetchTickets(ticketQuery, 0, true);
      if (selectedRef.current?.startsWith("SIM-")) refreshSelected();
    }, 10000);
    return () => clearInterval(timer);
  }, [ticketSource, ticketQuery, fetchTickets, refreshSelected]);

  const retryTickets = useCallback(async () => {
    const list = await fetchTickets(ticketQuery, 0);
    if (!selectedRef.current && list[0]) selectTicket(list[0].id);
  }, [fetchTickets, ticketQuery, selectTicket]);

  const loadMoreTickets = useCallback(() => {
    if (!ticketsLoading && tickets.length < ticketTotal) {
      fetchTickets(ticketQuery, tickets.length);
    }
  }, [fetchTickets, ticketQuery, tickets.length, ticketTotal, ticketsLoading]);

  const selectAdjacentTicket = useCallback(
    (direction: -1 | 1) => {
      const index = tickets.findIndex((t) => t.id === selectedTicketId);
      const next = tickets[index + direction];
      if (next) selectTicket(next.id);
    },
    [tickets, selectedTicketId, selectTicket],
  );

  // Message management
  const addMessage = useCallback((message: Omit<TicketMessage, "id">) => {
    setState((prev) => ({
      ...prev,
      messages: [...prev.messages, { ...message, id: Date.now() }],
    }));
  }, []);

  const sendAgentMessage = useCallback(
    (
      content: string,
      channel: "Chat" | "Email" = "Chat",
      emailSubject?: string,
    ) => {
      if (!content.trim()) return;
      const id = selectedRef.current;
      if (id?.startsWith("SIM-")) {
        // Simulated tickets: save the reply so the simulated customer can answer it
        setState((prev) => ({ ...prev, composeText: "" }));
        // Email tickets: really sends to the customer (password-protected route)
        const isEmail = ticketDetail?.ticket.id === id && ticketDetail.ticket.tags === "email";
        fetch(isEmail ? `/api/helpdesk/email/tickets/${id}/reply` : `/api/helpdesk/sim/tickets/${id}/messages`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ author: "agent", body: content, sender: "You" }),
        }).then(async (res) => {
          if (!res.ok) {
            const err = (await res.json().catch(() => null)) as { error?: string } | null;
            setState((prev) => (prev.composeText ? prev : { ...prev, composeText: content }));
            window.alert(`Reply not sent: ${err?.error ?? `HTTP ${res.status}`}`);
            return;
          }
          if (selectedRef.current === id) applyDetail((await res.json()) as TicketDetail, true);
        });
        return;
      }
      setState((prev) => ({
        ...prev,
        messages: [
          ...prev.messages,
          {
            id: Date.now(),
            type: "agent" as const,
            sender: "You",
            avatar: avatars.agent,
            channel,
            timestamp: getCurrentTime(),
            content,
            ...(channel === "Email" && emailSubject ? { emailSubject } : {}),
          },
        ],
        composeText: "", // Clear compose after sending
      }));
    },
    [applyDetail, ticketDetail],
  );

  // Ticket status
  const setTicketStatus = useCallback(
    (status: TicketStatus) => {
      setState((prev) => ({ ...prev, ticketStatus: status }));
      const id = selectedRef.current;
      if (id?.startsWith("SIM-")) {
        fetch(`/api/helpdesk/sim/tickets/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: status === "resolved" ? "closed" : status }),
        }).then(async (res) => {
          if (res.ok && selectedRef.current === id) {
            applyDetail((await res.json()) as TicketDetail, true);
          }
        });
      }
    },
    [applyDetail],
  );

  // Compose
  const setComposeText = useCallback((text: string) => {
    setState((prev) => ({ ...prev, composeText: text }));
  }, []);

  // AI Insights
  const setCustomerRisk = useCallback((risk: CustomerRisk) => {
    setState((prev) => ({ ...prev, customerRisk: risk }));
  }, []);

  const setSentiment = useCallback((sentiment: Sentiment) => {
    setState((prev) => ({ ...prev, sentiment }));
  }, []);

  const setCustomerContext = useCallback((context: CustomerContext) => {
    setState((prev) => ({ ...prev, customerContext: context }));
  }, []);

  // Actions
  const addLinkedTicket = useCallback((ticket: LinkedTicket) => {
    setState((prev) => ({
      ...prev,
      linkedTickets: prev.linkedTickets.some((t) => t.id === ticket.id)
        ? prev.linkedTickets
        : [...prev.linkedTickets, ticket],
    }));
  }, []);

  const setAppliedResolution = useCallback((resolution: string) => {
    setState((prev) => ({ ...prev, appliedResolution: resolution }));
  }, []);

  const setSentOffer = useCallback((offer: { type: string; value: string }) => {
    setState((prev) => ({ ...prev, sentOffer: offer }));
  }, []);

  const setRefundProcessed = useCallback(
    (refund: { orderId: string; amount: number; reason: string }) => {
      setState((prev) => ({ ...prev, refundProcessed: refund }));
    },
    [],
  );

  const setExchangeProcessed = useCallback(
    (exchange: { from: string; to: string }) => {
      setState((prev) => ({ ...prev, exchangeProcessed: exchange }));
    },
    [],
  );

  const setCallbackScheduled = useCallback(
    (callback: { date: string; time: string }) => {
      setState((prev) => ({ ...prev, callbackScheduled: callback }));
    },
    [],
  );

  const setEscalatedTo = useCallback((supervisor: string) => {
    setState((prev) => ({ ...prev, escalatedTo: supervisor }));
  }, []);

  return (
    <DashboardContext.Provider
      value={{
        ...state,
        ticketSource,
        setTicketSource,
        refreshSelected,
        tickets,
        ticketTotal,
        ticketQuery,
        ticketsLoading,
        ticketsError,
        retryTickets,
        setTicketQuery,
        loadMoreTickets,
        selectedTicketId,
        ticketDetail,
        detailLoading,
        selectTicket,
        selectAdjacentTicket,
        addMessage,
        sendAgentMessage,
        setTicketStatus,
        setComposeText,
        setCustomerRisk,
        setSentiment,
        setCustomerContext,
        addLinkedTicket,
        setAppliedResolution,
        setSentOffer,
        setRefundProcessed,
        setExchangeProcessed,
        setCallbackScheduled,
        setEscalatedTo,
      }}
    >
      {children}
    </DashboardContext.Provider>
  );
}
