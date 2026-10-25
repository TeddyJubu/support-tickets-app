// Pure helpers for organizing the notification bell; safe to import in the browser.

export interface NotificationItem {
  id: number;
  kind: string;
  ticketId: string | null;
  text: string;
  createdAt: string;
  read: boolean;
}

export interface NotificationGroup {
  key: string;
  ticketId: string | null;
  items: NotificationItem[];
  ids: number[];
  text: string;
  createdAt: string;
  unread: boolean;
  count: number;
  kind: string;
}

/** Group the bell's recent notifications by ticket, keeping unticketed events separate. */
export function groupNotifications(items: NotificationItem[]): NotificationGroup[] {
  const groups = new Map<string, NotificationGroup>();
  for (const item of items) {
    const key = item.ticketId ? `ticket:${item.ticketId}` : `notification:${item.id}`;
    const group = groups.get(key);
    if (group) {
      group.items.push(item);
      group.ids.push(item.id);
      group.unread ||= !item.read;
      group.count++;
      continue;
    }
    groups.set(key, {
      key,
      ticketId: item.ticketId,
      items: [item],
      ids: [item.id],
      text: item.text,
      createdAt: item.createdAt,
      unread: !item.read,
      count: 1,
      kind: item.kind,
    });
  }
  return [...groups.values()].map((group) => {
    const urgent = group.items.filter((item) => item.kind === "urgent");
    const hasHigh = urgent.some((item) => /^High priority:/i.test(item.text));
    const critical = urgent.find((item) => /^Critical:/i.test(item.text));
    if (!hasHigh || !critical) return group;
    return {
      ...group,
      text: `Priority increased from High to Critical: ${critical.text.replace(/^Critical:\s*/i, "")}`,
    };
  });
}
