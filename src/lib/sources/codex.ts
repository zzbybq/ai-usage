import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { createReadStream } from "node:fs";
import { costFor } from "../pricing";
import type { UsageEvent } from "../types";

const CODEX_DIR = path.join(os.homedir(), ".codex", "sessions");
const SESSION_ID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const UNKNOWN_MODEL = "codex-unknown";

/** Parse a token field to a non-negative integer (0 for missing/garbage). */
function toInt(v: unknown): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

type TokenCounters = {
  input: number;
  output: number;
  cached: number;
  total: number;
};

type TokenCountRow = {
  timestamp: string;
  model: string;
  cumulative?: TokenCounters;
  last?: TokenCounters;
  rateLimits?: Record<string, unknown>;
};

type ParsedSession = {
  file: string;
  sessionId: string;
  project?: string;
  threadSource?: string;
  parentThreadId?: string;
  forkedFromId?: string;
  rows: TokenCountRow[];
  cumulativeSnapshots: TokenCounters[];
  included: boolean;
};

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
  return out.sort();
}

function sessionIdFromFile(file: string): string {
  return path.basename(file).match(SESSION_ID_RE)?.[1] ?? path.basename(file, ".jsonl");
}

function textValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text || undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/**
 * Read model metadata from the small set of Codex context shapes seen across
 * CLI/Desktop releases. Unknown layouts deliberately stay unknown instead of
 * being guessed as a concrete model.
 */
function modelFromContext(
  row: Record<string, unknown>,
  payload?: Record<string, unknown>
): string | undefined {
  const collaboration = recordValue(payload?.collaboration_mode);
  const candidates = [
    payload,
    row,
    recordValue(payload?.context),
    recordValue(payload?.settings),
    recordValue(payload?.config),
    recordValue(collaboration?.settings),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    for (const key of ["model", "model_id", "modelId"]) {
      const model = textValue(candidate[key]);
      if (model) return model;
    }
  }
  return undefined;
}

function tokenCounters(value: Record<string, unknown>): TokenCounters {
  const input = toInt(value.input_tokens);
  const output = toInt(value.output_tokens);
  const cached = toInt(value.cached_input_tokens ?? value.cache_read_input_tokens);
  return {
    input,
    output,
    cached,
    total: toInt(value.total_tokens) || input + output,
  };
}

async function parseSession(file: string, included: boolean): Promise<ParsedSession> {
  const fileSessionId = sessionIdFromFile(file);
  let sessionId = fileSessionId;
  let currentModel = UNKNOWN_MODEL;
  let project: string | undefined;
  let threadSource: string | undefined;
  let parentThreadId: string | undefined;
  let forkedFromId: string | undefined;
  let ownerMetadataRead = false;
  const rows: TokenCountRow[] = [];
  const cumulativeSnapshots: TokenCounters[] = [];

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

    // A forked rollout can replay its parent's session_meta later in the file.
    // Only the first metadata row owns the file; replayed metadata must never
    // overwrite the child's identity or parent relationship.
    if (type === "session_meta" && payload && !ownerMetadataRead) {
      ownerMetadataRead = true;
      sessionId = textValue(payload.id) ?? textValue(payload.session_id) ?? fileSessionId;
      project = textValue(payload.cwd);
      currentModel = modelFromContext(row, payload) ?? currentModel;
      threadSource = textValue(payload.thread_source)?.toLowerCase();
      parentThreadId = textValue(payload.parent_thread_id);
      forkedFromId = textValue(payload.forked_from_id ?? payload.forked_from);
      continue;
    }

    // Replayed parent session_meta rows must not alter the child's context.
    if (type === "session_meta") continue;

    // turn_context is the current Codex source of truth. Checking the same
    // bounded context keys on other row types also tolerates a future rename of
    // the envelope without recursively guessing from unrelated payload data.
    currentModel = modelFromContext(row, payload) ?? currentModel;

    if (type !== "event_msg" || !payload || payload.type !== "token_count") continue;

    const info = payload.info as Record<string, unknown> | null | undefined;
    const totalUsage = info?.total_token_usage as Record<string, unknown> | undefined;
    const lastUsage = info?.last_token_usage as Record<string, unknown> | undefined;
    const tokenRow: TokenCountRow = {
      timestamp: textValue(row.timestamp) ?? "",
      model: currentModel,
      rateLimits: payload.rate_limits as Record<string, unknown> | undefined,
    };
    if (totalUsage) {
      tokenRow.cumulative = tokenCounters(totalUsage);
      cumulativeSnapshots.push(tokenRow.cumulative);
    } else if (lastUsage) {
      tokenRow.last = tokenCounters(lastUsage);
    }
    rows.push(tokenRow);
  }

  return {
    file,
    sessionId,
    project,
    threadSource,
    parentThreadId,
    forkedFromId,
    rows,
    cumulativeSnapshots,
    included,
  };
}

function sameSnapshot(left: TokenCounters, right: TokenCounters): boolean {
  return (
    left.input === right.input &&
    left.output === right.output &&
    left.cached === right.cached &&
    left.total === right.total
  );
}

/**
 * Find the longest child prefix that appears contiguously anywhere in the
 * explicitly linked parent's cumulative snapshot sequence.
 */
export function findReplayPrefixLength(
  child: TokenCounters[],
  parent: TokenCounters[]
): number {
  let longest = 0;
  for (let parentStart = 0; parentStart < parent.length; parentStart += 1) {
    let matched = 0;
    while (
      matched < child.length &&
      parentStart + matched < parent.length &&
      sameSnapshot(child[matched], parent[parentStart + matched])
    ) {
      matched += 1;
    }
    longest = Math.max(longest, matched);
  }
  return longest;
}

function resolveParentId(session: ParsedSession): string | undefined {
  if (session.threadSource !== "subagent") return undefined;
  if (
    session.parentThreadId &&
    session.forkedFromId &&
    session.parentThreadId !== session.forkedFromId
  ) {
    return undefined;
  }
  return session.parentThreadId ?? session.forkedFromId;
}

function cumulativeDelta(current: TokenCounters, previous: TokenCounters): TokenCounters {
  let input = Math.max(0, current.input - previous.input);
  let output = Math.max(0, current.output - previous.output);
  let cached = Math.max(0, current.cached - previous.cached);

  // Preserve the existing compaction/reset behavior: when the cumulative
  // counter drops and a plain delta would lose the segment, count the new
  // snapshot itself and re-baseline.
  const isReset = previous.total > 0 && current.total > 0 && current.total < previous.total;
  if (input + output === 0 && isReset) {
    input = current.input;
    output = current.output;
    cached = current.cached;
  }

  return { input, output, cached, total: input + output };
}

export type CodexRateLimit = {
  limitId: string;
  limitName?: string;
  planType?: string;
  observedAt: string;
  windows: Array<{
    usedPercent?: number;
    windowMinutes?: number;
    resetsAt?: string;
  }>;
};

function observedRateLimit(
  rateLimits: Record<string, unknown>,
  timestamp: string
): CodexRateLimit {
  const primary = rateLimits.primary as Record<string, unknown> | undefined;
  const secondary = rateLimits.secondary as Record<string, unknown> | undefined;
  const windows = [primary, secondary]
    .filter((window): window is Record<string, unknown> => Boolean(window))
    .map((window) => ({
      usedPercent: Number.isFinite(Number(window.used_percent))
        ? Number(window.used_percent)
        : undefined,
      windowMinutes: Number.isFinite(Number(window.window_minutes))
        ? Number(window.window_minutes)
        : undefined,
      resetsAt: window.resets_at
        ? new Date(Number(window.resets_at) * 1000).toISOString()
        : undefined,
    }));
  return {
    limitId: textValue(rateLimits.limit_id) ?? "codex",
    limitName: textValue(rateLimits.limit_name),
    planType: rateLimits.plan_type as string | undefined,
    observedAt: timestamp,
    windows,
  };
}

export async function readCodexUsageFromDirectory(
  root: string,
  sinceDate: string
): Promise<{ events: UsageEvent[]; latestRateLimits: CodexRateLimit[] }> {
  const files = await walkJsonl(root);
  const since = new Date(sinceDate + "T00:00:00.000Z").getTime();
  const fileIndex = new Map(files.map((file) => [sessionIdFromFile(file), file]));
  const parsedByFile = new Map<string, ParsedSession>();

  // First parse the same mtime-selected rollout set as before.
  for (const file of files) {
    const stat = await fs.stat(file).catch(() => null);
    if (!stat || stat.mtimeMs < since) continue;
    parsedByFile.set(file, await parseSession(file, true));
  }

  // Then load explicitly referenced parents as comparison-only sessions even
  // when their mtime falls outside the requested window. Missing parents are a
  // safe fallback: the child retains the current per-file delta behavior.
  for (const session of [...parsedByFile.values()]) {
    const parentId = resolveParentId(session);
    const parentFile = parentId ? fileIndex.get(parentId) : undefined;
    if (!parentFile || parsedByFile.has(parentFile)) continue;
    parsedByFile.set(parentFile, await parseSession(parentFile, false));
  }

  const sessions = [...parsedByFile.values()];
  const bySessionId = new Map(sessions.map((session) => [session.sessionId, session]));
  const replayPrefixBySession = new Map<string, number>();
  for (const session of sessions) {
    const parentId = resolveParentId(session);
    const parent = parentId ? bySessionId.get(parentId) : undefined;
    if (!parent) continue;
    const replayLength = findReplayPrefixLength(
      session.cumulativeSnapshots,
      parent.cumulativeSnapshots
    );
    if (replayLength > 0) replayPrefixBySession.set(session.file, replayLength);
  }

  const events: UsageEvent[] = [];
  const latestByLimit = new Map<string, CodexRateLimit>();

  for (const session of sessions) {
    if (!session.included) continue;
    let baseline: TokenCounters = { input: 0, output: 0, cached: 0, total: 0 };
    let cumulativeIndex = 0;
    const replayPrefixLength = replayPrefixBySession.get(session.file) ?? 0;

    for (const row of session.rows) {
      let delta: TokenCounters | undefined;
      let isReplay = false;
      if (row.cumulative) {
        delta = cumulativeDelta(row.cumulative, baseline);
        baseline = row.cumulative;
        isReplay = cumulativeIndex < replayPrefixLength;
        cumulativeIndex += 1;
      } else if (row.last) {
        delta = row.last;
      }

      if (!isReplay && delta && row.timestamp && delta.input + delta.output > 0) {
        const timestampMs = new Date(row.timestamp).getTime();
        if (!Number.isNaN(timestampMs) && timestampMs >= since) {
          const billableInput = Math.max(0, delta.input - delta.cached);
          events.push({
            source: "codex",
            timestamp: row.timestamp,
            model: row.model,
            inputTokens: billableInput,
            outputTokens: delta.output,
            cacheCreateTokens: 0,
            cacheReadTokens: delta.cached,
            project: session.project,
            sessionId: session.sessionId,
            costUSD: costFor(row.model, {
              input: billableInput,
              output: delta.output,
              cacheRead: delta.cached,
            }),
          });
        }
      }

      if (row.rateLimits && row.timestamp) {
        const observed = observedRateLimit(row.rateLimits, row.timestamp);
        const current = latestByLimit.get(observed.limitId);
        if (!current || observed.observedAt > current.observedAt) {
          latestByLimit.set(observed.limitId, observed);
        }
      }
    }
  }

  const latestRateLimits = [...latestByLimit.values()]
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  return { events, latestRateLimits };
}

export async function readCodexUsage(
  sinceDate: string
): Promise<{ events: UsageEvent[]; latestRateLimits: CodexRateLimit[] }> {
  return readCodexUsageFromDirectory(CODEX_DIR, sinceDate);
}
