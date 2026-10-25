// 避難の画面（scenario）の組み立て．scenes/school/ の校舎の 3D と歩行，scenario/ の火災訓練のシナリオ，
// sim/ の正解経路・エラー行動の判定・評価を，SPEC_01「毎フレームの処理」の順に呼んでつなぐ（判定・計算は各モジュールの関数）．
// 延焼（space.spread）・歩く速さの倍率（WalkWorld.walkSpeedScale）・集合場所のエリア（assembly）・燃えているマスの当たり判定は校舎が持ち，
// 赤い表示（space.redEdge）は判定の結果で毎フレーム出す・消すを指示する

import * as THREE from "three";
import { SOUND_ID, soundCue } from "../core/audioIds";
import type { DrillSample } from "../core/drill";
import type { GameEvent } from "../core/events";
import type { Scene, SceneContext } from "../core/scene";
import type { CellRef, SchoolPlan } from "../core/schoolPlan";
import { formatPlayerInput } from "../input/inputParam";
import { buildDrillScenario, DRILL_STEP } from "../scenario/drill";
import { advance, startScenario, toResult } from "../scenario/engine";
import type { ScenarioDefinition, ScenarioEffect, ScenarioState } from "../scenario/types";
import { createSchoolScene, type SchoolSpace } from "../scenes/school/schoolPlanScene";
import { createSchoolWalkWorld, SCHOOL_WALK_SPEED_SCALE } from "../scenes/school/schoolPlanWalk";
import { scaledWalkSpeed } from "../scenes/walk/locomotion";
import { SpaceWalker } from "../scenes/walk/walker";
import {
  detectErrorBehaviors,
  type ErrorBehaviors,
  evaluateDrill,
  resolveReferenceRoute,
  type SpreadMap,
} from "../sim";
import {
  INITIAL_WARNING_TIMER,
  tickNearFireWarning,
  tickTrack,
  type WarningTimer,
} from "./drillProgress";
import { FALLBACK_PLAN } from "./fallbackPlan";
import { routeFacingYaw } from "./pcMode";
import { withResolvedRoute } from "./resolvedRoute";

export interface DrillSceneOptions {
  /** テクスチャの異方性フィルタの上限（校舎の 3D に渡す） */
  readonly maxAnisotropy: number;
  /** true の時だけ，進み具合と PlayerInput を画面の左上に出す（確認用） */
  readonly debug?: boolean;
  /** true の間は時間を進めない（縦向きの案内が出ている間．app/ が orientationGuide の状態を渡す） */
  readonly isPaused?: () => boolean;
  /** debug の時，左上の表示の最後に足す文字列（ロビーの練習から求めた判定の値等．app/ が渡す） */
  readonly debugInfo?: () => string;
  /** true なら ① 授業中の教室を飛ばし，② 非常ベルと校内放送から始める（デモ用の起動．app/ が渡す） */
  readonly skipClassroom?: boolean;
  /**
   * PC モード（Issue #205）の時に渡す．controls（操作の説明．1 行ずつ）を画面の左下に出し続け，
   * 開始の向きを正解経路の少し先へ向ける（校舎データの開始の向きが壁の正面だと，PC では見回し方が分からず迷うため）
   */
  readonly pc?: { readonly controls: readonly string[] } | null;
}

/** 避難の画面．見守りの送信が読む値も返す */
export interface DrillScene extends Scene {
  /** 非常ベルからの秒数（s）．非常ベルの前は null */
  alarmSeconds(): number | null;
  /** 今いる階（SchoolPlan.floors の添字） */
  floor(): number;
}

/** GameEvent の種類（バスに流れたもののうち，シナリオの判定に渡すもの） */
const GAME_EVENT_TYPES: ReadonlySet<string> = new Set([
  "objectTouched",
  "areaEntered",
  "areaExited",
  "signal",
]);

function isGameEvent(event: { readonly type: string }): event is GameEvent {
  return GAME_EVENT_TYPES.has(event.type);
}

/** 避難の画面に入る時に決める，体験の間変わらない値 */
interface DrillSetup {
  readonly plan: SchoolPlan;
  /** 延焼（組み立てた校舎の space.spread．火と煙の見た目・燃えているマスの当たり判定と同じもの） */
  readonly spread: SpreadMap;
  readonly route: readonly CellRef[];
  readonly definition: ScenarioDefinition;
}

/**
 * 組み立てた校舎から正解経路・シナリオを求める（SPEC_01「毎フレームの処理」の前の準備）．
 * 延焼は校舎が求めた space.spread を使い，赤い表示の判定・評価・正解経路を見た目と同じ値にそろえる
 */
function prepareDrill(space: SchoolSpace, skipClassroom: boolean): DrillSetup {
  const { plan, spread } = space;
  const { route } = resolveReferenceRoute(plan, spread);
  return { plan, spread, route, definition: buildDrillScenario(plan, { skipClassroom }) };
}

export function createDrillScene(options: DrillSceneOptions): DrillScene {
  let ctxRef: SceneContext | null = null;
  let setup: DrillSetup | null = null;
  let space: SchoolSpace | null = null;
  let walker: SpaceWalker | null = null;
  let debugRoot: HTMLPreElement | null = null;
  let controlsRoot: HTMLDivElement | null = null;
  let unsubscribe: (() => void) | null = null;
  let previousBackground: SceneContext["stage"]["world"]["background"] = null;
  let previousFog: SceneContext["stage"]["world"]["fog"] = null;

  let scenarioState: ScenarioState | null = null;
  /** このフレームまでにバスに流れた GameEvent（次の advance() に渡して空にする） */
  let pendingEvents: GameEvent[] = [];
  /** 非常ベルからの秒数（s）．非常ベルの前は null */
  let alarmSeconds: number | null = null;
  /** 避難（③）が終わったか（集合場所に着いた・時間切れ）．終わったら記録と赤い表示をやめる */
  let evacuationOver = false;
  let samples: DrillSample[] = [];
  let nextSampleAt = 0;
  let warning: WarningTimer = INITIAL_WARNING_TIMER;
  let lastErrors: ErrorBehaviors | null = null;
  let finished = false;
  /** シナリオに渡すエリアの ID（校舎の歩行のエリア．集合場所のマスでは assembly を含む） */
  let areaIds: readonly string[] = [];
  // 赤い表示の判定に渡す今の位置（毎フレーム作らずに使い回す）
  const current: { -readonly [K in keyof DrillSample]: DrillSample[K] } = {
    t: 0,
    floor: 0,
    x: 0,
    z: 0,
    posture: "standing",
  };

  const handleEffects = (ctx: SceneContext, effects: readonly ScenarioEffect[]): void => {
    for (const effect of effects) {
      switch (effect.type) {
        case "cue":
          ctx.bus.emit({ type: "cue", cue: effect.cue });
          break;
        case "stepEntered":
          ctx.bus.emit({ type: "stepEntered", stepId: effect.stepId });
          // ② の始まり（非常ベル）を 0 秒とする（SPEC_01「VR 避難の規則」）
          if (effect.stepId === DRILL_STEP.alarm) alarmSeconds = 0;
          break;
        case "stepFinished":
          if (effect.record.stepId === DRILL_STEP.evacuate) evacuationOver = true;
          break;
        case "finished":
          evacuationOver = true;
          break;
        case "evaluated":
          break;
      }
    }
  };

  const finish = (ctx: SceneContext, drill: DrillSetup, state: ScenarioState): void => {
    finished = true;
    space?.redEdge.setActive(false);
    const track = { samples };
    const evaluation = evaluateDrill(drill.plan, drill.spread, track, { route: drill.route });
    // 結果画面・見守りが同じ校舎（経路を埋めたもの）を読むよう，避難に使った校舎を書く
    ctx.session.plan = drill.plan;
    ctx.session.drill = { track, evaluation };
    const result = toResult(drill.definition, state);
    ctx.session.result = result;
    ctx.bus.emit({ type: "scenarioFinished", result });
    ctx.goTo("debrief");
  };

  /** 判定と記録を行う間か（非常ベルから避難が終わるまで．評価の窓（非常ベルの 0 秒から）と同じ範囲） */
  const isJudging = (): boolean => alarmSeconds !== null && !evacuationOver;

  return {
    id: "scenario",
    alarmSeconds: () => alarmSeconds,
    floor: () => current.floor,
    enter(ctx) {
      ctxRef = ctx;
      // 校舎データ（#p=）が無い・読めない時は既定の校舎（FALLBACK_PLAN．発表のデモ用の校舎）を使う（SPEC_01「起動の切り替え」）．
      // URL から読んだ校舎は app.ts が経路を埋め済み．デモの校舎に替えた時もここで同じように埋める（床の矢印が同じ経路を使うため）
      const plan = withResolvedRoute(ctx.session.plan ?? FALLBACK_PLAN);
      // 赤い表示は app/ が判定して setActive で指示する（autoRedEdge は使わない）
      const built = createSchoolScene({ maxAnisotropy: options.maxAnisotropy }, plan);
      space = built;
      const drill = prepareDrill(built, options.skipClassroom === true);
      setup = drill;
      scenarioState = null;
      pendingEvents = [];
      alarmSeconds = null;
      evacuationOver = false;
      samples = [];
      nextSampleAt = 0;
      warning = INITIAL_WARNING_TIMER;
      lastErrors = null;
      finished = false;
      areaIds = [];
      // 階段・複数の階は扱わない（校舎の 3D は 1 つの階だけを作る）ため，開始地点の階にいるものとする
      current.floor = drill.plan.drill.start.floor;

      const { world, rig } = ctx.stage;
      world.add(built.root);
      previousBackground = world.background;
      previousFog = world.fog;
      world.background = new THREE.Color(built.background);
      // 煙のフォグ（濃さは校舎の update が時刻と目の位置で書き換える）
      world.fog = built.fog;

      unsubscribe = ctx.bus.onAny((event) => {
        if (isGameEvent(event)) pendingEvents.push(event);
      });
      const pc = options.pc ?? null;
      const startYaw =
        pc === null
          ? built.startYaw
          : (routeFacingYaw(drill.plan.drill.start, drill.route) ?? built.startYaw);
      walker = new SpaceWalker(
        createSchoolWalkWorld(built),
        { position: built.startPosition, bodyYaw: startYaw },
        (event) => ctx.bus.emit(event),
      );
      walker.applyTo(rig);
      // 非常ベルの前は時刻を NaN にする（火と煙を出さず，燃えているマスもふさがない）
      built.update?.({ seconds: Number.NaN, eye: rig.position, dt: 0, posture: "standing" });
      if (options.debug === true) {
        debugRoot = document.createElement("pre");
        debugRoot.style.cssText =
          "position:absolute;left:8px;top:8px;max-width:45vw;max-height:90vh;overflow:hidden;margin:0;" +
          "padding:8px;pointer-events:none;white-space:pre-wrap;background:rgba(16,20,28,0.75);" +
          "color:#f2f4f8;font:11px/1.4 ui-monospace,monospace;border-radius:6px;";
        ctx.stage.overlay.appendChild(debugRoot);
      }

      if (pc !== null) {
        controlsRoot = document.createElement("div");
        controlsRoot.style.cssText =
          "position:absolute;left:12px;bottom:12px;margin:0;padding:8px 12px;pointer-events:none;" +
          "background:rgba(16,20,28,0.72);color:#f2f4f8;border-radius:8px;" +
          'font:14px/1.6 system-ui,-apple-system,"Hiragino Sans",sans-serif;white-space:pre-line;';
        controlsRoot.textContent = pc.controls.join("\n");
        ctx.stage.overlay.appendChild(controlsRoot);
      }

      const started = startScenario(drill.definition);
      scenarioState = started.state;
      handleEffects(ctx, started.effects);
    },
    update(frame) {
      const ctx = ctxRef;
      const drill = setup;
      if (ctx === null || drill === null || space === null || walker === null) return;
      if (scenarioState === null || finished) return;
      // 縦向きの案内の間は時間を進めない（歩かず，シナリオ・延焼の時刻も止める）
      if (options.isPaused?.() === true) return;
      const { dt } = frame;
      if (alarmSeconds !== null) alarmSeconds += dt;

      // 1. 校舎の中で歩かせる（エリアの出入りはバスに流れ，pendingEvents に入る．
      // 校舎の歩く速さの倍率は校舎の WalkWorld.walkSpeedScale が掛ける）
      const { input } = frame;
      walker.update({ dt, input });
      walker.applyTo(ctx.stage.rig);

      // 2. シナリオを 1 フレーム進め，演出をバスへ流す（集合場所のマスでは校舎のエリアに assembly が入る）
      const { x, z } = walker.state;
      areaIds = walker.observe().areaIds;
      const events = pendingEvents;
      pendingEvents = [];
      const advanced = advance(
        drill.definition,
        scenarioState,
        { posture: input.posture, walking: input.walking, areaIds },
        events,
        dt,
      );
      scenarioState = advanced.state;
      handleEffects(ctx, advanced.effects);

      // 3. 非常ベルから避難が終わるまで，記録と赤い表示の判定を行う
      current.t = alarmSeconds ?? 0;
      current.x = x;
      current.z = z;
      current.posture = input.posture;
      if (isJudging()) {
        const tick = tickTrack(nextSampleAt, current.t);
        nextSampleAt = tick.nextAt;
        if (tick.record) samples.push({ ...current });
        const errors = detectErrorBehaviors(drill.plan, drill.spread, current);
        lastErrors = errors;
        space.redEdge.setActive(errors.any);
        const warn = tickNearFireWarning(warning, errors.nearFire, dt);
        warning = warn.timer;
        if (warn.play) {
          ctx.bus.emit({ type: "cue", cue: soundCue(SOUND_ID.nearFireWarning, "play") });
        }
      } else {
        lastErrors = null;
        space.redEdge.setActive(false);
        warning = INITIAL_WARNING_TIMER;
      }
      // 火と煙の見た目・燃えているマスの当たり判定を非常ベルからの時刻に合わせ，赤い表示のフェードを進める
      // （非常ベルの前は NaN で，何も燃えておらず燃えているマスもふさがない）
      space.update?.({
        seconds: alarmSeconds ?? Number.NaN,
        eye: ctx.stage.rig.position,
        dt,
        posture: input.posture,
      });

      if (debugRoot !== null) {
        const text = [
          `step ${scenarioState.stepId ?? "-"}  alarm ${alarmSeconds === null ? "-" : `${alarmSeconds.toFixed(1)} s`}`,
          `pos ${x.toFixed(2)}, ${z.toFixed(2)}  areas ${areaIds.join(", ") || "-"}`,
          `error ${lastErrors === null ? "-" : `smokeStanding=${lastErrors.smokeStanding} nearFire=${lastErrors.nearFire}`}  redEdge ${space.redEdge.opacity.toFixed(2)}`,
          `walk ${scaledWalkSpeed(input.walking ? input.walkSpeed : 0, SCHOOL_WALK_SPEED_SCALE).toFixed(2)} m/s (x${SCHOOL_WALK_SPEED_SCALE})`,
          `track ${samples.length} samples`,
          "",
          `PlayerInput:\n${formatPlayerInput(frame.input)}`,
          ...(options.debugInfo === undefined ? [] : ["", options.debugInfo()]),
        ].join("\n");
        // 変わった時だけ書き換える（毎フレームの DOM の更新を避ける）
        if (debugRoot.textContent !== text) debugRoot.textContent = text;
      }

      // 4. シナリオが終わったら評価して結果画面へ進む
      if (scenarioState.status === "finished") finish(ctx, drill, scenarioState);
    },
    exit() {
      unsubscribe?.();
      unsubscribe = null;
      const ctx = ctxRef;
      if (ctx !== null && space !== null) {
        ctx.stage.world.remove(space.root);
        ctx.stage.world.background = previousBackground;
        ctx.stage.world.fog = previousFog;
      }
      space?.dispose();
      space = null;
      walker = null;
      debugRoot?.remove();
      debugRoot = null;
      controlsRoot?.remove();
      controlsRoot = null;
      setup = null;
      scenarioState = null;
      pendingEvents = [];
      ctxRef = null;
    },
  };
}
