// What happens after a draft is saved (owner alerts and notifications plug in here)

import type { Classification, Severity } from "../classifier";

export interface DraftSavedEvent {
  ticketId: string;
  draftId: number;
  severity: Severity;
  sensitive: boolean;
  classification: Classification;
}

export function onDraftSaved(event: DraftSavedEvent) {
  void event;
}
