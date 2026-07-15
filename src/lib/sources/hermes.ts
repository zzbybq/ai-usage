import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { costFor } from "../pricing";
import type { UsageEvent } from "../types";
import { emptyHermesUsageState, localDayKey, reconcileHermesUsage, type HermesUsageState, type ObservedHermesSession } from "./hermes-state";

function positiveInt(value: unknown): number {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : 0;
}
function epochToMs(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number * 1000) : null;
}
function findHermesDb(): string | null {
  const primary = path.join(os.homedir(), ".hermes", "state.db");
  if (existsSync(primary)) return primary;
  if (process.platform !== "win32" || !process.env.LOCALAPPDATA) return null;
  for (const directory of ["hermes", "Hermes"]) {
    const fallback = path.join(process.env.LOCALAPPDATA, directory, "state.db");
    if (existsSync(fallback)) return fallback;
  }
  return null;
}

const STATE_FILE = process.env.HERMES_USAGE_STATE_FILE || path.join(/* turbopackIgnore: true */ os.homedir(), ".ai-usage", "hermes-usage-state.json");
let stateQueue: Promise<void> = Promise.resolve();
function withStateLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = stateQueue.then(operation, operation);
  stateQueue = result.then(() => undefined, () => undefined);
  return result;
}
async function loadState(): Promise<HermesUsageState> {
  try {
    const parsed = JSON.parse(await fs.readFile(/* turbopackIgnore: true */ STATE_FILE, "utf8")) as HermesUsageState;
    if (parsed.version !== 1 || !parsed.sessions || !parsed.events) throw new Error("unsupported state schema");
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyHermesUsageState();
    throw new Error(`Cannot read Hermes usage state at ${STATE_FILE}`, { cause: error });
  }
}
async function saveState(state: HermesUsageState): Promise<void> {
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
  const temporary = `${STATE_FILE}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(/* turbopackIgnore: true */ temporary, JSON.stringify(state), "utf8");
  await fs.rename(/* turbopackIgnore: true */ temporary, STATE_FILE);
}

/** Read Hermes usage, splitting cumulative session counters into daily deltas. */
export async function readHermesUsage(sinceDate: string): Promise<UsageEvent[]> {
  const dbPath = findHermesDb();
  if (!dbPath) return [];
  let db: DatabaseSync;
  try { db = new DatabaseSync(dbPath, { readOnly: true }); }
  catch (error) { throw new Error(`Cannot open Hermes database at ${dbPath}`, { cause: error }); }
  let rows: Record<string, unknown>[];
  try {
    rows = db.prepare(`SELECT id, model, started_at, ended_at,
      input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
      cwd, actual_cost_usd, estimated_cost_usd, cost_status FROM sessions`).all();
  } catch (error) {
    throw new Error(`Cannot read Hermes sessions from ${dbPath}; the database schema may be incompatible`, { cause: error });
  } finally { db.close(); }

  const sessions: ObservedHermesSession[] = [];
  for (const row of rows) {
    const id = String(row.id ?? "").trim();
    const classifyMs = epochToMs(row.ended_at) ?? epochToMs(row.started_at);
    if (!id || classifyMs == null) continue;
    const inputTokens = positiveInt(row.input_tokens), outputTokens = positiveInt(row.output_tokens);
    const cacheReadTokens = positiveInt(row.cache_read_tokens), cacheCreateTokens = positiveInt(row.cache_write_tokens);
    if (inputTokens + outputTokens + cacheReadTokens + cacheCreateTokens === 0) continue;
    const model = String(row.model ?? "unknown").trim() || "unknown";
    const actual = typeof row.actual_cost_usd === "number" && row.actual_cost_usd >= 0 ? row.actual_cost_usd : null;
    const estimated = typeof row.estimated_cost_usd === "number" && row.estimated_cost_usd >= 0 ? row.estimated_cost_usd : null;
    const status = row.cost_status == null ? null : String(row.cost_status);
    sessions.push({
      id, model, classifyMs, inputTokens, outputTokens, cacheCreateTokens, cacheReadTokens,
      project: row.cwd == null ? undefined : String(row.cwd),
      resolvedCostUSD: actual ?? (status === "included" ? 0 : null) ?? (status === "estimated" ? estimated : null) ??
        costFor(model, { input: inputTokens, output: outputTokens, cacheCreate: cacheCreateTokens, cacheRead: cacheReadTokens }),
    });
  }
  return withStateLock(async () => {
    const state = reconcileHermesUsage(await loadState(), sessions, Date.now());
    await saveState(state);
    return Object.values(state.events)
      .filter((event) => localDayKey(new Date(event.timestamp).getTime()) >= sinceDate)
      .map((event) => ({ source: "hermes" as const, ...event }));
  });
}
