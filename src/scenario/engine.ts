// データ駆動のシナリオ進行エンジン（純粋な関数のみ．three.js・ブラウザ API に依存しない）．
// app/ が毎フレーム advance() を呼び，返ってきた effects をイベントバスへ流す
import type { Cue } from "../core/cue";
import type { GameEvent } from "../core/events";
import type { EvaluationRecord, ScenarioResult, StepOutcome, StepRecord } from "../core/result";
import type {
  AdvanceResult,
  Condition,
  ScenarioDefinition,
  ScenarioEffect,
  ScenarioInput,
  ScenarioState,
  StepDefinition,
} from "./types";

type LeafCondition = Exclude<Condition, { type: "all" } | { type: "any" } | { type: "together" }>;

/**
 * 評価の仕方．"latched" は一度満たしたら場面の間は満たしたまま（通常），
 * "now" は今この瞬間満たしているか（together の子）
 */
type EvalMode = "latched" | "now";

/** 条件の評価中だけ使う書き換え可能な途中経過 */
interface EvalContext {
  readonly input: ScenarioInput;
  readonly events: readonly GameEvent[];
  readonly dt: number;
  readonly stepElapsed: number;
  readonly holdTimers: Record<string, number>;
  readonly latched: Record<string, true>;
  /** touch・signal の条件を満たすのに使われた出来事の添字（events の添字） */
  readonly usedEvents: Set<number>;
}

const EMPTY_PROGRESS = { holdTimers: {}, latched: {} } as const;

/** シナリオを始める．最初の場面の演出が effects に入る */
export function startScenario(def: ScenarioDefinition): AdvanceResult {
  const initial: ScenarioState = {
    status: "running",
    stepId: null,
    stepElapsed: 0,
    totalElapsed: 0,
    progress: EMPTY_PROGRESS,
    firedHints: [],
    firedChecks: [],
    steps: [],
    evaluations: [],
    aborted: false,
    pendingEvents: [],
  };
  const effects: ScenarioEffect[] = [];
  const state = enterStep(def, initial, def.steps[0]?.id ?? null, effects);
  return { state, effects };
}

/**
 * 1 フレーム進める．
 * @param events このフレームの間に部屋で起きた出来事
 * @param dt 前のフレームからの経過秒数
 */
export function advance(
  def: ScenarioDefinition,
  state: ScenarioState,
  input: ScenarioInput,
  events: readonly GameEvent[],
  dt: number,
): AdvanceResult {
  if (state.status === "finished") return { state, effects: [] };
  const effects: ScenarioEffect[] = [];
  const step = findStep(def, state.stepId);
  if (step === undefined) {
    return { state: finish(state, false, effects), effects };
  }

  const stepElapsed = state.stepElapsed + dt;
  const totalElapsed = state.totalElapsed + dt;
  // 前のフレームで場面が切り替わった時に持ち越した出来事を先に並べる
  const allEvents: readonly GameEvent[] =
    state.pendingEvents.length > 0 ? [...state.pendingEvents, ...events] : events;
  const ctx: EvalContext = {
    input,
    events: allEvents,
    dt,
    stepElapsed,
    holdTimers: { ...state.progress.holdTimers },
    latched: { ...state.progress.latched },
    usedEvents: new Set(),
  };

  // 助言
  const firedHints = [...state.firedHints];
  (step.hints ?? []).forEach((hint, index) => {
    if (firedHints.includes(index) || stepElapsed < hint.afterSeconds) return;
    firedHints.push(index);
    pushCues(effects, hint.cues);
  });

  // 行動の評価
  const firedChecks = [...state.firedChecks];
  const evaluations = [...state.evaluations];
  for (const check of step.checks ?? []) {
    if (firedChecks.includes(check.id)) continue;
    if (!evaluate(check.when, `check:${check.id}`, ctx, "latched")) continue;
    firedChecks.push(check.id);
    const record: EvaluationRecord = {
      id: check.id,
      stepId: step.id,
      label: check.label,
      polarity: check.polarity,
      advice: check.advice,
      atSeconds: totalElapsed,
    };
    evaluations.push(record);
    effects.push({ type: "evaluated", record });
  }

  const goalMet = evaluate(step.goal, "goal", ctx, "latched");
  const current: ScenarioState = {
    ...state,
    stepElapsed,
    totalElapsed,
    progress: { holdTimers: ctx.holdTimers, latched: ctx.latched },
    firedHints,
    firedChecks,
    evaluations,
    pendingEvents: [],
  };

  const overLimit = def.timeLimitSeconds !== undefined && totalElapsed >= def.timeLimitSeconds;
  // 場面が切り替わる時に次の場面へ持ち越す出来事（前の場面で使われたものを除く）
  const carried = allEvents.filter((_, i) => !ctx.usedEvents.has(i));

  // 達成は時間切れ（場面・全体）より優先する
  if (goalMet) {
    pushCues(effects, step.onComplete ?? []);
    const done = finishStep(current, step, "completed", effects);
    return {
      state: moveTo(def, done, resolveNext(def, step, step.next), overLimit, carried, effects),
      effects,
    };
  }

  if (step.timeout !== undefined && stepElapsed >= step.timeout.seconds) {
    pushCues(effects, step.timeout.cues ?? []);
    const done = finishStep(current, step, "timedOut", effects);
    const next =
      step.timeout.next !== undefined ? step.timeout.next : resolveNext(def, step, step.next);
    return { state: moveTo(def, done, next, overLimit, carried, effects), effects };
  }

  if (overLimit) {
    const done = finishStep(current, step, "timedOut", effects);
    return { state: finish(done, true, effects), effects };
  }

  return { state: current, effects };
}

/** 結果画面・アップロード用にまとめる */
export function toResult(def: ScenarioDefinition, state: ScenarioState): ScenarioResult {
  return {
    scenarioId: def.id,
    title: def.title,
    totalSeconds: state.totalElapsed,
    aborted: state.aborted,
    steps: state.steps,
    evaluations: state.evaluations,
  };
}

/** 定義の誤り（ID の重複・存在しない行き先等）を返す．空配列なら問題なし */
export function validateScenario(def: ScenarioDefinition): string[] {
  const errors: string[] = [];
  if (def.steps.length === 0) errors.push("steps が空です");
  const ids = new Set<string>();
  for (const step of def.steps) {
    if (ids.has(step.id)) errors.push(`場面 ID が重複しています: ${step.id}`);
    ids.add(step.id);
  }
  if (
    def.timeLimitSeconds !== undefined &&
    !(Number.isFinite(def.timeLimitSeconds) && def.timeLimitSeconds > 0)
  ) {
    errors.push("全体の制限時間（timeLimitSeconds）は正の有限な数にしてください");
  }
  const checkTarget = (from: string, target: string | null | undefined) => {
    if (typeof target === "string" && !ids.has(target)) {
      errors.push(`場面 ${from} の行き先が存在しません: ${target}`);
    }
  };
  for (const step of def.steps) {
    checkTarget(step.id, step.next);
    checkTarget(step.id, step.timeout?.next);
    if (
      step.timeout !== undefined &&
      !(Number.isFinite(step.timeout.seconds) && step.timeout.seconds > 0)
    ) {
      errors.push(`場面 ${step.id} の制限時間は正の有限な数にしてください`);
    }
    const checkIds = new Set<string>();
    for (const check of step.checks ?? []) {
      if (checkIds.has(check.id))
        errors.push(`場面 ${step.id} の評価 ID が重複しています: ${check.id}`);
      checkIds.add(check.id);
    }
  }
  return errors;
}

function findStep(def: ScenarioDefinition, id: string | null): StepDefinition | undefined {
  if (id === null) return undefined;
  return def.steps.find((s) => s.id === id);
}

/** next が省略されていれば配列の次の場面（最後なら終了） */
function resolveNext(
  def: ScenarioDefinition,
  step: StepDefinition,
  next: string | null | undefined,
): string | null {
  if (next !== undefined) return next;
  const index = def.steps.indexOf(step);
  return def.steps[index + 1]?.id ?? null;
}

function pushCues(effects: ScenarioEffect[], cues: readonly Cue[]): void {
  for (const cue of cues) effects.push({ type: "cue", cue });
}

function finishStep(
  state: ScenarioState,
  step: StepDefinition,
  outcome: StepOutcome,
  effects: ScenarioEffect[],
): ScenarioState {
  const record: StepRecord = {
    stepId: step.id,
    label: step.report?.label,
    advice: step.report?.advice,
    outcome,
    startedAt: state.totalElapsed - state.stepElapsed,
    durationSeconds: state.stepElapsed,
  };
  effects.push({ type: "stepFinished", record });
  return { ...state, steps: [...state.steps, record] };
}

/**
 * 場面を終えた後の行き先へ進む．全体の制限時間を過ぎていれば，残りの場面がある時だけ打ち切り
 * （aborted）にし，最後の場面を終えたのなら通常の終了とする
 */
function moveTo(
  def: ScenarioDefinition,
  state: ScenarioState,
  next: string | null,
  overLimit: boolean,
  carried: readonly GameEvent[],
  effects: ScenarioEffect[],
): ScenarioState {
  if (overLimit) return finish(state, findStep(def, next) !== undefined, effects);
  const entered = enterStep(def, state, next, effects);
  return entered.status === "running" ? { ...entered, pendingEvents: carried } : entered;
}

function enterStep(
  def: ScenarioDefinition,
  state: ScenarioState,
  stepId: string | null,
  effects: ScenarioEffect[],
): ScenarioState {
  const step = findStep(def, stepId);
  if (step === undefined) return finish(state, false, effects);
  effects.push({ type: "stepEntered", stepId: step.id });
  pushCues(effects, step.onEnter ?? []);
  return {
    ...state,
    stepId: step.id,
    stepElapsed: 0,
    progress: EMPTY_PROGRESS,
    firedHints: [],
    firedChecks: [],
    pendingEvents: [],
  };
}

function finish(state: ScenarioState, aborted: boolean, effects: ScenarioEffect[]): ScenarioState {
  effects.push({ type: "finished" });
  return { ...state, status: "finished", stepId: null, aborted, pendingEvents: [] };
}

/**
 * 条件を評価する．
 * - "latched": 葉と together は一度満たすとその場面の間は満たしたままにする．all はそれぞれ一度は満たした
 * - "now": ラッチを使わず今この瞬間満たしているかを返す（together の子に使う）
 */
function evaluate(cond: Condition, path: string, ctx: EvalContext, mode: EvalMode): boolean {
  if (cond.type === "all" || cond.type === "any") {
    // 継続時間を数えるため，途中で結果が決まっても子をすべて評価する
    const results = cond.conditions.map((c, i) => evaluate(c, `${path}/${i}`, ctx, mode));
    return cond.type === "all" ? results.every(Boolean) : results.some(Boolean);
  }
  if (mode === "latched" && ctx.latched[path] === true) return true;
  const met =
    cond.type === "together"
      ? hold(
          ctx,
          path,
          cond.conditions.map((c, i) => evaluate(c, `${path}/${i}`, ctx, "now")).every(Boolean),
          cond.holdSeconds,
        )
      : evaluateLeaf(cond, path, ctx);
  if (met && mode === "latched") ctx.latched[path] = true;
  return met;
}

/** 葉の条件を今この瞬間満たしているか（継続時間付きの条件は，その継続時間を満たしているか） */
function evaluateLeaf(cond: LeafCondition, path: string, ctx: EvalContext): boolean {
  switch (cond.type) {
    case "posture":
      return hold(ctx, path, ctx.input.posture === cond.posture, cond.holdSeconds);
    case "walking":
      return hold(ctx, path, ctx.input.walking, cond.holdSeconds);
    case "inArea":
      return hold(ctx, path, ctx.input.areaIds.includes(cond.areaId), cond.holdSeconds);
    case "touch":
      return useEvents(ctx, (e) => e.type === "objectTouched" && e.objectId === cond.objectId);
    case "signal":
      return useEvents(ctx, (e) => e.type === "signal" && e.name === cond.name);
    case "elapsed":
      return ctx.stepElapsed >= cond.seconds;
    default:
      return assertNever(cond);
  }
}

/** 一致する出来事があれば，それらを「使われた」として記録して true を返す */
function useEvents(ctx: EvalContext, match: (e: GameEvent) => boolean): boolean {
  let found = false;
  ctx.events.forEach((e, i) => {
    if (!match(e)) return;
    ctx.usedEvents.add(i);
    found = true;
  });
  return found;
}

/** active が続いた時間を数え，holdSeconds 以上続いたら true．途切れたら 0 に戻す */
function hold(ctx: EvalContext, path: string, active: boolean, holdSeconds = 0): boolean {
  if (!active) {
    ctx.holdTimers[path] = 0;
    return false;
  }
  const t = (ctx.holdTimers[path] ?? 0) + ctx.dt;
  ctx.holdTimers[path] = t;
  return t >= holdSeconds;
}

function assertNever(value: never): never {
  throw new Error(`未対応の条件です: ${JSON.stringify(value)}`);
}
