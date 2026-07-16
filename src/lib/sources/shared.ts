import { promises as fs } from "node:fs";
import path from "node:path";

export async function walkFiles(
  root: string,
  accept: (file: string) => boolean
): Promise<string[]> {
  const files: string[] = [];
  async function walk(directory: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(entries.map(async (entry) => {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(candidate);
      else if (entry.isFile() && accept(candidate)) files.push(candidate);
    }));
  }
  await walk(root);
  return files;
}

export function positiveNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function timestampToIso(value: unknown, fallback?: number): string | null {
  let timestamp: number;
  if (typeof value === "number" || (typeof value === "string" && /^\d+(\.\d+)?$/.test(value))) {
    timestamp = Number(value);
    if (timestamp > 0 && timestamp < 10_000_000_000) timestamp *= 1000;
  } else {
    timestamp = new Date(String(value ?? "")).getTime();
  }
  if (!Number.isFinite(timestamp) || timestamp <= 0) timestamp = fallback ?? Number.NaN;
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
