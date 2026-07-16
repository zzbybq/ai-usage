import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { costFor } from "../pricing";
import type { UsageEvent } from "../types";
import { positiveNumber, record, timestampToIso, walkFiles } from "./shared";

function defaultRoots(): string[] {
  const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return [
    path.join(os.homedir(), ".cline", "data", "tasks"),
    path.join(appData, "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "tasks"),
  ];
}

async function taskMetadata(taskDirectory: string): Promise<Record<string, unknown>> {
  for (const name of ["task_metadata.json", "metadata.json"]) {
    try {
      return JSON.parse(await fs.readFile(path.join(taskDirectory, name), "utf8")) as Record<string, unknown>;
    } catch {
      // Try the next metadata filename.
    }
  }
  return {};
}

/** Parse Cline's local per-task UI ledger, where completed API rows carry token/cost totals. */
export async function readClineUsageFromRoots(roots: string[], sinceDate: string): Promise<UsageEvent[]> {
  const since = new Date(`${sinceDate}T00:00:00.000Z`).getTime();
  const files = new Set<string>();
  for (const root of roots) {
    for (const file of await walkFiles(root, (candidate) => path.basename(candidate) === "ui_messages.json")) {
      files.add(file);
    }
  }

  const events: UsageEvent[] = [];
  for (const file of files) {
    const stat = await fs.stat(file).catch(() => null);
    if (!stat || stat.mtimeMs < since) continue;
    let rows: unknown[];
    try {
      const parsed = JSON.parse(await fs.readFile(file, "utf8"));
      rows = Array.isArray(parsed) ? parsed : [];
    } catch {
      continue;
    }
    const taskDirectory = path.dirname(file);
    const taskId = path.basename(taskDirectory);
    const metadata = await taskMetadata(taskDirectory);
    const metadataModel = metadata.model ?? metadata.modelId ?? metadata.apiModelId;
    const project = metadata.workspace ?? metadata.cwd ?? metadata.projectPath;

    rows.forEach((value, index) => {
      const row = record(value);
      if (!row || row.type !== "say" || row.say !== "api_req_started" || typeof row.text !== "string") return;
      let info: Record<string, unknown>;
      try {
        info = JSON.parse(row.text) as Record<string, unknown>;
      } catch {
        return;
      }
      const input = positiveNumber(info.tokensIn);
      const output = positiveNumber(info.tokensOut);
      const cacheWrite = positiveNumber(info.cacheWrites);
      const cacheRead = positiveNumber(info.cacheReads);
      if (input + output + cacheWrite + cacheRead === 0) return;
      const timestamp = timestampToIso(row.ts ?? info.timestamp, stat.mtimeMs);
      if (!timestamp || new Date(timestamp).getTime() < since) return;
      const model = String(info.model ?? info.modelId ?? info.apiModelId ?? metadataModel ?? "cline-unknown");
      const reportedCost = Number(info.cost);
      events.push({
        source: "cline",
        timestamp,
        model,
        inputTokens: input,
        outputTokens: output,
        cacheCreateTokens: cacheWrite,
        cacheReadTokens: cacheRead,
        project: project == null ? undefined : String(project),
        sessionId: taskId,
        messageId: String(row.conversationHistoryIndex ?? `${taskId}:${index}`),
        costUSD: Number.isFinite(reportedCost) && reportedCost >= 0
          ? reportedCost
          : costFor(model, { input, output, cacheCreate: cacheWrite, cacheRead }),
      });
    });
  }
  return events;
}

export function readClineUsage(sinceDate: string): Promise<UsageEvent[]> {
  return readClineUsageFromRoots(defaultRoots(), sinceDate);
}
