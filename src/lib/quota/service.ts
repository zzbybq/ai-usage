import { readCodexRateLimitsLive } from "./codex-app-server";
import type { QuotaSnapshot, SourceId, SourceQuota, UsageSnapshot } from "../types";

const LIVE_TTL_MS = 60_000;
const FAILURE_TTL_MS = 15_000;
const SUPPORTED_SOURCE_IDS: SourceId[] = ["codex"];

let cachedCodex: SourceQuota | undefined;
let cachedUntil = 0;
let inFlight: Promise<SourceQuota> | undefined;

function fallbackCodexQuota(
  limits: UsageSnapshot["rateLimits"],
  message: string
): SourceQuota {
  const latest = limits
    .filter((limit) => limit.source === "codex")
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
  if (!latest) {
    return {
      source: "codex",
      status: "unavailable",
      origin: "session",
      windows: [],
      message,
    };
  }
  return {
    source: "codex",
    status: "stale",
    observedAt: latest.observedAt,
    planType: latest.planType,
    origin: "session",
    windows: latest.windows.map((window, index) => {
      const remaining = window.usedPercent === undefined
        ? undefined
        : Math.max(0, Math.min(100, 100 - window.usedPercent));
      return {
        id: `${latest.limitId}:${window.windowMinutes ?? index}`,
        label: windowLabel(window.windowMinutes),
        windowMinutes: window.windowMinutes,
        usedPercent: window.usedPercent,
        remainingPercent: remaining,
        resetsAt: window.resetsAt,
      };
    }),
    message: `${message}; showing the last session observation`,
  };
}

function windowLabel(minutes?: number): string {
  if (!minutes || minutes <= 0) return "Usage window";
  if (minutes % 10_080 === 0) return minutes === 10_080 ? "7-day window" : `${minutes / 10_080}-week window`;
  if (minutes % 1_440 === 0) return `${minutes / 1_440}-day window`;
  if (minutes % 60 === 0) return `${minutes / 60}-hour window`;
  return `${minutes}-minute window`;
}

async function readCodexWithCache(
  fallbackLimits: UsageSnapshot["rateLimits"]
): Promise<SourceQuota> {
  const now = Date.now();
  if (cachedCodex && cachedUntil > now) return cachedCodex;
  if (cachedCodex) {
    // Stale-while-revalidate: quota startup can take several seconds on
    // Windows. Keep the widget response fast while refreshing in background.
    if (!inFlight) void refreshCodex(fallbackLimits);
    return cachedCodex;
  }
  return refreshCodex(fallbackLimits);
}

function refreshCodex(
  fallbackLimits: UsageSnapshot["rateLimits"]
): Promise<SourceQuota> {
  if (inFlight) return inFlight;

  inFlight = readCodexRateLimitsLive()
    .then((quota) => {
      cachedCodex = quota;
      cachedUntil = Date.now() + LIVE_TTL_MS;
      return quota;
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      const fallback = cachedCodex?.windows.length
        ? { ...cachedCodex, status: "stale" as const, origin: "cache" as const, message }
        : fallbackCodexQuota(fallbackLimits, message);
      cachedCodex = fallback;
      cachedUntil = Date.now() + FAILURE_TTL_MS;
      return fallback;
    })
    .finally(() => {
      inFlight = undefined;
    });
  return inFlight;
}

export async function getQuotaSnapshot(
  selectedSourceIds: SourceId[],
  fallbackLimits: UsageSnapshot["rateLimits"]
): Promise<QuotaSnapshot> {
  const sources: SourceQuota[] = [];
  if (selectedSourceIds.includes("codex")) {
    sources.push(await readCodexWithCache(fallbackLimits));
  }
  return {
    generatedAt: new Date().toISOString(),
    selectedSourceCount: selectedSourceIds.length,
    supportedSourceIds: SUPPORTED_SOURCE_IDS.filter((id) => selectedSourceIds.includes(id)),
    sources,
  };
}

export function invalidateQuotaCache(): void {
  cachedCodex = undefined;
  cachedUntil = 0;
}
