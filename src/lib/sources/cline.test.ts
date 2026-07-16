import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readClineUsageFromRoots } from "./cline";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("Cline usage", () => {
  it("reads completed API request rows from task UI history", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ai-usage-cline-"));
    roots.push(root);
    const task = path.join(root, "task-a");
    await mkdir(task, { recursive: true });
    await writeFile(path.join(task, "task_metadata.json"), JSON.stringify({
      modelId: "claude-sonnet-4-6",
      workspace: "D:\\project",
    }));
    await writeFile(path.join(task, "ui_messages.json"), JSON.stringify([{
      ts: new Date("2026-07-16T03:00:00.000Z").getTime(),
      type: "say",
      say: "api_req_started",
      conversationHistoryIndex: 4,
      text: JSON.stringify({ tokensIn: 100, tokensOut: 25, cacheWrites: 10, cacheReads: 400, cost: 0.02 }),
    }]));

    const [event] = await readClineUsageFromRoots([root], "2026-07-15");
    expect(event).toMatchObject({
      source: "cline",
      sessionId: "task-a",
      model: "claude-sonnet-4-6",
      inputTokens: 100,
      outputTokens: 25,
      cacheCreateTokens: 10,
      cacheReadTokens: 400,
      costUSD: 0.02,
    });
  });
});
