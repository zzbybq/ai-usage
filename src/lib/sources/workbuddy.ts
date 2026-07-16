import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { costFor } from "../pricing";
import type { UsageEvent } from "../types";

const WB_DIR = path.join(os.homedir(), ".workbuddy");
const TRACES_DIR = path.join(WB_DIR, "traces");
const SESSIONS_DIR = path.join(WB_DIR, "sessions");

async function loadSessionCwd(pid: string): Promise<string | undefined> {
  try {
    const raw = await fs.readFile(path.join(SESSIONS_DIR, `${pid}.json`), "utf8");
    const session = JSON.parse(raw);
    return session.cwd as string | undefined;
  } catch {
    return undefined;
  }
}

export async function readWorkbuddyUsage(sinceDate: string): Promise<UsageEvent[]> {
  const since = new Date(sinceDate + "T00:00:00.000Z").getTime();
  const events: UsageEvent[] = [];

  let pidDirs: string[];
  try {
    pidDirs = await fs.readdir(TRACES_DIR);
  } catch {
    return events;
  }

  for (const pid of pidDirs) {
    const pidPath = path.join(TRACES_DIR, pid);
    let stat;
    try {
      stat = await fs.stat(pidPath);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    const cwd = await loadSessionCwd(pid);

    let traceFiles: string[];
    try {
      traceFiles = (await fs.readdir(pidPath)).filter((f) => f.startsWith("trace_") && f.endsWith(".json"));
    } catch {
      continue;
    }

    for (const file of traceFiles) {
      const filePath = path.join(pidPath, file);
      // Fast mtime check on the trace file itself
      let fileStat;
      try {
        fileStat = await fs.stat(filePath);
      } catch {
        continue;
      }
      if (fileStat.mtimeMs < since) continue;

      let raw: string;
      try {
        raw = await fs.readFile(filePath, "utf8");
      } catch {
        continue;
      }

      let doc: Record<string, unknown>;
      try {
        doc = JSON.parse(raw);
      } catch {
        continue;
      }

      const trace = doc.trace as Record<string, unknown> | undefined;
      if (!trace) continue;

      const totalTokens = Number(trace.totalTokens ?? 0);
      if (totalTokens === 0) continue;

      const startedAt = (trace.startedAt as string) ?? "";
      if (!startedAt) continue;
      const tsMs = new Date(startedAt).getTime();
      if (Number.isNaN(tsMs) || tsMs < since) continue;

      const modelInfo = trace.modelInfo as Record<string, unknown> | undefined;
      const models = modelInfo?.models as string[] | undefined;
      const model = models?.[0] ?? "unknown";
      if (model === "<synthetic>" || model === "unknown") continue;

      const inputTokens = Number(modelInfo?.totalInputTokens ?? 0);
      const outputTokens = Number(modelInfo?.totalOutputTokens ?? 0);
      const cachedTokens = Number(modelInfo?.totalCachedTokens ?? 0);

      if (inputTokens + outputTokens === 0) continue;

      const sessionId = (trace.sessionId as string) ?? pid;

      events.push({
        source: "workbuddy",
        timestamp: startedAt,
        model,
        inputTokens,
        outputTokens,
        cacheCreateTokens: 0,
        cacheReadTokens: cachedTokens,
        project: cwd,
        sessionId,
        costUSD: costFor(model, {
          input: inputTokens,
          output: outputTokens,
          cacheRead: cachedTokens,
        }),
      });
    }
  }

  return events;
}
