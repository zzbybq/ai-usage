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
  version: 1;
  selectedSourceIds: SourceId[];
};

const ALL_SOURCE_IDS = SOURCE_REGISTRY.map((source) => source.id);
const KNOWN_SOURCE_IDS = new Set<string>(ALL_SOURCE_IDS);

export function normalizeSelectedSourceIds(value: unknown): SourceId[] {
  if (!Array.isArray(value)) return [...ALL_SOURCE_IDS];
  const selected = [...new Set(value.filter((id): id is SourceId => (
    typeof id === "string" && KNOWN_SOURCE_IDS.has(id)
  )))];
  return selected.length > 0 ? selected : [...ALL_SOURCE_IDS];
}

export async function readSelectedSourceIds(): Promise<SourceId[]> {
  try {
    const raw = JSON.parse(await fs.readFile(/* turbopackIgnore: true */ SETTINGS_FILE, "utf8")) as Partial<SettingsFile>;
    return normalizeSelectedSourceIds(raw.selectedSourceIds);
  } catch {
    return [...ALL_SOURCE_IDS];
  }
}

export async function writeSelectedSourceIds(value: unknown): Promise<SourceId[]> {
  const selectedSourceIds = normalizeSelectedSourceIds(value);
  const payload: SettingsFile = { version: 1, selectedSourceIds };
  await fs.mkdir(/* turbopackIgnore: true */ path.dirname(SETTINGS_FILE), { recursive: true });
  const temporary = `${SETTINGS_FILE}.${process.pid}.tmp`;
  await fs.writeFile(/* turbopackIgnore: true */ temporary, JSON.stringify(payload, null, 2), "utf8");
  await fs.rename(/* turbopackIgnore: true */ temporary, SETTINGS_FILE);
  return selectedSourceIds;
}
