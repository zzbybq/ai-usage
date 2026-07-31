import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readGrokUsageFromRoots } from "./grok";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("Grok usage", () => {
  it("reads turn_completed usage from session updates files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ai-usage-grok-"));
    roots.push(root);
    const sessionId = "019fb1c1-2625-7053-b5fe-bf054ac71db2";
    await mkdir(path.join(root, "D%3A%5Cprojects%5Cdemo", sessionId), { recursive: true });
    await writeFile(
      path.join(root, "D%3A%5Cprojects%5Cdemo", sessionId, "updates.jsonl"),
      JSON.stringify({
        timestamp: 1785393681,
        method: "_x.ai/session/update",
        params: {
          sessionId,
          update: {
            sessionUpdate: "turn_completed",
            usage: {
              inputTokens: 20318,
              outputTokens: 97,
              cachedReadTokens: 2560,
              costUsdTicks: 368660000,
              modelUsage: {
                "grok-4.5-build": {
                  inputTokens: 20318,
                  outputTokens: 97,
                  cachedReadTokens: 2560,
                  costUsdTicks: 368660000,
                },
              },
            },
          },
        },
      }) + "\n"
    );

    const [event] = await readGrokUsageFromRoots([root], "2026-07-30");
    expect(event).toMatchObject({
      source: "grok",
      sessionId,
      project: "D:\\projects\\demo",
      model: "grok-4.5-build",
      inputTokens: 17758,
      outputTokens: 97,
      cacheCreateTokens: 0,
      cacheReadTokens: 2560,
    });
    expect(event.costUSD).toBeCloseTo(0.036866, 10);
  });

  it("counts tokens but charges zero for the free model tier", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ai-usage-grok-"));
    roots.push(root);
    const sessionId = "019f8e31-9ff5-7c10-b53d-520176ece89d";
    await mkdir(path.join(root, "D%3A%5Cai_work", sessionId), { recursive: true });
    await writeFile(
      path.join(root, "D%3A%5Cai_work", sessionId, "updates.jsonl"),
      JSON.stringify({
        timestamp: 1785400000,
        params: {
          sessionId,
          update: {
            sessionUpdate: "turn_completed",
            usage: {
              inputTokens: 348635,
              outputTokens: 7162,
              cachedReadTokens: 0,
              costUsdTicks: 0,
              modelUsage: {
                "grok-4.5-build-free": {
                  inputTokens: 348635,
                  outputTokens: 7162,
                  cachedReadTokens: 0,
                  costUsdTicks: 0,
                },
              },
            },
          },
        },
      }) + "\n"
    );

    const [event] = await readGrokUsageFromRoots([root], "2026-07-30");
    expect(event).toMatchObject({
      source: "grok",
      project: "D:\\ai_work",
      model: "grok-4.5-build-free",
      inputTokens: 348635,
      outputTokens: 7162,
    });
    expect(event.costUSD).toBe(0);
  });
});
