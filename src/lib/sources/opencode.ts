import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { costFor } from "../pricing";
import type { UsageEvent } from "../types";
import { positiveNumber, record, timestampToIso, walkFiles } from "./shared";

type OpenCodeRow = {
  id?: unknown;
  session_id?: unknown;
  time_created?: unknown;
  data?: unknown;
  directory?: unknown;
};

function dataRoot(): string {
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "opencode");
}

function eventFromMessage(
  row: OpenCodeRow,
  since: number,
  fallbackTimestamp?: number
): UsageEvent | null {
  let data: Record<string, unknown> | null;
  try {
    data = typeof row.data === "string" ? record(JSON.parse(row.data)) : record(row.data);
  } catch {
    return null;
  }
  if (!data || data.role !== "assistant") return null;
  const tokens = record(data.tokens);
  const cache = record(tokens?.cache);
  const time = record(data.time);
  const input = positiveNumber(tokens?.input);
  const output = positiveNumber(tokens?.output) + positiveNumber(tokens?.reasoning);
  const cacheRead = positiveNumber(cache?.read);
  const cacheWrite = positiveNumber(cache?.write);
  if (input + output + cacheRead + cacheWrite === 0) return null;
  const timestamp = timestampToIso(time?.completed ?? time?.created ?? row.time_created, fallbackTimestamp);
  if (!timestamp || new Date(timestamp).getTime() < since) return null;
  const model = String(data.modelID ?? data.modelId ?? "opencode-unknown");
  const reportedCost = Number(data.cost);
  return {
    source: "opencode",
    timestamp,
    model,
    inputTokens: input,
    outputTokens: output,
    cacheCreateTokens: cacheWrite,
    cacheReadTokens: cacheRead,
    project: row.directory == null ? undefined : String(row.directory),
    sessionId: String(row.session_id ?? data.sessionID ?? "unknown"),
    messageId: String(row.id ?? data.id ?? ""),
    costUSD: Number.isFinite(reportedCost) && reportedCost >= 0
      ? reportedCost
      : costFor(model, { input, output, cacheCreate: cacheWrite, cacheRead }),
  };
}

async function databaseFiles(root: string): Promise<string[]> {
  const files = new Set<string>();
  if (process.env.OPENCODE_DB && existsSync(process.env.OPENCODE_DB)) files.add(process.env.OPENCODE_DB);
  let entries = [] as string[];
  try {
    entries = await fs.readdir(root);
  } catch {
    return [...files];
  }
  for (const name of entries) {
    if (/^opencode(?:-[^.]+)?\.db$/i.test(name)) files.add(path.join(root, name));
  }
  return [...files];
}

export async function readOpenCodeUsageFromRoot(root: string, sinceDate: string): Promise<UsageEvent[]> {
  const since = new Date(`${sinceDate}T00:00:00.000Z`).getTime();
  const events = new Map<string, UsageEvent>();

  for (const databaseFile of await databaseFiles(root)) {
    let database: DatabaseSync | null = null;
    try {
      database = new DatabaseSync(databaseFile, { readOnly: true });
      const rows = database.prepare(`SELECT m.id, m.session_id, m.time_created, m.data, s.directory
        FROM message m LEFT JOIN session s ON s.id = m.session_id
        WHERE m.time_created >= ?`).all(since) as OpenCodeRow[];
      for (const row of rows) {
        const event = eventFromMessage(row, since);
        if (event) events.set(`${event.sessionId}:${event.messageId}`, event);
      }
    } catch {
      // A different release channel may be mid-migration; continue with other DBs/legacy JSON.
    } finally {
      database?.close();
    }
  }

  const legacyRoot = path.join(root, "storage", "message");
  for (const file of await walkFiles(legacyRoot, (candidate) => candidate.endsWith(".json"))) {
    const stat = await fs.stat(file).catch(() => null);
    if (!stat || stat.mtimeMs < since) continue;
    let data: unknown;
    try {
      data = JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
      continue;
    }
    const sessionId = path.basename(path.dirname(file));
    const event = eventFromMessage({
      id: path.basename(file, ".json"),
      session_id: sessionId,
      data,
    }, since, stat.mtimeMs);
    if (event) events.set(`${event.sessionId}:${event.messageId}`, event);
  }
  return [...events.values()];
}

export function readOpenCodeUsage(sinceDate: string): Promise<UsageEvent[]> {
  return readOpenCodeUsageFromRoot(dataRoot(), sinceDate);
}
