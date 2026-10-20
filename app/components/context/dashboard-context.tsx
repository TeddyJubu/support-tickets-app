"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
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
  formatDuration,
  formatTime,
  initials,
} from "@/lib/helpdesk-format";

const DashboardContext = createContext<DashboardContextType | null>(null);

export function useDashboard() {
  const context = useContext(DashboardContext);
  if (!context)
    throw new Error("useDashboard must be used within DashboardProvider");
  return context;
}

const PAGE_SIZE = 50;

export type TicketSource = "sim" | "history";
export type StatusFilter = "all" | "open" | "pending" | "closed";
export type SidePanel = "copilot" | "customer";

export interface Toast {
  id: number;
  message: string;
  tone: "success" | "error" | "info";
}

// Side panel preference, remembered per browser
const PANEL_KEY = "helpdesk.sidePanel";
const panelListeners = new Set<() => void>();
function subscribePanel(listener: () => void) {
  panelListeners.add(listener);
  return () => panelListeners.delete(listener);
}
function readPanel(): SidePanel | null {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(PANEL_KEY);
  } catch {}
  if (saved === "copilot" || saved === "customer") return saved;
  // Collapsed by default where it would cover the conversation
  return saved === "none" || window.innerWidth < 1280 ? null : "copilot";
}
function writePanel(panel: SidePanel | null) {
  try {
    localStorage.setItem(PANEL_KEY, panel ?? "none");
  } catch {}
  panelListeners.forEach((l) => l());
}

// Message-IDs from real email aren't useful to show; replayed Gorgias ids are short
const showSourceId = (id: string | null | undefined) => !!id && /^[\w-]{1,24}$/.test(id);

// The session expired or was revoked: a full page load, so no customer data stays in memory
// eslint-disable-next-line @next/next/no-location-assign-relative-destination
const toSignIn = () => window.location.assign("/login");

// Simulated tickets carry their full conversation
function simMessages(detail: TicketDetail): TicketMessage[] {
  const { ticket } = detail;
  const name = ticket.customerName ?? ticket.customerEmail ?? "Customer";
  const opened = ticket.tags === "email" ? "Received by email" : "Simulated ticket opened";
  const messages: TicketMessage[] = [
    {
      id: 0,
      type: "system",
      content: `${opened}${ticket.orderName ? ` about order ${ticket.orderName}` : ""}${
        showSourceId(ticket.sourceTicketId) ? ` · replayed from #${ticket.sourceTicketId}` : ""
      }`,
      timestamp: formatTime(ticket.createdAt),
      date: ticket.createdAt,
    },
  ];
  detail.messages!.forEach((m, i) => {
    const time = formatTime(m.createdAt);
    if (m.author === "system") {
      messages.push({ id: m.id, type: "system", content: m.body, timestamp: time, date: m.createdAt });
      return;
    }
    const sender = m.sender ?? (m.author === "customer" ? name : "Agent");
    messages.push({
      id: m.id,
      type: m.author,
      sender,
      avatar: initials(sender),
      channel: "Email",
      ...(i === 0 ? { emailSubject: ticket.subject ?? "(no subject)" } : {}),
      timestamp: time,
      date: m.createdAt,
      content: m.body,
    });
  });
  if (ticket.closedAt) {
    messages.push({
      id: Number.MAX_SAFE_INTEGER,
      type: "system",
      content: "Ticket closed",
      timestamp: formatTime(ticket.closedAt),
      date: ticket.closedAt,
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
      content: `Ticket opened via ${ticket.channel ?? "email"}${
        ticket.integration ? ` (${ticket.integration})` : ""
      }`,
      timestamp: formatTime(ticket.createdAt),
      date: ticket.createdAt,
    },
    {
      id: 2,
      type: "customer",
      sender: name,
      avatar: initials(name),
      channel: "Email",
      emailSubject: ticket.subject ?? "(no subject)",
      timestamp: formatTime(ticket.createdAt),
      date: ticket.createdAt,
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
      content: `Closed${
        ticket.assigneeName ? ` by ${ticket.assigneeName}` : ""
      } · first response ${formatDuration(ticket.firstResponseSeconds)} · resolved in ${formatDuration(
        ticket.resolutionSeconds,
      )}`,
      timestamp: formatTime(ticket.closedAt),
      date: ticket.closedAt,
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
  const [statusFilter, setStatusFilterState] = useState<StatusFilter>("all");
  const statusRef = useRef<StatusFilter>("all");

  // Right-hand panel (AI copilot or customer details); null when collapsed
  const sidePanel = useSyncExternalStore(subscribePanel, readPanel, () => "copilot" as SidePanel);
  const setSidePanel = useCallback((panel: SidePanel | null) => writePanel(panel), []);

  // Toasts
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);
  const notify = useCallback(
    (message: string, tone: Toast["tone"] = "success") => {
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev.slice(-2), { id, message, tone }]);
      setTimeout(() => dismissToast(id), tone === "error" ? 7000 : 3500);
    },
    [dismissToast],
  );

  const [sending, setSending] = useState(false);

  // Selected ticket
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [ticketDetail, setTicketDetail] = useState<TicketDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const detailRequest = useRef(0);

  // Bumped by every first-page request; responses from an older list are dropped
  const listRequest = useRef(0);

  const fetchTickets = useCallback(async (query: string, offset: number, quiet = false) => {
    const request = offset === 0 ? ++listRequest.current : listRequest.current;
    const current = () => request === listRequest.current;
    if (!quiet) setTicketsLoading(true);
    setTicketsError(null);
    try {
      const params = new URLSearchParams({
        q: query,
        offset: String(offset),
        limit: String(PAGE_SIZE),
        source: sourceRef.current,
      });
      if (sourceRef.current === "sim" && statusRef.current !== "all") {
        params.set("status", statusRef.current);
      }
      const res = await fetch(`/api/helpdesk/tickets?${params}`);
      if (res.status === 401) toSignIn();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as TicketListResponse;
      if (!current()) return [];
      setTickets((prev) => (offset === 0 ? data.tickets : [...prev, ...data.tickets]));
      setTicketTotal(data.total);
      return data.tickets;
    } catch (err) {
      if (current()) setTicketsError(err instanceof Error ? err.message : "Request failed");
      return [];
    } finally {
      if (current()) setTicketsLoading(false);
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
      setDetailError(null);
      try {
        const res = await fetch(`/api/helpdesk/tickets/${id}`);
        if (res.status === 401) toSignIn();
        if (!res.ok) throw new Error(res.status === 404 ? "Ticket not found" : `HTTP ${res.status}`);
        const detail = (await res.json()) as TicketDetail;
        if (request !== detailRequest.current) return;
        applyDetail(detail, false);
      } catch (err) {
        if (request === detailRequest.current) {
          setDetailError(err instanceof Error ? err.message : "Request failed");
        }
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
  }, [ticketQuery, ticketSource, statusFilter, fetchTickets, selectTicket]);

  const setStatusFilter = useCallback((filter: StatusFilter) => {
    statusRef.current = filter;
    setTickets([]);
    setTicketTotal(0);
    setStatusFilterState(filter);
  }, []);

  const setTicketSource = useCallback((source: TicketSource) => {
    sourceRef.current = source;
    statusRef.current = "all";
    setStatusFilterState("all");
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
    async (direction: -1 | 1) => {
      const index = tickets.findIndex((t) => t.id === selectedTicketId);
      if (index < 0) return;
      const next = tickets[index + direction];
      if (next) return selectTicket(next.id);
      // At the end of the loaded page: fetch the next one and continue into it
      if (direction === 1 && tickets.length < ticketTotal && !ticketsLoading) {
        const more = await fetchTickets(ticketQuery, tickets.length);
        if (more[0] && selectedRef.current === selectedTicketId) selectTicket(more[0].id);
      }
    },
    [tickets, selectedTicketId, selectTicket, ticketTotal, ticketsLoading, fetchTickets, ticketQuery],
  );

  // Message management
  const addMessage = useCallback((message: Omit<TicketMessage, "id">) => {
    setState((prev) => ({
      ...prev,
      messages: [...prev.messages, { ...message, id: Date.now() }],
    }));
  }, []);

  // Idempotency key of the email reply in flight or last failed: sending the same text to the
  // same ticket again reuses it, so the server never emails one reply twice
  const pendingEmailReply = useRef<{ ticketId: string; body: string; key: string } | null>(null);

  // Resolves true once the reply is saved (and emailed, for email tickets)
  const sendAgentMessage = useCallback(
    async (
      content: string,
      channel: "Chat" | "Email" = "Email",
      emailSubject?: string,
    ): Promise<boolean> => {
      if (!content.trim()) return false;
      const id = selectedRef.current;
      if (!id || ticketDetail?.ticket.id !== id) {
        notify("Wait for the ticket to finish loading, then send again", "error");
        return false;
      }
      if (id.startsWith("SIM-")) {
        // Simulated tickets: save the reply so the simulated customer can answer it
        // Email tickets: really sends to the customer (password-protected route)
        const isEmail = ticketDetail.ticket.tags === "email";
        let idempotencyKey: string | undefined;
        if (isEmail) {
          const last = pendingEmailReply.current;
          idempotencyKey =
            last?.ticketId === id && last.body === content.trim() ? last.key : crypto.randomUUID();
          pendingEmailReply.current = { ticketId: id, body: content.trim(), key: idempotencyKey };
        }
        setSending(true);
        try {
          const res = await fetch(
            isEmail
              ? `/api/helpdesk/email/tickets/${id}/reply`
              : `/api/helpdesk/sim/tickets/${id}/messages`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ author: "agent", body: content, sender: "You", idempotencyKey }),
            },
          );
          if (!res.ok) {
            const err = (await res.json().catch(() => null)) as { error?: string } | null;
            // 409/500 from the email route: it may already have been emailed, and the message says so
            const maybeSent = isEmail && (res.status === 409 || res.status === 500) && err?.error;
            notify(maybeSent || `Reply not sent: ${err?.error ?? `HTTP ${res.status}`}`, "error");
            return false;
          }
          if (pendingEmailReply.current?.key === idempotencyKey) pendingEmailReply.current = null;
          setState((prev) => (prev.composeText === content ? { ...prev, composeText: "" } : prev));
          if (selectedRef.current === id) applyDetail((await res.json()) as TicketDetail, true);
          notify(isEmail ? "Reply emailed to the customer" : "Reply sent");
          fetchTickets(ticketQuery, 0, true);
          return true;
        } catch {
          notify("Reply not sent: network error", "error");
          return false;
        } finally {
          setSending(false);
        }
      }
      // Archived tickets: the reply only lives in this view
      setState((prev) => ({
        ...prev,
        messages: [
          ...prev.messages,
          {
            id: Date.now(),
            type: "agent" as const,
            sender: "You",
            avatar: initials("You"),
            channel,
            timestamp: formatTime(new Date().toISOString()),
            date: new Date().toISOString(),
            content,
            ...(channel === "Email" && emailSubject ? { emailSubject } : {}),
          },
        ],
        composeText: "",
      }));
      return true;
    },
    [applyDetail, ticketDetail, notify, fetchTickets, ticketQuery],
  );

  // Ticket status
  const setTicketStatus = useCallback(
    async (status: TicketStatus, ticketId?: string): Promise<boolean> => {
      const id = ticketId ?? selectedRef.current;
      const onScreen = () => selectedRef.current === id;
      if (!id?.startsWith("SIM-")) {
        if (onScreen()) setState((prev) => ({ ...prev, ticketStatus: status }));
        return true;
      }
      let previous: TicketStatus = "open";
      if (onScreen()) {
        setState((prev) => {
          previous = prev.ticketStatus;
          return { ...prev, ticketStatus: status };
        });
      }
      try {
        const res = await fetch(`/api/helpdesk/sim/tickets/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: status === "resolved" ? "closed" : status }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (selectedRef.current === id) applyDetail((await res.json()) as TicketDetail, true);
        notify(
          status === "closed"
            ? `${id} closed`
            : status === "pending"
              ? `${id} marked as waiting on customer`
              : `${id} reopened`,
        );
        fetchTickets(ticketQuery, 0, true);
        return true;
      } catch (err) {
        if (onScreen()) setState((prev) => ({ ...prev, ticketStatus: previous }));
        notify(`Couldn't update ${id}: ${err instanceof Error ? err.message : "error"}`, "error");
        return false;
      }
    },
    [applyDetail, notify, fetchTickets, ticketQuery],
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
        statusFilter,
        setStatusFilter,
        sidePanel,
        setSidePanel,
        toasts,
        notify,
        dismissToast,
        sending,
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
        detailError,
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
