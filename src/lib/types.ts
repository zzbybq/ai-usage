export const SOURCES = [
  { id: "claude-code", label: "Claude Code", shortLabel: "Claude", accent: "#d97757", accentEnd: "#f0a378" },
  { id: "codex", label: "Codex CLI", shortLabel: "Codex", accent: "#a78bfa", accentEnd: "#c4b5fd" },
  { id: "workbuddy", label: "WorkBuddy", shortLabel: "WorkBuddy", accent: "#34d399", accentEnd: "#6ee7b7" },
  { id: "hermes", label: "Hermes", shortLabel: "Hermes", accent: "#38bdf8", accentEnd: "#7dd3fc" },
  { id: "gemini-cli", label: "Gemini CLI", shortLabel: "Gemini", accent: "#4285f4", accentEnd: "#8ab4f8" },
  { id: "opencode", label: "OpenCode", shortLabel: "OpenCode", accent: "#f59e0b", accentEnd: "#fcd34d" },
  { id: "cline", label: "Cline", shortLabel: "Cline", accent: "#f43f5e", accentEnd: "#fda4af" },
] as const;

export type SourceId = (typeof SOURCES)[number]["id"];

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
  shortLabel: string;
  accent: string;
  accentEnd: string;
};

export type SourceStatus = SourceMeta & {
  selected: boolean;
  detected: boolean;
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

export type QuotaFreshness = "current" | "stale" | "unavailable";

export type QuotaWindow = {
  id: string;
  label: string;
  windowMinutes?: number;
  usedPercent?: number;
  remainingPercent?: number;
  resetsAt?: string;
};

export type SourceQuota = {
  source: SourceId;
  status: QuotaFreshness;
  observedAt?: string;
  planType?: string;
  origin: "live" | "session" | "cache";
  windows: QuotaWindow[];
  resetCredits?: number;
  message?: string;
};

export type QuotaSnapshot = {
  generatedAt: string;
  selectedSourceCount: number;
  supportedSourceIds: SourceId[];
  sources: SourceQuota[];
};

export type UsageSnapshot = {
  generatedAt: string;
  sources: SourceMeta[];
  dailyGoal: {
    enabled: boolean;
    targetTokens: number;
    currentTokens: number;
    progress: number;
  };
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
  rateLimits: Array<{
    source: SourceId;
    limitId: string;
    limitName?: string;
    planType?: string;
    observedAt: string;
    windows: Array<{
      usedPercent?: number;
      windowMinutes?: number;
      resetsAt?: string;
    }>;
  }>;
  warnings: string[];
};

export type LiveUsageSnapshot = Pick<
  UsageSnapshot,
  "generatedAt" | "sources" | "dailyGoal" | "today" | "todayModels" | "rateLimits" | "warnings"
> & {
  quotas: QuotaSnapshot;
};
