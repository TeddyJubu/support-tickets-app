import { timingSafeEqual } from "node:crypto";

// Bearer-token check for simulator endpoints (SIM_API_KEY in .env.local)
export function isSimulatorRequest(request: Request) {
  const expected = process.env.SIM_API_KEY ?? "";
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!expected || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

export const unauthorized = () => Response.json({ error: "Unauthorized" }, { status: 401 });
