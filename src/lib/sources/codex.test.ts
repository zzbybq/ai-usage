import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readCodexUsageFromDirectory } from "./codex";

type Snapshot = {
  input: number;
  output: number;
  cached: number;
};

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-usage-codex-test-"));
  tempRoots.push(root);
  return root;
}

function meta(
  id: string,
  options: { parentId?: string; threadSource?: string; model?: string | null } = {}
): Record<string, unknown> {
  return {
    timestamp: "2026-07-14T00:00:00.000Z",
    type: "session_meta",
    payload: {
      id,
      session_id: id,
      cwd: "D:\\synthetic",
      ...(options.model === null ? {} : { model: options.model ?? "gpt-5" }),
      thread_source: options.threadSource ?? "user",
      parent_thread_id: options.parentId,
      forked_from_id: options.parentId,
    },
  };
}

function turnContext(model: string, second: number, key: "model" | "model_id" | "modelId" = "model") {
  return {
    timestamp: `2026-07-14T00:00:${String(second).padStart(2, "0")}.000Z`,
    type: "turn_context",
    payload: { [key]: model },
  };
}

function token(
  snapshot: Snapshot,
  second: number,
  rateLimits?: Record<string, unknown>
): Record<string, unknown> {
  return {
    timestamp: `2026-07-14T00:00:${String(second).padStart(2, "0")}.000Z`,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: snapshot.input,
          output_tokens: snapshot.output,
          cached_input_tokens: snapshot.cached,
          total_tokens: snapshot.input + snapshot.output,
        },
      },
      rate_limits: rateLimits,
    },
  };
}

async function writeSession(
  root: string,
  id: string,
  snapshots: Snapshot[],
  options: {
    parentId?: string;
    threadSource?: string;
    replayedParentMeta?: boolean;
    rateLimits?: Record<string, unknown>;
    model?: string | null;
  } = {}
): Promise<void> {
  const dir = path.join(root, "2026", "07", "14");
  await mkdir(dir, { recursive: true });
  const rows: Record<string, unknown>[] = [meta(id, options)];
  snapshots.forEach((snapshot, index) => rows.push(token(snapshot, index + 1, options.rateLimits)));
  if (options.replayedParentMeta && options.parentId) {
    rows.push(meta(options.parentId));
  }
  await writeFile(
    path.join(dir, `rollout-2026-07-14T08-00-00-${id}.jsonl`),
    rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
    "utf8"
  );
}

async function writeRows(
  root: string,
  id: string,
  rows: Record<string, unknown>[]
): Promise<void> {
  const dir = path.join(root, "2026", "07", "14");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, `rollout-2026-07-14T08-00-00-${id}.jsonl`),
    rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
    "utf8"
  );
}

function totals(events: Awaited<ReturnType<typeof readCodexUsageFromDirectory>>["events"]) {
  return events.reduce(
    (sum, event) => ({
      input: sum.input + event.inputTokens,
      cached: sum.cached + event.cacheReadTokens,
      output: sum.output + event.outputTokens,
      total:
        sum.total +
        event.inputTokens +
        event.cacheReadTokens +
        event.outputTokens,
    }),
    { input: 0, cached: 0, output: 0, total: 0 }
  );
}

describe("Codex cumulative token accounting", () => {
  it("uses turn_context when session_meta no longer contains a model", async () => {
    const root = await createRoot();
    const id = "01010101-0101-0101-0101-010101010101";
    await writeRows(root, id, [
      meta(id, { model: null }),
      turnContext("gpt-5.6-sol", 1),
      token({ input: 100, output: 10, cached: 80 }, 2),
    ]);

    const result = await readCodexUsageFromDirectory(root, "2026-07-01");

    expect(result.events).toHaveLength(1);
    expect(result.events[0].model).toBe("gpt-5.6-sol");
  });

  it("attributes cumulative deltas to the model active at each token row", async () => {
    const root = await createRoot();
    const id = "02020202-0202-0202-0202-020202020202";
    await writeRows(root, id, [
      meta(id, { model: null }),
      turnContext("gpt-5.6-sol", 1),
      token({ input: 100, output: 10, cached: 80 }, 2),
      turnContext("gpt-5.7-sol", 3),
      token({ input: 160, output: 20, cached: 120 }, 4),
    ]);

    const result = await readCodexUsageFromDirectory(root, "2026-07-01");

    expect(result.events.map((event) => event.model)).toEqual(["gpt-5.6-sol", "gpt-5.7-sol"]);
    expect(totals(result.events)).toEqual({ input: 40, cached: 120, output: 20, total: 180 });
  });

  it("accepts known model key aliases used by future context envelopes", async () => {
    const root = await createRoot();
    const id = "03030303-0303-0303-0303-030303030303";
    await writeRows(root, id, [
      meta(id, { model: null }),
      turnContext("gpt-5.7-sol", 1, "model_id"),
      token({ input: 100, output: 10, cached: 80 }, 2),
    ]);

    const result = await readCodexUsageFromDirectory(root, "2026-07-01");

    expect(result.events[0].model).toBe("gpt-5.7-sol");
  });

  it("labels missing model metadata explicitly instead of guessing gpt-5", async () => {
    const root = await createRoot();
    const id = "04040404-0404-0404-0404-040404040404";
    await writeRows(root, id, [
      meta(id, { model: null }),
      token({ input: 100, output: 10, cached: 80 }, 1),
    ]);

    const result = await readCodexUsageFromDirectory(root, "2026-07-01");

    expect(result.events[0].model).toBe("codex-unknown");
    expect(result.events[0].costUSD).toBe(0);
  });

  it("keeps ordinary cumulative deltas unchanged", async () => {
    const root = await createRoot();
    await writeSession(root, "11111111-1111-1111-1111-111111111111", [
      { input: 100, output: 10, cached: 80 },
      { input: 150, output: 20, cached: 120 },
    ]);

    const result = await readCodexUsageFromDirectory(root, "2026-07-01");

    expect(totals(result.events)).toEqual({ input: 30, cached: 120, output: 20, total: 170 });
  });

  it("removes a child that fully replays the parent prefix", async () => {
    const root = await createRoot();
    const parentId = "22222222-2222-2222-2222-222222222222";
    const childId = "33333333-3333-3333-3333-333333333333";
    const snapshots = [
      { input: 100, output: 10, cached: 80 },
      { input: 200, output: 20, cached: 160 },
    ];
    await writeSession(root, parentId, snapshots);
    await writeSession(root, childId, snapshots, { parentId, threadSource: "subagent" });

    const result = await readCodexUsageFromDirectory(root, "2026-07-01");

    expect(result.events.filter((event) => event.sessionId === childId)).toHaveLength(0);
    expect(totals(result.events).total).toBe(220);
  });

  it("matches a child replay that starts in the middle of the parent", async () => {
    const root = await createRoot();
    const parentId = "44444444-4444-4444-4444-444444444444";
    const childId = "55555555-5555-5555-5555-555555555555";
    const parent = [
      { input: 50, output: 5, cached: 40 },
      { input: 100, output: 10, cached: 80 },
      { input: 150, output: 15, cached: 120 },
    ];
    await writeSession(root, parentId, parent);
    await writeSession(root, childId, parent.slice(1), { parentId, threadSource: "subagent" });

    const result = await readCodexUsageFromDirectory(root, "2026-07-01");

    expect(result.events.filter((event) => event.sessionId === childId)).toHaveLength(0);
    expect(totals(result.events).total).toBe(165);
  });

  it("keeps real child usage after the replayed prefix", async () => {
    const root = await createRoot();
    const parentId = "66666666-6666-6666-6666-666666666666";
    const childId = "77777777-7777-7777-7777-777777777777";
    const prefix = [
      { input: 100, output: 10, cached: 80 },
      { input: 200, output: 20, cached: 160 },
    ];
    await writeSession(root, parentId, prefix);
    await writeSession(
      root,
      childId,
      [...prefix, { input: 260, output: 25, cached: 208 }],
      { parentId, threadSource: "subagent", replayedParentMeta: true }
    );

    const result = await readCodexUsageFromDirectory(root, "2026-07-01");
    const childEvents = result.events.filter((event) => event.sessionId === childId);

    expect(totals(childEvents)).toEqual({ input: 12, cached: 48, output: 5, total: 65 });
  });

  it("falls back safely when the parent log is missing", async () => {
    const root = await createRoot();
    const childId = "88888888-8888-8888-8888-888888888888";
    await writeSession(root, childId, [{ input: 100, output: 10, cached: 80 }], {
      parentId: "99999999-9999-9999-9999-999999999999",
      threadSource: "subagent",
    });

    const result = await readCodexUsageFromDirectory(root, "2026-07-01");

    expect(totals(result.events)).toEqual({ input: 20, cached: 80, output: 10, total: 110 });
  });

  it("does not remove mismatched parent and child snapshots", async () => {
    const root = await createRoot();
    const parentId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const childId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    await writeSession(root, parentId, [{ input: 100, output: 10, cached: 80 }]);
    await writeSession(root, childId, [{ input: 101, output: 10, cached: 80 }], {
      parentId,
      threadSource: "subagent",
    });

    const result = await readCodexUsageFromDirectory(root, "2026-07-01");

    expect(totals(result.events).total).toBe(221);
  });

  it("preserves cumulative counter reset handling", async () => {
    const root = await createRoot();
    await writeSession(root, "cccccccc-cccc-cccc-cccc-cccccccccccc", [
      { input: 100, output: 10, cached: 80 },
      { input: 20, output: 5, cached: 10 },
    ]);

    const result = await readCodexUsageFromDirectory(root, "2026-07-01");

    expect(totals(result.events)).toEqual({ input: 30, cached: 90, output: 15, total: 135 });
  });

  it("counts cached input exactly once", async () => {
    const root = await createRoot();
    await writeSession(root, "dddddddd-dddd-dddd-dddd-dddddddddddd", [
      { input: 100, output: 10, cached: 80 },
    ]);

    const result = await readCodexUsageFromDirectory(root, "2026-07-01");

    expect(totals(result.events)).toEqual({ input: 20, cached: 80, output: 10, total: 110 });
  });

  it("preserves the reported window duration instead of assuming primary means 5 hours", async () => {
    const root = await createRoot();
    await writeSession(root, "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", [
      { input: 100, output: 10, cached: 80 },
    ], {
      rateLimits: {
        limit_id: "codex",
        plan_type: "prolite",
        primary: {
          used_percent: 27,
          window_minutes: 10080,
          resets_at: 1784683733,
        },
        secondary: null,
      },
    });

    const result = await readCodexUsageFromDirectory(root, "2026-07-01");

    expect(result.latestRateLimits).toHaveLength(1);
    expect(result.latestRateLimits[0]).toMatchObject({
      limitId: "codex",
      planType: "prolite",
      windows: [{ usedPercent: 27, windowMinutes: 10080 }],
    });
  });
});
