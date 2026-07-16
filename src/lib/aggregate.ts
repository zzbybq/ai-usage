import { SOURCE_REGISTRY } from "./source-registry";
import { readSelectedSourceIds } from "./source-settings";
import { SOURCES, type UsageEvent, type UsageSnapshot, type SourceId, type DailyBucket, type ModelBreakdown } from "./types";

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

export function localDayKeyFromIso(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return localDayKey(date);
}

function emptySourceMap(): Record<SourceId, { tokens: number; costUSD: number; sessions: number }> {
  return Object.fromEntries(
    SOURCES.map((source) => [source.id, { tokens: 0, costUSD: 0, sessions: 0 }])
  ) as Record<SourceId, { tokens: number; costUSD: number; sessions: number }>;
}

function emptySessionMap(): Record<SourceId, Set<string>> {
  return Object.fromEntries(
    SOURCES.map((source) => [source.id, new Set<string>()])
  ) as Record<SourceId, Set<string>>;
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
    bySource: Object.fromEntries(
      SOURCES.map((source) => [source.id, { tokens: 0, costUSD: 0 }])
    ) as DailyBucket["bySource"],
  };
}

function eventTokens(e: UsageEvent): number {
  return e.inputTokens + e.outputTokens + e.cacheCreateTokens + e.cacheReadTokens;
}

export async function buildSnapshot(
  daysBack = 30,
  sourceIds?: SourceId[]
): Promise<UsageSnapshot> {
  const today = new Date();
  const todayStr = localDayKey(today);
  const sinceDate = localDayKey(addLocalDays(today, -daysBack));
  const sourceSinceDate = localDayKey(addLocalDays(today, -daysBack - 1));

  const selectedSourceIds = sourceIds ?? await readSelectedSourceIds();
  const selectedSet = new Set<SourceId>(selectedSourceIds);
  const selectedSources = SOURCE_REGISTRY.filter((source) => selectedSet.has(source.id));
  const warnings: string[] = [];
  const results = await Promise.allSettled(
    selectedSources.map((source) => source.read(sourceSinceDate))
  );
  const events: UsageEvent[] = [];
  const rateLimits: UsageSnapshot["rateLimits"] = [];
  results.forEach((result, index) => {
    const source = selectedSources[index];
    if (result.status === "fulfilled") {
      events.push(...result.value.events);
      for (const limit of result.value.rateLimits ?? []) {
        rateLimits.push({ source: source.id, ...limit });
      }
    } else {
      warnings.push(`${source.label} source failed: ${String(result.reason)}`);
    }
  });

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
  const sessionsPerSource = emptySessionMap();
  const todaySessionsPerSource = emptySessionMap();
  const modelSessions = new Map<string, Set<string>>();

  let todayInput = 0, todayOutput = 0, todayCacheCreate = 0, todayCacheRead = 0, todayCost = 0;
  let totalTokens = 0, totalCost = 0;

  for (const e of events) {
    const day = localDayKeyFromIso(e.timestamp);
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
    sources: selectedSources.map(({ id, label, shortLabel, accent, accentEnd }) => ({
      id, label, shortLabel, accent, accentEnd,
    })),
    today: {
      date: todayStr,
      totalTokens: todayInput + todayOutput + todayCacheCreate + todayCacheRead,
      inputTokens: todayInput,
      outputTokens: todayOutput,
      cacheCreateTokens: todayCacheCreate,
      cacheReadTokens: todayCacheRead,
      costUSD: todayCost,
      sessions: todaySessions.size,
      bySource: Object.fromEntries(SOURCES.map((source) => [source.id, {
        tokens: todayBySource[source.id].tokens,
        costUSD: todayBySource[source.id].costUSD,
        sessions: todaySessionsPerSource[source.id].size,
      }])) as UsageSnapshot["today"]["bySource"],
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
    rateLimits,
    warnings,
  };
}
