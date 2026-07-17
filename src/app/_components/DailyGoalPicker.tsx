"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, Target, X } from "lucide-react";
import { fmtTokens } from "@/lib/format";
import type { UsageSnapshot } from "@/lib/types";

const PRESETS = [50_000_000, 100_000_000, 200_000_000, 500_000_000];
const DEFAULT_TARGET = 200_000_000;

function fmtGoalTokens(value: number): string {
  if (value >= 1_000_000_000) return `${Number((value / 1_000_000_000).toFixed(2))}B`;
  return `${Number((value / 1_000_000).toFixed(2))}M`;
}

type Props = {
  goal?: UsageSnapshot["dailyGoal"];
  currentTokens: number;
  onSaved: () => void | Promise<void>;
};

export function DailyGoalPicker({ goal, currentTokens, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(goal?.enabled ?? true);
  const [targetMillions, setTargetMillions] = useState(String((goal?.targetTokens ?? DEFAULT_TARGET) / 1_000_000));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const targetTokens = Number(targetMillions) * 1_000_000;
  const valid = Number.isFinite(targetTokens) && targetTokens >= 1_000_000 && targetTokens <= 10_000_000_000;
  const previewProgress = valid ? currentTokens / targetTokens : 0;
  const percent = Math.round(previewProgress * 100);
  const savedTarget = goal?.targetTokens ?? DEFAULT_TARGET;

  const waterStyle = useMemo(() => ({
    height: `${Math.max(6, Math.min(100, previewProgress * 100))}%`,
  }), [previewProgress]);

  function show() {
    setEnabled(goal?.enabled ?? true);
    setTargetMillions(String(savedTarget / 1_000_000));
    setError(null);
    setOpen(true);
  }

  function stepTarget(direction: -1 | 1) {
    const current = Number(targetMillions);
    const base = Number.isFinite(current) ? current : DEFAULT_TARGET / 1_000_000;
    const next = Math.min(10_000, Math.max(1, base + direction * 10));
    setTargetMillions(String(next));
  }

  async function save() {
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/daily-goal", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, targetTokens }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || `HTTP ${response.status}`);
      }
      setOpen(false);
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  const dialog = open ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="daily-goal-title"
        className="card w-full max-w-md overflow-hidden !rounded-xl border-zinc-700/70 bg-zinc-950/95 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-zinc-800/70 px-5 py-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-emerald-300">Today · Personal target</div>
            <h2 id="daily-goal-title" className="mt-1 text-base font-semibold text-zinc-50">
              Set a daily token goal
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              The floating orb water level follows today&apos;s total, including cache.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800/70 hover:text-zinc-200"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          <div className="flex items-center justify-between rounded-xl border border-zinc-800/80 bg-zinc-900/45 px-4 py-3">
            <div>
              <div className="text-sm font-medium text-zinc-200">Use daily goal</div>
              <div className="mt-0.5 text-[11px] text-zinc-500">Turn off to keep the orb decorative.</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              onClick={() => setEnabled((current) => !current)}
              className={`relative h-6 w-11 rounded-full border transition-colors ${
                enabled ? "border-emerald-300/40 bg-emerald-400/25" : "border-zinc-700 bg-zinc-800"
              }`}
            >
              <span className={`absolute top-0.5 size-5 rounded-full bg-zinc-100 shadow transition-transform ${
                enabled ? "translate-x-[21px]" : "translate-x-0.5"
              }`} />
            </button>
          </div>

          <div className={enabled ? "" : "opacity-45"}>
            <div className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500">Quick targets</div>
            <div className="grid grid-cols-4 gap-2">
              {PRESETS.map((preset) => {
                const active = valid && targetTokens === preset;
                return (
                  <button
                    type="button"
                    key={preset}
                    disabled={!enabled}
                    onClick={() => setTargetMillions(String(preset / 1_000_000))}
                    className={`rounded-lg border px-2 py-2 text-xs transition-colors ${
                      active
                        ? "border-emerald-300/45 bg-emerald-400/12 text-emerald-200"
                        : "border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                    } disabled:cursor-not-allowed`}
                  >
                    {fmtGoalTokens(preset)}
                  </button>
                );
              })}
            </div>

            <label className="mt-4 block">
              <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500">Custom target</span>
              <div className="mt-2 flex items-center rounded-lg border border-zinc-800 bg-zinc-950/70 focus-within:border-emerald-300/45">
                <input
                  type="text"
                  inputMode="decimal"
                  disabled={!enabled}
                  value={targetMillions}
                  onChange={(event) => setTargetMillions(event.target.value)}
                  className="num min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm text-zinc-100 outline-none disabled:cursor-not-allowed"
                  aria-describedby="daily-goal-hint"
                />
                <div className="flex self-stretch flex-col border-l border-zinc-800" aria-label="Adjust target by 10 million tokens">
                  <button
                    type="button"
                    onClick={() => stepTarget(1)}
                    disabled={!enabled}
                    className="flex min-h-0 flex-1 items-center justify-center px-2 text-zinc-600 transition-colors hover:bg-zinc-800/75 hover:text-zinc-200 disabled:cursor-not-allowed"
                    aria-label="Increase target by 10 million tokens"
                  >
                    <ChevronUp size={12} strokeWidth={2} />
                  </button>
                  <span className="h-px bg-zinc-800" />
                  <button
                    type="button"
                    onClick={() => stepTarget(-1)}
                    disabled={!enabled}
                    className="flex min-h-0 flex-1 items-center justify-center px-2 text-zinc-600 transition-colors hover:bg-zinc-800/75 hover:text-zinc-200 disabled:cursor-not-allowed"
                    aria-label="Decrease target by 10 million tokens"
                  >
                    <ChevronDown size={12} strokeWidth={2} />
                  </button>
                </div>
                <span className="border-l border-zinc-800 px-3 text-xs text-zinc-500">million tokens</span>
              </div>
              <span id="daily-goal-hint" className={`mt-1.5 block text-[10px] ${valid ? "text-zinc-600" : "text-rose-300"}`}>
                {valid ? "Allowed range: 1M–10B" : "Enter a target between 1 and 10,000 million tokens."}
              </span>
            </label>
          </div>

          <div className="relative overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-900/35 p-4">
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-emerald-400/15 to-cyan-300/5 transition-[height] duration-500" style={waterStyle} />
            <div className="relative flex items-end justify-between gap-4">
              <div>
                <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">Today&apos;s preview</div>
                <div className="num mt-1 text-lg font-semibold text-zinc-100">
                  {fmtTokens(currentTokens)} <span className="text-xs font-normal text-zinc-500">/ {valid ? fmtGoalTokens(targetTokens) : "—"}</span>
                </div>
              </div>
              <div className="num text-xl font-semibold text-emerald-200">{enabled && valid ? `${percent}%` : "Off"}</div>
            </div>
          </div>

          {error && <div className="text-xs text-rose-300">Failed to update: {error}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-800/70 px-5 py-4">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-lg px-3.5 py-2 text-xs text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!valid || saving}
            className="rounded-lg bg-zinc-100 px-4 py-2 text-xs font-medium text-zinc-950 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save goal"}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        type="button"
        onClick={show}
        className="group flex items-center gap-1.5 rounded-full border border-zinc-700/70 bg-zinc-950/35 px-2.5 py-1 text-[10px] font-medium text-zinc-400 transition-colors hover:border-emerald-300/35 hover:text-zinc-200"
        aria-label="Set daily token goal"
      >
        <Target size={11} className="text-emerald-300/75 transition-colors group-hover:text-emerald-300" />
        <span>Daily goal</span>
        <span className="num text-zinc-200">{goal?.enabled === false ? "Off" : fmtGoalTokens(savedTarget)}</span>
      </button>
      {dialog ? createPortal(dialog, document.body) : null}
    </>
  );
}
