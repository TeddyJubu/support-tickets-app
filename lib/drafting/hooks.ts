// What happens after a draft is saved: an urgent result that intake didn't catch alerts
// the owner (once per ticket and severity).

import type { Classification, Severity } from "../classifier";
import { getDb } from "../sim-db";
import { urgentTicket } from "../notify";

export interface DraftSavedEvent {
  ticketId: string;
  draftId: number;
  severity: Severity;
  sensitive: boolean;
  classification: Classification;
}

export function onDraftSaved(event: DraftSavedEvent) {
  if (event.severity === "high" || event.severity === "critical") {
    urgentTicket(getDb(), event.ticketId, event.severity, event.classification.reason || "the AI review rated it urgent");
  }
}
