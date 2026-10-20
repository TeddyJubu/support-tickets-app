// Background worker: drafts AI replies from the job queue and runs scheduled maintenance.
//   npm run worker                (systemd: support-tickets-worker.service)
// One instance at a time (data/worker.lock), one job at a time. SIGTERM lets the current job
// finish (up to the job timeout) before exiting. A job that times out keeps the worker from
// claiming new work until the old attempt has really stopped.

import { closeSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@/lib/db";
import { getDb } from "@/lib/sim-db";
import { claimNextJob, recoverStaleJobs } from "@/lib/drafting/queue";
import { processJob, JOB_TIMEOUT_MS } from "@/lib/drafting/run";
import { setState, type Heartbeat } from "@/lib/worker/state";
import { runDueTasks } from "@/lib/worker/schedule";
import { loadEnv } from "./env";

loadEnv();
const WORKER_ID = `worker-${process.pid}`;
const IDLE_MS = 2_000;
const lockPath = join(dataDir(), "worker.lock");
const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);

function acquireLock() {
  try {
    const fd = openSync(lockPath, "wx");
    writeFileSync(fd, String(process.pid));
    closeSync(fd);
    return true;
  } catch {
    // A lock left by a dead process can be taken over
    const pid = Number(readFileSync(lockPath, "utf8").trim());
    try {
      if (pid) process.kill(pid, 0);
      return false;
    } catch {
      rmSync(lockPath, { force: true });
      return acquireLock();
    }
  }
}

if (!acquireLock()) {
  console.error(`Another worker is running (see ${lockPath}). Exiting.`);
  process.exit(1);
}

let stopping = false;
let inFlight: Promise<unknown> | null = null;
const startedAt = new Date().toISOString();
const beat: Heartbeat = { pid: process.pid, startedAt, current: null, lastJobAt: null };
const heartbeat = () => setState("heartbeat", beat);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    log(`${signal}: finishing the current job, then exiting`);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loop() {
  getDb(); // migrate before anything else
  log(`started (pid ${process.pid})`);
  let lastTasks = 0;
  while (!stopping) {
    heartbeat();
    recoverStaleJobs(getDb());
    const job = claimNextJob(getDb(), WORKER_ID);
    if (!job) {
      // Maintenance only while the queue is empty, so drafts never wait behind it
      if (Date.now() - lastTasks > 30_000) {
        lastTasks = Date.now();
        await runDueTasks(log);
        heartbeat();
      }
      await sleep(IDLE_MS);
      continue;
    }
    beat.current = { jobId: job.id, ticketId: job.ticketId };
    heartbeat();
    log(`job ${job.id} ${job.ticketId} (attempt ${job.attempts})`);
    const run = processJob(job);
    inFlight = run;
    const pulse = setInterval(heartbeat, 15_000);
    try {
      const outcome = await run;
      log(`job ${job.id} → ${outcome.state}${"error" in outcome && outcome.error ? `: ${outcome.error}` : ""}`);
    } finally {
      clearInterval(pulse);
      inFlight = null;
      beat.current = null;
      beat.lastJobAt = new Date().toISOString();
      heartbeat();
    }
  }
}

loop()
  .catch((err) => {
    log(`worker crashed: ${err instanceof Error ? err.stack : err}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (inFlight) await Promise.race([inFlight, sleep(JOB_TIMEOUT_MS)]);
    rmSync(lockPath, { force: true });
    log("stopped");
    process.exit();
  });
