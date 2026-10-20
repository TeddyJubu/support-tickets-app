// A staff member's in-app notifications (the bell)

import { getDb } from "./sim-db";

type Row = Record<string, unknown>;

export function myNotifications(userId: number, limit = 30) {
  const d = getDb();
  const unread = Number((d.prepare(`SELECT count(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL`).get(userId) as Row).c);
  const items = (d.prepare(`SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?`).all(userId, limit) as Row[]).map((r) => ({
    id: Number(r.id),
    kind: String(r.kind),
    ticketId: r.ticket_id == null ? null : String(r.ticket_id),
    text: String(r.text),
    createdAt: `${String(r.created_at).replace(" ", "T")}Z`,
    read: r.read_at != null,
  }));
  return { unread, items };
}

export function markNotificationsRead(userId: number, ids: number[] | "all") {
  const d = getDb();
  if (ids === "all") return d.prepare(`UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL`).run(userId).changes;
  let n = 0;
  for (const id of ids.slice(0, 100)) {
    n += Number(d.prepare(`UPDATE notifications SET read_at = datetime('now') WHERE id = ? AND user_id = ? AND read_at IS NULL`).run(id, userId).changes);
  }
  return n;
}
