import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readGeminiUsageFromRoot } from "./gemini";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("Gemini CLI usage", () => {
  it("reads per-message token stats and separates cached input", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ai-usage-gemini-"));
    roots.push(root);
    const chats = path.join(root, "project-hash", "chats");
    await mkdir(chats, { recursive: true });
    await writeFile(path.join(chats, "session-a.json"), JSON.stringify({
      sessionId: "session-a",
      messages: [{
        id: "message-a",
        type: "gemini",
        timestamp: "2026-07-16T01:00:00.000Z",
        model: "gemini-2.5-pro",
        tokens: { input: 1000, output: 80, cached: 700, thoughts: 20 },
      }],
    }));

    const [event] = await readGeminiUsageFromRoot(root, "2026-07-15");
    expect(event).toMatchObject({
      source: "gemini-cli",
      sessionId: "session-a",
      inputTokens: 300,
      outputTokens: 100,
      cacheReadTokens: 700,
    });
  });
});
