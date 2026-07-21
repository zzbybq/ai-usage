import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { createReadStream } from "node:fs";
import { costFor } from "../pricing";
import type { UsageEvent } from "../types";

const CLAUDE_DIR = path.join(os.homedir(), ".claude", "projects");

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

function decodeProject(slug: string): string {
  return slug.replace(/^-+/, "").replace(/-+/g, "/").replace(/^([a-zA-Z])\//, "$1:/");
}

type ClaudeUsageCandidate = {
  source: "claude-code";
  timestamp: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreateTokens: number;
  cacheReadTokens: number;
  project: string;
  sessionId: string;
  messageId: string;
};

function usageTotal(e: ClaudeUsageCandidate): number {
  return e.inputTokens + e.outputTokens + e.cacheCreateTokens + e.cacheReadTokens;
}

function usageScore(e: ClaudeUsageCandidate): [number, number, number] {
  const values = [e.inputTokens, e.outputTokens, e.cacheCreateTokens, e.cacheReadTokens];
  return [
    usageTotal(e),
    values.filter((v) => v > 0).length,
    values.filter((v) => Number.isFinite(v)).length,
  ];
}

function isBetterUsage(candidate: ClaudeUsageCandidate, existing: ClaudeUsageCandidate): boolean {
  const a = usageScore(candidate);
  const b = usageScore(existing);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return new Date(candidate.timestamp).getTime() > new Date(existing.timestamp).getTime();
}

export async function readClaudeUsage(sinceDate: string): Promise<UsageEvent[]> {
  const files = await walkJsonl(CLAUDE_DIR);
  const since = new Date(sinceDate + "T00:00:00.000Z").getTime();
  const eventsByMessage = new Map<string, ClaudeUsageCandidate>();
  const passthroughEvents: ClaudeUsageCandidate[] = [];

  for (const file of files) {
    const stat = await fs.stat(file).catch(() => null);
    if (!stat) continue;
    if (stat.mtimeMs < since) continue;

    const rel = path.relative(CLAUDE_DIR, file);
    const projectSlug = rel.split(path.sep)[0] ?? "unknown";
    const project = decodeProject(projectSlug);
    const sessionId = path.basename(file, ".jsonl");

    const rl = readline.createInterface({
      input: createReadStream(file, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line || line.length < 30) continue;
      if (!line.includes('"usage"')) continue;
      let row: Record<string, unknown>;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      if (row.type !== "assistant") continue;
      const msg = row.message as Record<string, unknown> | undefined;
      const usage = msg?.usage as Record<string, unknown> | undefined;
      if (!usage) continue;
      const messageId = (msg?.id as string) ?? "";

      const ts = (row.timestamp as string) ?? "";
      if (!ts) continue;
      const tsMs = new Date(ts).getTime();
      if (Number.isNaN(tsMs) || tsMs < since) continue;

      const model = typeof msg?.model === "string" && msg.model.trim()
        ? msg.model.trim()
        : "claude-unknown";
      if (model === "<synthetic>") continue;

      const input = Number(usage.input_tokens ?? 0);
      const output = Number(usage.output_tokens ?? 0);
      const cacheCreate = Number(usage.cache_creation_input_tokens ?? 0);
      const cacheRead = Number(usage.cache_read_input_tokens ?? 0);
      if (input + output + cacheCreate + cacheRead === 0) continue;

      const candidate: ClaudeUsageCandidate = {
        source: "claude-code",
        timestamp: ts,
        model,
        inputTokens: input,
        outputTokens: output,
        cacheCreateTokens: cacheCreate,
        cacheReadTokens: cacheRead,
        project,
        sessionId,
        messageId,
      };

      if (!messageId) {
        passthroughEvents.push(candidate);
        continue;
      }

      // Proxies can emit several non-zero cumulative usage rows for one
      // assistant message. Keep the richest/final payload, matching the plugin
      // extractor's best-token-payload behavior.
      const dedupKey = `${sessionId}:${messageId}`;
      const existing = eventsByMessage.get(dedupKey);
      if (!existing || isBetterUsage(candidate, existing)) {
        eventsByMessage.set(dedupKey, candidate);
      }
    }
  }

  return [...eventsByMessage.values(), ...passthroughEvents].map((e) => ({
    ...e,
    costUSD: costFor(e.model, {
      input: e.inputTokens,
      output: e.outputTokens,
      cacheCreate: e.cacheCreateTokens,
      cacheRead: e.cacheReadTokens,
    }),
  }));
}
