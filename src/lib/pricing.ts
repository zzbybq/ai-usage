type ModelPricing = {
  input: number;
  output: number;
  cacheCreate?: number;
  cacheRead?: number;
};

const M = 1_000_000;

const TABLE: Record<string, ModelPricing> = {
  "claude-opus-4-7": { input: 15 / M, output: 75 / M, cacheCreate: 18.75 / M, cacheRead: 1.5 / M },
  "claude-opus-4-6": { input: 15 / M, output: 75 / M, cacheCreate: 18.75 / M, cacheRead: 1.5 / M },
  "claude-opus-4": { input: 15 / M, output: 75 / M, cacheCreate: 18.75 / M, cacheRead: 1.5 / M },
  "claude-sonnet-4-6": { input: 3 / M, output: 15 / M, cacheCreate: 3.75 / M, cacheRead: 0.3 / M },
  "claude-sonnet-4-5": { input: 3 / M, output: 15 / M, cacheCreate: 3.75 / M, cacheRead: 0.3 / M },
  "claude-sonnet-4": { input: 3 / M, output: 15 / M, cacheCreate: 3.75 / M, cacheRead: 0.3 / M },
  "claude-haiku-4-5": { input: 1 / M, output: 5 / M, cacheCreate: 1.25 / M, cacheRead: 0.1 / M },
  "claude-haiku-4": { input: 1 / M, output: 5 / M, cacheCreate: 1.25 / M, cacheRead: 0.1 / M },
  "claude-3-5-sonnet": { input: 3 / M, output: 15 / M, cacheCreate: 3.75 / M, cacheRead: 0.3 / M },
  "claude-3-7-sonnet": { input: 3 / M, output: 15 / M, cacheCreate: 3.75 / M, cacheRead: 0.3 / M },
  "claude-3-5-haiku": { input: 0.8 / M, output: 4 / M, cacheCreate: 1 / M, cacheRead: 0.08 / M },
  "deepseek-v4-pro": { input: 0.27 / M, output: 1.1 / M, cacheCreate: 0.27 / M, cacheRead: 0.07 / M },
  "gpt-5": { input: 1.25 / M, output: 10 / M, cacheRead: 0.125 / M },
  "gpt-5-mini": { input: 0.25 / M, output: 2 / M, cacheRead: 0.025 / M },
  "gpt-5-nano": { input: 0.05 / M, output: 0.4 / M, cacheRead: 0.005 / M },
  "gpt-5-codex": { input: 1.25 / M, output: 10 / M, cacheRead: 0.125 / M },
  "o4-mini": { input: 1.1 / M, output: 4.4 / M, cacheRead: 0.275 / M },
  "o3": { input: 2 / M, output: 8 / M, cacheRead: 0.5 / M },
  "o3-mini": { input: 1.1 / M, output: 4.4 / M, cacheRead: 0.55 / M },
  "glm-5.2": { input: 0.07 / M, output: 0.07 / M, cacheRead: 0.007 / M },
  "glm-5.1": { input: 0.07 / M, output: 0.07 / M, cacheRead: 0.007 / M },
};

const FALLBACK: ModelPricing = { input: 3 / M, output: 15 / M, cacheCreate: 3.75 / M, cacheRead: 0.3 / M };

function resolve(model: string): ModelPricing {
  const key = model.toLowerCase();
  if (TABLE[key]) return TABLE[key];
  for (const k of Object.keys(TABLE)) {
    if (key.startsWith(k) || key.includes(k)) return TABLE[k];
  }
  if (key.includes("opus")) return TABLE["claude-opus-4-7"];
  if (key.includes("sonnet")) return TABLE["claude-sonnet-4-6"];
  if (key.includes("haiku")) return TABLE["claude-haiku-4-5"];
  if (key.includes("gpt-5") || key.includes("codex")) return TABLE["gpt-5"];
  if (key.includes("glm")) return TABLE["glm-5.2"];
  return FALLBACK;
}

export function costFor(
  model: string,
  tokens: { input: number; output: number; cacheCreate?: number; cacheRead?: number }
): number {
  const p = resolve(model);
  return (
    tokens.input * p.input +
    tokens.output * p.output +
    (tokens.cacheCreate ?? 0) * (p.cacheCreate ?? p.input) +
    (tokens.cacheRead ?? 0) * (p.cacheRead ?? p.input * 0.1)
  );
}
