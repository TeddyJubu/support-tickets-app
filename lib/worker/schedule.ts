// Scheduled maintenance run by the worker. Last-run times live in the database, so a
// restart doesn't re-run a daily task or skip one that came due while it was down.

import { pruneSessions } from "../auth";
import { pruneNotices } from "../kb/notices";
import { syncProducts } from "../kb/products";
import { rebuildIndex } from "../kb/index";
import { getState, setState } from "./state";
import { promoteApprovedLessons } from "../learning";

export interface Task {
  name: string;
  /** Run every N minutes, or once a day at a UTC time "HH:MM" */
  everyMinutes?: number;
  dailyAtUtc?: string;
  run: () => Promise<unknown> | unknown;
}

const tasks: Task[] = [
  { name: "prune-sessions", everyMinutes: 60, run: () => pruneSessions() },
  { name: "prune-notices", dailyAtUtc: "04:00", run: () => ({ removed: pruneNotices() }) },
  {
    name: "product-sync",
    dailyAtUtc: "03:00",
    run: async () => {
      const sync = syncProducts();
      return sync.ok ? { sync, index: await rebuildIndex("product-sync") } : { sync };
    },
  },
  {
    // Approved lessons become masked examples in the KB, then the index picks them up
    name: "learning",
    dailyAtUtc: "03:30",
    run: async () => {
      const promoted = promoteApprovedLessons();
      return promoted ? { promoted, index: await rebuildIndex("learning") } : { promoted };
    },
  },
];

export function registerTask(task: Task) {
  if (!tasks.some((t) => t.name === task.name)) tasks.push(task);
}

export const listTasks = () => tasks.map((t) => ({ ...t, last: getState<{ ok: boolean; result?: unknown; error?: string }>(`task:${t.name}`) }));

export function isDue(task: Task, lastRunIso: string | null, now = new Date()) {
  const last = lastRunIso ? Date.parse(lastRunIso) : 0;
  if (task.everyMinutes) return now.getTime() - last >= task.everyMinutes * 60_000;
  if (task.dailyAtUtc) {
    const [h, m] = task.dailyAtUtc.split(":").map(Number);
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m));
    const due = now >= today ? today : new Date(today.getTime() - 86400e3);
    return last < due.getTime();
  }
  return false;
}

/** Runs every due task once, one after another; failures are recorded, never thrown */
export async function runDueTasks(log: (msg: string) => void, now = new Date()) {
  for (const task of tasks) {
    const last = getState<unknown>(`task:${task.name}`);
    if (!isDue(task, last?.updatedAt ?? null, now)) continue;
    const started = Date.now();
    try {
      const result = await task.run();
      setState(`task:${task.name}`, { ok: true, result: result ?? null, ms: Date.now() - started });
      log(`task ${task.name} ok (${Date.now() - started} ms)`);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      setState(`task:${task.name}`, { ok: false, error, ms: Date.now() - started });
      log(`task ${task.name} FAILED: ${error}`);
    }
  }
}
