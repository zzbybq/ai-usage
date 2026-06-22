import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { createReadStream } from "node:fs";
import { costFor } from "../pricing";
import type { UsageEvent } from "../types";

const CODEX_DIR = path.join(os.homedir(), ".codex", "sessions");

/** Parse a token field to a non-negative integer (0 for missing/garbage). */
function toInt(v: unknown): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function walkJsonl(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(p);
    }
  }
  await walk(root);
  return out;
}

export type CodexRateLimit = {
  primaryUsedPercent?: number;
  primaryResetsAt?: string;
  secondaryUsedPercent?: number;
  secondaryResetsAt?: string;
  planType?: string;
  observedAt: string;
};

export async function readCodexUsage(
  sinceDate: string
): Promise<{ events: UsageEvent[]; latestRateLimit: CodexRateLimit | null }> {
  const files = await walkJsonl(CODEX_DIR);
  const since = new Date(sinceDate + "T00:00:00.000Z").getTime();
  const events: UsageEvent[] = [];
  let latest: CodexRateLimit | null = null;

  for (const file of files) {
    const stat = await fs.stat(file).catch(() => null);
    if (!stat) continue;
    if (stat.mtimeMs < since) continue;

    const sessionId = path.basename(file).replace(/^rollout-.*-([0-9a-f-]{36})\.jsonl$/, "$1");

    let sessionModel = "gpt-5";
    let project: string | undefined;
    // Running baseline of the session's cumulative token_usage snapshot.
    let baseInput = 0;
    let baseOutput = 0;
    let baseCached = 0;
    let baseTotal = 0;

    const rl = readline.createInterface({
      input: createReadStream(file, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line) continue;
      let row: Record<string, unknown>;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      const type = row.type as string;
      const payload = row.payload as Record<string, unknown> | undefined;

      if (type === "session_meta" && payload) {
        const cwd = payload.cwd as string | undefined;
        if (cwd) project = cwd;
        const model = payload.model as string | undefined;
        if (model) sessionModel = model;
        continue;
      }

      if (type === "event_msg" && payload && payload.type === "token_count") {
        const ts = (row.timestamp as string) ?? "";
        const info = payload.info as Record<string, unknown> | null | undefined;
        if (info) {
          const totalUsage = info.total_token_usage as
            | Record<string, unknown>
            | undefined;
          const lastUsage = info.last_token_usage as
            | Record<string, unknown>
            | undefined;

          let dInput = 0;
          let dOutput = 0;
          let dCached = 0;

          if (totalUsage) {
            // total_token_usage is cumulative for the session — take the delta
            // against the running baseline. Codex occasionally RESETS the
            // counter mid-session (e.g. context compaction / a fresh segment);
            // when the cumulative total drops, the plain delta would be 0 and
            // we'd silently lose those tokens. Detect the drop and treat the
            // new snapshot itself as the increment, then re-baseline.
            const curInput = toInt(totalUsage.input_tokens);
            const curOutput = toInt(totalUsage.output_tokens);
            const curCached = toInt(
              totalUsage.cached_input_tokens ?? totalUsage.cache_read_input_tokens
            );
            const curTotal = toInt(totalUsage.total_tokens) || curInput + curOutput;

            dInput = Math.max(0, curInput - baseInput);
            dOutput = Math.max(0, curOutput - baseOutput);
            dCached = Math.max(0, curCached - baseCached);

            const isReset = baseTotal > 0 && curTotal > 0 && curTotal < baseTotal;
            if (dInput + dOutput === 0 && isReset) {
              dInput = curInput;
              dOutput = curOutput;
              dCached = curCached;
            }
            // Advance the baseline on every cumulative snapshot, even when this
            // event falls outside the requested window (keeps deltas correct).
            baseInput = curInput;
            baseOutput = curOutput;
            baseCached = curCached;
            baseTotal = curTotal;
          } else if (lastUsage) {
            // No cumulative figure on this event: last_token_usage is the
            // per-turn usage, so count it directly rather than as a delta.
            dInput = toInt(lastUsage.input_tokens);
            dOutput = toInt(lastUsage.output_tokens);
            dCached = toInt(
              lastUsage.cached_input_tokens ?? lastUsage.cache_read_input_tokens
            );
          }

          if (ts && dInput + dOutput > 0) {
            const tsMs = new Date(ts).getTime();
            if (!Number.isNaN(tsMs) && tsMs >= since) {
              const billableInput = Math.max(0, dInput - dCached);
              events.push({
                source: "codex",
                timestamp: ts,
                model: sessionModel,
                inputTokens: billableInput,
                outputTokens: dOutput,
                cacheCreateTokens: 0,
                cacheReadTokens: dCached,
                project,
                sessionId,
                costUSD: costFor(sessionModel, {
                  input: billableInput,
                  output: dOutput,
                  cacheRead: dCached,
                }),
              });
            }
          }
        }
        const rateLimits = payload.rate_limits as Record<string, unknown> | undefined;
        if (rateLimits && ts) {
          const primary = rateLimits.primary as Record<string, unknown> | undefined;
          const secondary = rateLimits.secondary as Record<string, unknown> | undefined;
          const observed: CodexRateLimit = {
            primaryUsedPercent: primary ? Number(primary.used_percent) : undefined,
            primaryResetsAt: primary?.resets_at
              ? new Date(Number(primary.resets_at) * 1000).toISOString()
              : undefined,
            secondaryUsedPercent: secondary ? Number(secondary.used_percent) : undefined,
            secondaryResetsAt: secondary?.resets_at
              ? new Date(Number(secondary.resets_at) * 1000).toISOString()
              : undefined,
            planType: rateLimits.plan_type as string | undefined,
            observedAt: ts,
          };
          if (!latest || observed.observedAt > latest.observedAt) {
            latest = observed;
          }
        }
      }
    }
  }
  return { events, latestRateLimit: latest };
}
