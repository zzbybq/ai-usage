export type SourceId = "claude-code" | "codex" | "hermes";

export type UsageEvent = {
  source: SourceId;
  timestamp: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreateTokens: number;
  cacheReadTokens: number;
  project?: string;
  sessionId: string;
  messageId?: string;
  costUSD: number;
};

export type SourceMeta = {
  id: SourceId;
  label: string;
  accent: string;
};

export type DailyBucket = {
  date: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreateTokens: number;
  cacheReadTokens: number;
  costUSD: number;
  bySource: Record<SourceId, { tokens: number; costUSD: number }>;
};

export type ModelBreakdown = {
  model: string;
  source: SourceId;
  tokens: number;
  costUSD: number;
  sessions: number;
};

export type UsageSnapshot = {
  generatedAt: string;
  today: {
    date: string;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    cacheCreateTokens: number;
    cacheReadTokens: number;
    costUSD: number;
    sessions: number;
    bySource: Record<SourceId, { tokens: number; costUSD: number; sessions: number }>;
  };
  totals: {
    tokens: number;
    costUSD: number;
    sessions: number;
    sinceDate: string;
  };
  daily: DailyBucket[];
  models: ModelBreakdown[];
  todayModels: ModelBreakdown[];
  rateLimit?: {
    source: SourceId;
    primaryUsedPercent?: number;
    primaryResetsAt?: string;
    secondaryUsedPercent?: number;
    secondaryResetsAt?: string;
    planType?: string;
  } | null;
  warnings: string[];
};

export const SOURCES: SourceMeta[] = [
  { id: "claude-code", label: "Claude Code", accent: "#d97757" },
  { id: "codex", label: "Codex CLI", accent: "#a78bfa" },
  { id: "hermes", label: "Hermes", accent: "#38bdf8" },
];
