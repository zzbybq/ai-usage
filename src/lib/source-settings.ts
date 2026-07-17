import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SOURCE_REGISTRY } from "./source-registry";
import type { SourceId } from "./types";

const SETTINGS_FILE =
  process.env.AI_USAGE_SETTINGS_FILE ?? path.join(
    /* turbopackIgnore: true */ os.homedir(),
    ".ai-usage",
    "settings.json"
  );

type SettingsFile = {
  version: 2;
  selectedSourceIds: SourceId[];
  dailyGoal: DailyGoalSettings;
};

export type DailyGoalSettings = {
  enabled: boolean;
  targetTokens: number;
};

export const DEFAULT_DAILY_GOAL_TOKENS = 200_000_000;
export const MIN_DAILY_GOAL_TOKENS = 1_000_000;
export const MAX_DAILY_GOAL_TOKENS = 10_000_000_000;

const ALL_SOURCE_IDS = SOURCE_REGISTRY.map((source) => source.id);
const KNOWN_SOURCE_IDS = new Set<string>(ALL_SOURCE_IDS);

export function normalizeSelectedSourceIds(value: unknown): SourceId[] {
  if (!Array.isArray(value)) return [...ALL_SOURCE_IDS];
  const selected = [...new Set(value.filter((id): id is SourceId => (
    typeof id === "string" && KNOWN_SOURCE_IDS.has(id)
  )))];
  return selected.length > 0 ? selected : [...ALL_SOURCE_IDS];
}

export function normalizeDailyGoalSettings(value: unknown): DailyGoalSettings {
  const candidate = value && typeof value === "object"
    ? value as Partial<DailyGoalSettings>
    : {};
  const numericTarget = Number(candidate.targetTokens);
  const targetTokens = Number.isFinite(numericTarget)
    ? Math.round(Math.min(MAX_DAILY_GOAL_TOKENS, Math.max(MIN_DAILY_GOAL_TOKENS, numericTarget)))
    : DEFAULT_DAILY_GOAL_TOKENS;
  return {
    enabled: typeof candidate.enabled === "boolean" ? candidate.enabled : true,
    targetTokens,
  };
}

function normalizeSettings(value: unknown): SettingsFile {
  const candidate = value && typeof value === "object" ? value as Partial<SettingsFile> : {};
  return {
    version: 2,
    selectedSourceIds: normalizeSelectedSourceIds(candidate.selectedSourceIds),
    dailyGoal: normalizeDailyGoalSettings(candidate.dailyGoal),
  };
}

async function readSettings(): Promise<SettingsFile> {
  try {
    return normalizeSettings(JSON.parse(
      await fs.readFile(/* turbopackIgnore: true */ SETTINGS_FILE, "utf8")
    ));
  } catch {
    return normalizeSettings({});
  }
}

let settingsWriteQueue: Promise<void> = Promise.resolve();

function updateSettings<T>(update: (current: SettingsFile) => { settings: SettingsFile; result: T }): Promise<T> {
  const operation = settingsWriteQueue.then(async () => {
    const { settings, result } = update(await readSettings());
    await fs.mkdir(/* turbopackIgnore: true */ path.dirname(SETTINGS_FILE), { recursive: true });
    const temporary = `${SETTINGS_FILE}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(/* turbopackIgnore: true */ temporary, JSON.stringify(settings, null, 2), "utf8");
    await fs.rename(/* turbopackIgnore: true */ temporary, SETTINGS_FILE);
    return result;
  });
  settingsWriteQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function readSelectedSourceIds(): Promise<SourceId[]> {
  return (await readSettings()).selectedSourceIds;
}

export async function writeSelectedSourceIds(value: unknown): Promise<SourceId[]> {
  const selectedSourceIds = normalizeSelectedSourceIds(value);
  return updateSettings((current) => ({
    settings: { ...current, selectedSourceIds },
    result: selectedSourceIds,
  }));
}

export async function readDailyGoalSettings(): Promise<DailyGoalSettings> {
  return (await readSettings()).dailyGoal;
}

export async function writeDailyGoalSettings(value: unknown): Promise<DailyGoalSettings> {
  const dailyGoal = normalizeDailyGoalSettings(value);
  return updateSettings((current) => ({
    settings: { ...current, dailyGoal },
    result: dailyGoal,
  }));
}
