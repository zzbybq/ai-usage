import { readClaudeUsage } from "./sources/claude";
import { readCodexUsage } from "./sources/codex";
import type { UsageEvent, UsageSnapshot, SourceId, DailyBucket, ModelBreakdown } from "./types";

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

function addLocalDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function ymd(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return localDayKey(date);
}

function emptySourceMap(): Record<SourceId, { tokens: number; costUSD: number; sessions: number }> {
  return {
    "claude-code": { tokens: 0, costUSD: 0, sessions: 0 },
    codex: { tokens: 0, costUSD: 0, sessions: 0 },
  };
}

function emptyDaily(date: string): DailyBucket {
  return {
    date,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreateTokens: 0,
    cacheReadTokens: 0,
    costUSD: 0,
    bySource: {
      "claude-code": { tokens: 0, costUSD: 0 },
      codex: { tokens: 0, costUSD: 0 },
    },
  };
}

function eventTokens(e: UsageEvent): number {
  return e.inputTokens + e.outputTokens + e.cacheCreateTokens + e.cacheReadTokens;
}

export async function buildSnapshot(daysBack = 30): Promise<UsageSnapshot> {
  const today = new Date();
  const todayStr = localDayKey(today);
  const sinceDate = localDayKey(addLocalDays(today, -daysBack));
  const sourceSinceDate = localDayKey(addLocalDays(today, -daysBack - 1));

  const warnings: string[] = [];
  const [claudeRes, codexRes] = await Promise.allSettled([
    readClaudeUsage(sourceSinceDate),
    readCodexUsage(sourceSinceDate),
  ]);

  const events: UsageEvent[] = [];
  if (claudeRes.status === "fulfilled") events.push(...claudeRes.value);
  else warnings.push(`Claude source failed: ${String(claudeRes.reason)}`);

  let codexRateLimit: UsageSnapshot["rateLimit"] = null;
  if (codexRes.status === "fulfilled") {
    events.push(...codexRes.value.events);
    if (codexRes.value.latestRateLimit) {
      codexRateLimit = {
        source: "codex",
        primaryUsedPercent: codexRes.value.latestRateLimit.primaryUsedPercent,
        primaryResetsAt: codexRes.value.latestRateLimit.primaryResetsAt,
        secondaryUsedPercent: codexRes.value.latestRateLimit.secondaryUsedPercent,
        secondaryResetsAt: codexRes.value.latestRateLimit.secondaryResetsAt,
        planType: codexRes.value.latestRateLimit.planType,
      };
    }
  } else warnings.push(`Codex source failed: ${String(codexRes.reason)}`);

  const dailyMap = new Map<string, DailyBucket>();
  for (let i = 0; i <= daysBack; i++) {
    const d = localDayKey(addLocalDays(today, -i));
    dailyMap.set(d, emptyDaily(d));
  }

  const modelMap = new Map<string, ModelBreakdown>();
  const todayModelMap = new Map<string, ModelBreakdown>();
  const todayModelSessions = new Map<string, Set<string>>();
  const todayBySource = emptySourceMap();
  const todaySessions = new Set<string>();
  const allSessions = new Set<string>();
  const sessionsPerSource: Record<SourceId, Set<string>> = {
    "claude-code": new Set(),
    codex: new Set(),
  };
  const todaySessionsPerSource: Record<SourceId, Set<string>> = {
    "claude-code": new Set(),
    codex: new Set(),
  };
  const modelSessions = new Map<string, Set<string>>();

  let todayInput = 0, todayOutput = 0, todayCacheCreate = 0, todayCacheRead = 0, todayCost = 0;
  let totalTokens = 0, totalCost = 0;

  for (const e of events) {
    const day = ymd(e.timestamp);
    const tokens = eventTokens(e);
    totalTokens += tokens;
    totalCost += e.costUSD;
    allSessions.add(`${e.source}:${e.sessionId}`);
    sessionsPerSource[e.source].add(e.sessionId);

    const bucket = dailyMap.get(day);
    if (bucket) {
      bucket.totalTokens += tokens;
      bucket.inputTokens += e.inputTokens;
      bucket.outputTokens += e.outputTokens;
      bucket.cacheCreateTokens += e.cacheCreateTokens;
      bucket.cacheReadTokens += e.cacheReadTokens;
      bucket.costUSD += e.costUSD;
      bucket.bySource[e.source].tokens += tokens;
      bucket.bySource[e.source].costUSD += e.costUSD;
    }

    const modelKey = `${e.source}::${e.model}`;
    let m = modelMap.get(modelKey);
    if (!m) {
      m = { model: e.model, source: e.source, tokens: 0, costUSD: 0, sessions: 0 };
      modelMap.set(modelKey, m);
      modelSessions.set(modelKey, new Set());
    }
    m.tokens += tokens;
    m.costUSD += e.costUSD;
    modelSessions.get(modelKey)!.add(e.sessionId);

    if (day === todayStr) {
      todayInput += e.inputTokens;
      todayOutput += e.outputTokens;
      todayCacheCreate += e.cacheCreateTokens;
      todayCacheRead += e.cacheReadTokens;
      todayCost += e.costUSD;
      todayBySource[e.source].tokens += tokens;
      todayBySource[e.source].costUSD += e.costUSD;
      todaySessions.add(`${e.source}:${e.sessionId}`);
      todaySessionsPerSource[e.source].add(e.sessionId);

      let tm = todayModelMap.get(modelKey);
      if (!tm) {
        tm = { model: e.model, source: e.source, tokens: 0, costUSD: 0, sessions: 0 };
        todayModelMap.set(modelKey, tm);
        todayModelSessions.set(modelKey, new Set());
      }
      tm.tokens += tokens;
      tm.costUSD += e.costUSD;
      todayModelSessions.get(modelKey)!.add(e.sessionId);
    }
  }

  for (const [key, set] of modelSessions) {
    const m = modelMap.get(key);
    if (m) m.sessions = set.size;
  }
  for (const [key, set] of todayModelSessions) {
    const m = todayModelMap.get(key);
    if (m) m.sessions = set.size;
  }

  const daily = [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date));
  const models = [...modelMap.values()].sort((a, b) => b.tokens - a.tokens);
  const todayModels = [...todayModelMap.values()].sort((a, b) => b.tokens - a.tokens);

  return {
    generatedAt: new Date().toISOString(),
    today: {
      date: todayStr,
      totalTokens: todayInput + todayOutput + todayCacheCreate + todayCacheRead,
      inputTokens: todayInput,
      outputTokens: todayOutput,
      cacheCreateTokens: todayCacheCreate,
      cacheReadTokens: todayCacheRead,
      costUSD: todayCost,
      sessions: todaySessions.size,
      bySource: {
        "claude-code": {
          tokens: todayBySource["claude-code"].tokens,
          costUSD: todayBySource["claude-code"].costUSD,
          sessions: todaySessionsPerSource["claude-code"].size,
        },
        codex: {
          tokens: todayBySource.codex.tokens,
          costUSD: todayBySource.codex.costUSD,
          sessions: todaySessionsPerSource.codex.size,
        },
      },
    },
    totals: {
      tokens: totalTokens,
      costUSD: totalCost,
      sessions: allSessions.size,
      sinceDate,
    },
    daily,
    models,
    todayModels,
    rateLimit: codexRateLimit,
    warnings,
  };
}
