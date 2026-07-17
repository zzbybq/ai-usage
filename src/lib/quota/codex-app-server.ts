import { spawn } from "node:child_process";
import type { SourceQuota } from "../types";

const REQUEST_TIMEOUT_MS = 12_000;

type WireWindow = {
  usedPercent?: number;
  windowDurationMins?: number;
  resetsAt?: number;
};

type WireRateLimit = {
  limitId?: string;
  limitName?: string | null;
  primary?: WireWindow | null;
  secondary?: WireWindow | null;
  planType?: string | null;
};

export type CodexRateLimitsResponse = {
  rateLimits?: WireRateLimit;
  rateLimitsByLimitId?: Record<string, WireRateLimit>;
  rateLimitResetCredits?: { availableCount?: number } | null;
};

function finiteNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function quotaWindowLabel(minutes?: number): string {
  if (!minutes || minutes <= 0) return "Usage window";
  if (minutes % 10_080 === 0) {
    const weeks = minutes / 10_080;
    return weeks === 1 ? "7-day window" : `${weeks}-week window`;
  }
  if (minutes % 1_440 === 0) return `${minutes / 1_440}-day window`;
  if (minutes % 60 === 0) return `${minutes / 60}-hour window`;
  return `${minutes}-minute window`;
}

export function mapCodexRateLimits(
  response: CodexRateLimitsResponse,
  observedAt = new Date().toISOString()
): SourceQuota {
  const selected = response.rateLimitsByLimitId?.codex ?? response.rateLimits;
  const rawWindows = [selected?.primary, selected?.secondary].filter(
    (window): window is WireWindow => Boolean(window)
  );
  const windows = rawWindows.map((window, index) => {
    const used = finiteNumber(window.usedPercent);
    const duration = finiteNumber(window.windowDurationMins);
    const resetSeconds = finiteNumber(window.resetsAt);
    return {
      id: `${selected?.limitId ?? "codex"}:${duration ?? index}`,
      label: quotaWindowLabel(duration),
      windowMinutes: duration,
      usedPercent: used === undefined ? undefined : clampPercent(used),
      remainingPercent: used === undefined ? undefined : clampPercent(100 - used),
      resetsAt: resetSeconds === undefined
        ? undefined
        : new Date(resetSeconds * 1_000).toISOString(),
    };
  });

  return {
    source: "codex",
    status: windows.length > 0 ? "current" : "unavailable",
    observedAt,
    planType: selected?.planType ?? undefined,
    origin: "live",
    windows,
    resetCredits: finiteNumber(response.rateLimitResetCredits?.availableCount),
    message: windows.length > 0 ? undefined : "Codex did not return a quota window",
  };
}

function executableDirectory(value: string): string {
  const slash = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
  return slash >= 0 ? value.slice(0, slash) : value;
}

function resolveCodexExecutableDirectory(): string | undefined {
  const override = process.env.AI_USAGE_CODEX_BIN;
  if (override) return executableDirectory(override);

  if (process.platform !== "win32") return undefined;

  const target = process.arch === "arm64"
    ? "aarch64-pc-windows-msvc"
    : "x86_64-pc-windows-msvc";
  const packageName = process.arch === "arm64"
    ? "codex-win32-arm64"
    : "codex-win32-x64";
  const appData = process.env.APPDATA;
  if (!appData) throw new Error("APPDATA is unavailable; set AI_USAGE_CODEX_BIN");
  return `${appData}\\npm\\node_modules\\@openai\\codex\\node_modules\\@openai\\${packageName}\\vendor\\${target}\\bin`;
}

/**
 * Ask the installed Codex app-server for a live quota snapshot. The native
 * process is short-lived and is terminated after the response, so the widget
 * route does not retain credentials or private response bodies.
 */
export function readCodexRateLimitsLive(): Promise<SourceQuota> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      const executableDirectory = resolveCodexExecutableDirectory();
      const env = executableDirectory
        ? { ...process.env, PATH: `${executableDirectory}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}` }
        : process.env;
      child = spawn(process.platform === "win32" ? "codex.exe" : "codex", ["app-server", "--stdio"], {
        stdio: ["pipe", "pipe", "ignore"],
        windowsHide: true,
        env,
      });
    } catch (error) {
      reject(error);
      return;
    }

    let settled = false;
    let buffer = "";
    const finish = (error?: Error, quota?: SourceQuota) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout.removeAllListeners();
      child.removeAllListeners();
      child.kill();
      if (error) reject(error);
      else resolve(quota!);
    };
    const timer = setTimeout(
      () => finish(new Error("Codex quota request timed out")),
      REQUEST_TIMEOUT_MS
    );

    child.on("error", (error) => finish(error));
    child.on("exit", (code) => {
      if (!settled) finish(new Error(`Codex app-server exited (${code ?? "signal"})`));
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!line) continue;

        let message: {
          id?: number;
          result?: CodexRateLimitsResponse;
          error?: { message?: string };
        };
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id === 1 && message.result) {
          child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`);
          child.stdin.write(`${JSON.stringify({
            id: 2,
            method: "account/rateLimits/read",
            params: null,
          })}\n`);
        } else if (message.id === 1 && message.error) {
          finish(new Error(message.error.message ?? "Codex app-server initialization failed"));
        } else if (message.id === 2 && message.result) {
          finish(undefined, mapCodexRateLimits(message.result));
        } else if (message.id === 2 && message.error) {
          finish(new Error(message.error.message ?? "Codex quota request failed"));
        }
      }
    });

    child.stdin.write(`${JSON.stringify({
      id: 1,
      method: "initialize",
      params: {
        clientInfo: { name: "ai-usage", title: "AI Usage", version: "0.1.0" },
      },
    })}\n`);
  });
}
