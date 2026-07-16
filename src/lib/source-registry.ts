import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readClaudeUsage } from "./sources/claude";
import { readCodexUsage, type CodexRateLimit } from "./sources/codex";
import { readHermesUsage } from "./sources/hermes";
import { readWorkbuddyUsage } from "./sources/workbuddy";
import { readGeminiUsage } from "./sources/gemini";
import { readOpenCodeUsage } from "./sources/opencode";
import { readClineUsage } from "./sources/cline";
import { SOURCES, type SourceId, type SourceMeta, type UsageEvent } from "./types";

export type SourceReadResult = {
  events: UsageEvent[];
  rateLimits?: CodexRateLimit[];
};

export type SourceDefinition = SourceMeta & {
  detectPaths: string[];
  read: (sinceDate: string) => Promise<SourceReadResult>;
};

const home = os.homedir();

const READERS: Record<SourceId, SourceDefinition["read"]> = {
  "claude-code": async (sinceDate) => ({ events: await readClaudeUsage(sinceDate) }),
  codex: async (sinceDate) => {
    const result = await readCodexUsage(sinceDate);
    return { events: result.events, rateLimits: result.latestRateLimits };
  },
  workbuddy: async (sinceDate) => ({ events: await readWorkbuddyUsage(sinceDate) }),
  hermes: async (sinceDate) => ({ events: await readHermesUsage(sinceDate) }),
  "gemini-cli": async (sinceDate) => ({ events: await readGeminiUsage(sinceDate) }),
  opencode: async (sinceDate) => ({ events: await readOpenCodeUsage(sinceDate) }),
  cline: async (sinceDate) => ({ events: await readClineUsage(sinceDate) }),
};

const DETECT_PATHS: Record<SourceId, string[]> = {
  "claude-code": [path.join(home, ".claude", "projects")],
  codex: [path.join(home, ".codex", "sessions")],
  workbuddy: [path.join(home, ".workbuddy")],
  hermes: [
    path.join(home, ".hermes", "state.db"),
    path.join(process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"), "hermes", "state.db"),
    path.join(process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"), "Hermes", "state.db"),
  ],
  "gemini-cli": [
    path.join(process.env.GEMINI_CLI_HOME ?? path.join(home, ".gemini"), "tmp"),
  ],
  opencode: [
    process.env.OPENCODE_DB ?? "",
    path.join(process.env.XDG_DATA_HOME ?? path.join(home, ".local", "share"), "opencode"),
  ].filter(Boolean),
  cline: [
    path.join(home, ".cline", "data", "tasks"),
    path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "tasks"),
  ],
};

export const SOURCE_REGISTRY: SourceDefinition[] = SOURCES.map((source) => ({
  ...source,
  detectPaths: DETECT_PATHS[source.id],
  read: READERS[source.id],
}));

export const SOURCE_BY_ID = new Map(SOURCE_REGISTRY.map((source) => [source.id, source]));

export async function isSourceDetected(source: SourceDefinition): Promise<boolean> {
  const checks = await Promise.all(
    source.detectPaths.map((candidate) => fs.access(candidate).then(() => true).catch(() => false))
  );
  return checks.some(Boolean);
}
