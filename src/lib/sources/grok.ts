import { promises as fs } from "node:fs";
import { createReadStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import type { UsageEvent } from "../types";
import { positiveNumber, record, timestampToIso, walkFiles } from "./shared";

const GROK_SESSIONS_DIR = path.join(os.homedir(), ".grok", "sessions");
// xAI reports billed cost as integer ticks: 1 USD = 10^10 cost ticks.
const COST_TICKS_PER_USD = 10_000_000_000;
const UNKNOWN_MODEL = "grok-unknown";

function decodeProjectSlug(slug: string): string {
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
}

/**
 * Read per-turn usage from the Grok Code CLI. Each session dir
 * (`~/.grok/sessions/<url-encoded-project>/<session-id>/`) keeps an
 * `updates.jsonl`; a `turn_completed` session update carries the turn's
 * incremental usage, including per-model breakdown and billed cost ticks.
 */
export async function readGrokUsageFromRoots(roots: string[], sinceDate: string): Promise<UsageEvent[]> {
  const since = new Date(`${sinceDate}T00:00:00.000Z`).getTime();
  const files: Array<{ file: string; root: string }> = [];
  for (const root of roots) {
    for (const file of await walkFiles(root, (candidate) => path.basename(candidate) === "updates.jsonl")) {
      files.push({ file, root });
    }
  }

  const events: UsageEvent[] = [];
  for (const { file, root } of files) {
    const stat = await fs.stat(file).catch(() => null);
    if (!stat || stat.mtimeMs < since) continue;

    const rel = path.relative(root, file).split(path.sep);
    const project = decodeProjectSlug(rel[0] ?? "unknown");
    const sessionId = path.basename(path.dirname(file));

    const rl = readline.createInterface({
      input: createReadStream(file, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line || line.length < 30) continue;
      if (!line.includes("turn_completed") || !line.includes('"usage"')) continue;
      let row: Record<string, unknown>;
      try {
        row = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      const update = record((row.params as Record<string, unknown> | undefined)?.update);
      if (!update || update.sessionUpdate !== "turn_completed") continue;
      const usage = record(update.usage);
      if (!usage) continue;

      const timestamp = timestampToIso(row.timestamp);
      if (!timestamp || new Date(timestamp).getTime() < since) continue;

      const modelUsage = record(usage.modelUsage);
      const details: Array<[string, Record<string, unknown>]> =
        modelUsage && Object.keys(modelUsage).length > 0
          ? Object.entries(modelUsage) as Array<[string, Record<string, unknown>]>
          : [[UNKNOWN_MODEL, usage]];

      for (const [model, detail] of details) {
        const input = positiveNumber(detail.inputTokens);
        const output = positiveNumber(detail.outputTokens);
        const cacheRead = positiveNumber(detail.cachedReadTokens);
        if (input + output === 0) continue;
        events.push({
          source: "grok",
          timestamp,
          model,
          inputTokens: Math.max(0, input - cacheRead),
          outputTokens: output,
          cacheCreateTokens: 0,
          cacheReadTokens: cacheRead,
          project,
          sessionId,
          costUSD: positiveNumber(detail.costUsdTicks) / COST_TICKS_PER_USD,
        });
      }
    }
  }
  return events;
}

export function readGrokUsage(sinceDate: string): Promise<UsageEvent[]> {
  return readGrokUsageFromRoots([GROK_SESSIONS_DIR], sinceDate);
}
