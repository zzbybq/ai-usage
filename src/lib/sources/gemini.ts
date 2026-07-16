import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { costFor } from "../pricing";
import type { UsageEvent } from "../types";
import { positiveNumber, record, timestampToIso, walkFiles } from "./shared";

function geminiHome(): string {
  return process.env.GEMINI_CLI_HOME || path.join(os.homedir(), ".gemini");
}

/** Parse Gemini CLI's project-scoped session history. */
export async function readGeminiUsageFromRoot(root: string, sinceDate: string): Promise<UsageEvent[]> {
  const since = new Date(`${sinceDate}T00:00:00.000Z`).getTime();
  const files = await walkFiles(root, (file) => path.extname(file).toLowerCase() === ".json");
  const events: UsageEvent[] = [];

  for (const file of files) {
    const stat = await fs.stat(file).catch(() => null);
    if (!stat || stat.mtimeMs < since) continue;
    let document: Record<string, unknown>;
    try {
      document = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
    } catch {
      continue;
    }
    const messages = Array.isArray(document.messages) ? document.messages : [];
    const sessionId = String(document.sessionId ?? path.basename(file, ".json"));
    const project = path.basename(path.dirname(path.dirname(file)));
    const sessionTimestamp = document.startTime ?? document.createdAt ?? stat.mtimeMs;

    messages.forEach((value, index) => {
      const message = record(value);
      const tokens = record(message?.tokens ?? message?.usageMetadata);
      if (!message || !tokens || (message.type !== "gemini" && message.role !== "assistant")) return;
      const inputInclusive = positiveNumber(tokens.input ?? tokens.promptTokenCount);
      const cached = positiveNumber(tokens.cached ?? tokens.cachedContentTokenCount);
      const output = positiveNumber(tokens.output ?? tokens.candidatesTokenCount);
      const thoughts = positiveNumber(tokens.thoughts ?? tokens.thoughtsTokenCount);
      const cacheWrite = positiveNumber(tokens.cacheWrite ?? tokens.cacheCreationInputTokens);
      const input = Math.max(0, inputInclusive - cached);
      if (input + output + thoughts + cached + cacheWrite === 0) return;
      const timestamp = timestampToIso(
        message.timestamp ?? message.time ?? message.createdAt ?? sessionTimestamp,
        stat.mtimeMs
      );
      if (!timestamp || new Date(timestamp).getTime() < since) return;
      const model = String(message.model ?? document.model ?? "gemini-unknown");
      events.push({
        source: "gemini-cli",
        timestamp,
        model,
        inputTokens: input,
        outputTokens: output + thoughts,
        cacheCreateTokens: cacheWrite,
        cacheReadTokens: cached,
        project,
        sessionId,
        messageId: String(message.id ?? `${sessionId}:${index}`),
        costUSD: costFor(model, {
          input,
          output: output + thoughts,
          cacheCreate: cacheWrite,
          cacheRead: cached,
        }),
      });
    });
  }
  return events;
}

export function readGeminiUsage(sinceDate: string): Promise<UsageEvent[]> {
  return readGeminiUsageFromRoot(path.join(geminiHome(), "tmp"), sinceDate);
}
