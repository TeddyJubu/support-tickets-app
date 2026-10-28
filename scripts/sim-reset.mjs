// `npm run simulate -- --reset`: deletes the simulator's tickets (channel 'simulator') and the
// rows that hang off them. Real email and staff-opened tickets, their customers, the sent-mail
// log and lessons from real replies are never touched.

// Rows that reference tickets go first (foreign keys are enforced); drafts before jobs
const BY_TICKET = [
  "attachments", "drafts", "jobs", "ticket_tags", "ticket_reads", "sim_email_ids", "sim_email_outbox",
  "store_snapshots", "sim_returns", "lessons", "send_reviews", "notifications",
];

const SIMULATED = `SELECT id FROM sim_tickets WHERE channel = 'simulator'`;

/** @param {import("node:sqlite").DatabaseSync} db */
export function resetSimulated(db) {
  const exists = (t) => db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  db.exec("PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE");
  try {
    for (const t of BY_TICKET) if (exists(t)) db.exec(`DELETE FROM ${t} WHERE ticket_id IN (${SIMULATED})`);
    db.exec(`DELETE FROM sim_messages WHERE ticket_id IN (${SIMULATED})`);
    const tickets = Number(db.prepare(`DELETE FROM sim_tickets WHERE channel = 'simulator'`).run().changes);
    // Simulated customers left without tickets; email customers stay even with none
    const customers = Number(
      db
        .prepare(
          `DELETE FROM sim_customers WHERE source_key NOT LIKE 'email:%'
             AND id NOT IN (SELECT customer_id FROM sim_tickets WHERE customer_id IS NOT NULL)`,
        )
        .run().changes,
    );
    const kept = Number(db.prepare(`SELECT count(*) AS c FROM sim_tickets`).get().c);
    // Ticket numbers restart at SIM-1001 only when no ticket is left to collide with
    if (!kept) db.exec(`DELETE FROM sqlite_sequence WHERE name = 'sim_tickets'`);
    db.exec("COMMIT");
    return { tickets, customers, kept };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
