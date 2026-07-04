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

export async function readClaudeUsage(sinceDate: string): Promise<UsageEvent[]> {
  const files = await walkJsonl(CLAUDE_DIR);
  const since = new Date(sinceDate + "T00:00:00.000Z").getTime();
  const events: UsageEvent[] = [];
  const seen = new Set<string>();

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
      const requestId = (row.requestId as string) ?? "";

      const ts = (row.timestamp as string) ?? "";
      if (!ts) continue;
      const tsMs = new Date(ts).getTime();
      if (Number.isNaN(tsMs) || tsMs < since) continue;

      const model = (msg?.model as string) ?? "unknown";
      if (model === "<synthetic>") continue;

      const input = Number(usage.input_tokens ?? 0);
      const output = Number(usage.output_tokens ?? 0);
      const cacheCreate = Number(usage.cache_creation_input_tokens ?? 0);
      const cacheRead = Number(usage.cache_read_input_tokens ?? 0);
      if (input + output + cacheCreate + cacheRead === 0) continue;

      // Dedup by sessionId + messageId + requestId, but ONLY among rows that
      // carry real token usage. Some local proxies split one streamed response
      // into multiple assistant rows (thinking / text / tool_use) that share a
      // single messageId: the thinking/text rows have usage=0 and the tool_use
      // rows repeat the same non-zero usage. Deduping before the zero-token
      // filter would let a usage=0 row claim the key and drop the real one
      // (under-counting); not deduping at all would sum the repeated usage
      // (over-counting). Keying on sessionId + messageId + requestId after the
      // zero-token filter keeps exactly one real-usage row per response.
      const dedupKey = `${sessionId}:${messageId}:${requestId}`;
      if (messageId && seen.has(dedupKey)) continue;
      if (messageId) seen.add(dedupKey);

      events.push({
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
        costUSD: costFor(model, { input, output, cacheCreate, cacheRead }),
      });
    }
  }
  return events;
}
