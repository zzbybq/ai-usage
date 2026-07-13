import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { costFor } from "../pricing";
import type { UsageEvent } from "../types";

function positiveInt(value: unknown): number {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function epochToMs(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number * 1000) : null;
}

/** Read cumulative session usage from the active Hermes database. */
export async function readHermesUsage(sinceDate: string): Promise<UsageEvent[]> {
  const dbPath = path.join(os.homedir(), ".hermes", "state.db");
  if (!existsSync(dbPath)) return [];

  let db: DatabaseSync;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch (error) {
    throw new Error(`Cannot open Hermes database at ${dbPath}`, { cause: error });
  }

  let rows: Record<string, unknown>[];
  try {
    rows = db.prepare(`SELECT id, model, started_at, ended_at,
      input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
      cwd, actual_cost_usd, estimated_cost_usd, cost_status FROM sessions`).all();
  } catch (error) {
    throw new Error(`Cannot read Hermes sessions from ${dbPath}; the database schema may be incompatible`, { cause: error });
  } finally {
    db.close();
  }

  const since = new Date(`${sinceDate}T00:00:00.000Z`).getTime();
  const events: UsageEvent[] = [];
  for (const row of rows) {
    const sessionId = String(row.id ?? "").trim();
    const timestampMs = epochToMs(row.ended_at) ?? epochToMs(row.started_at);
    if (!sessionId || timestampMs == null || timestampMs < since) continue;

    const input = positiveInt(row.input_tokens);
    const output = positiveInt(row.output_tokens);
    const cacheRead = positiveInt(row.cache_read_tokens);
    const cacheCreate = positiveInt(row.cache_write_tokens);
    if (input + output + cacheRead + cacheCreate === 0) continue;

    const model = String(row.model ?? "unknown").trim() || "unknown";
    const actual = typeof row.actual_cost_usd === "number" && row.actual_cost_usd >= 0 ? row.actual_cost_usd : null;
    const estimated = typeof row.estimated_cost_usd === "number" && row.estimated_cost_usd >= 0 ? row.estimated_cost_usd : null;
    const status = row.cost_status == null ? null : String(row.cost_status);
    events.push({
      source: "hermes",
      timestamp: new Date(timestampMs).toISOString(),
      model,
      inputTokens: input,
      outputTokens: output,
      cacheCreateTokens: cacheCreate,
      cacheReadTokens: cacheRead,
      project: row.cwd == null ? undefined : String(row.cwd),
      sessionId,
      costUSD: actual ?? (status === "included" ? 0 : null) ??
        (status === "estimated" ? estimated : null) ??
        costFor(model, { input, output, cacheCreate, cacheRead }),
    });
  }
  return events;
}
