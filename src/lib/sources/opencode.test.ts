import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { readOpenCodeUsageFromRoot } from "./opencode";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("OpenCode usage", () => {
  it("reads the current SQLite message ledger", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ai-usage-opencode-db-"));
    roots.push(root);
    const database = new DatabaseSync(path.join(root, "opencode.db"));
    database.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
    `);
    const timestamp = new Date("2026-07-16T01:30:00.000Z").getTime();
    database.prepare("INSERT INTO session (id, directory) VALUES (?, ?)")
      .run("session-db", "D:\\project");
    database.prepare("INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)")
      .run("message-db", "session-db", timestamp, JSON.stringify({
        role: "assistant",
        modelID: "gpt-5",
        time: { created: timestamp },
        tokens: { input: 50, output: 10, reasoning: 5, cache: { read: 200, write: 0 } },
        cost: 0.004,
      }));
    database.close();

    const [event] = await readOpenCodeUsageFromRoot(root, "2026-07-15");
    expect(event).toMatchObject({
      sessionId: "session-db",
      project: "D:\\project",
      inputTokens: 50,
      outputTokens: 15,
      cacheReadTokens: 200,
      costUSD: 0.004,
    });
  });

  it("reads legacy per-message JSON with the native token schema", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ai-usage-opencode-"));
    roots.push(root);
    const messages = path.join(root, "storage", "message", "session-a");
    await mkdir(messages, { recursive: true });
    await writeFile(path.join(messages, "message-a.json"), JSON.stringify({
      id: "message-a",
      sessionID: "session-a",
      role: "assistant",
      modelID: "claude-sonnet-4-6",
      time: { created: new Date("2026-07-16T02:00:00.000Z").getTime() },
      tokens: { input: 120, output: 30, reasoning: 10, cache: { read: 500, write: 20 } },
      cost: 0.012,
    }));

    const [event] = await readOpenCodeUsageFromRoot(root, "2026-07-15");
    expect(event).toMatchObject({
      source: "opencode",
      model: "claude-sonnet-4-6",
      inputTokens: 120,
      outputTokens: 40,
      cacheReadTokens: 500,
      cacheCreateTokens: 20,
      costUSD: 0.012,
    });
  });
});
