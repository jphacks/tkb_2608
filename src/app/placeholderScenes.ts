// 未実装の画面の仮表示（シナリオの画面ができたら置き換える）

import type { Scene, SceneContext } from "../core/scene";
import { formatPlayerInput } from "../input/inputParam";
import { LOBBY_EYE_HEIGHT } from "../lobby/lobbyRoom";
import { createNoticeBoard, type NoticeBoard } from "../lobby/noticeBoard";
import { DEMO_SCHOOL } from "../share/samples/demoSchool";
import { createSampleDrill } from "./sampleDrill";
import {
  advancePlaceholderTimer,
  INITIAL_PLACEHOLDER_TIMER,
  isPlaceholderDone,
  type PlaceholderTimer,
  placeholderRemainingSeconds,
} from "./scenarioPlaceholderTimer";

export interface ScenarioPlaceholderOptions {
  /** true の時だけ，Session.calibration と毎フレームの PlayerInput を画面の左上に出す（確認用．操作はできない） */
  readonly debug?: boolean;
  /** true の間は時間を数えない（縦向きの案内が出ている間．app/ が orientationGuide の状態を渡す） */
  readonly isPaused?: () => boolean;
}

/**
 * 避難の画面の仮表示．VR の中の板に「避難の画面（仮）」と残り秒数を出し，
 * 決まった秒数（scenarioPlaceholderTimer.ts）たったら仮の記録（sampleDrill.ts の good）を
 * Session.drill に書いて結果画面へ進む（画面のタッチは使わない）
 */
export function createScenarioPlaceholder(options: ScenarioPlaceholderOptions = {}): Scene {
  let board: NoticeBoard | null = null;
  let debugRoot: HTMLPreElement | null = null;
  let calibrationText = "";
  let timer: PlaceholderTimer = INITIAL_PLACEHOLDER_TIMER;
  let done = false;
  let ctxRef: SceneContext | null = null;

  return {
    id: "scenario",
    enter(ctx) {
      ctxRef = ctx;
      timer = INITIAL_PLACEHOLDER_TIMER;
      done = false;
      ctx.stage.rig.position.set(0, LOBBY_EYE_HEIGHT, 0);
      ctx.stage.rig.rotation.set(0, 0, 0);
      board = createNoticeBoard();
      ctx.stage.world.add(board.object);
      if (options.debug === true) {
        debugRoot = document.createElement("pre");
        debugRoot.style.cssText =
          "position:absolute;left:8px;top:8px;max-width:45vw;max-height:90vh;overflow:hidden;margin:0;" +
          "padding:8px;pointer-events:none;white-space:pre-wrap;background:rgba(16,20,28,0.75);" +
          "color:#f2f4f8;font:11px/1.4 ui-monospace,monospace;border-radius:6px;";
        calibrationText = `Session.calibration:\n${JSON.stringify(ctx.session.calibration, null, 2)}`;
        ctx.stage.overlay.appendChild(debugRoot);
      }
    },
    update(frame) {
      const ctx = ctxRef;
      if (ctx === null || board === null || done) return;
      timer = advancePlaceholderTimer(timer, frame.dt, options.isPaused?.() === true);
      board.follow(frame.input.head, frame.dt);
      board.show({
        title: "避難の画面（仮）",
        body: "ここに避難の体験が入ります．時間がたつと結果画面へ進みます",
        caption: `残り ${placeholderRemainingSeconds(timer)} 秒`,
      });
      if (debugRoot !== null) {
        const text = `${calibrationText}\n\nPlayerInput:\n${formatPlayerInput(frame.input)}`;
        // 変わった時だけ書き換える（毎フレームの DOM の更新を避ける）
        if (debugRoot.textContent !== text) debugRoot.textContent = text;
      }
      if (isPlaceholderDone(timer)) {
        done = true;
        // 校舎データ（#p=）が無い・読めない時はデモの校舎を使う（SPEC_01「起動の切り替え」）
        ctx.session.plan ??= DEMO_SCHOOL;
        ctx.session.drill = createSampleDrill(ctx.session.plan, "good");
        ctx.goTo("debrief");
      }
    },
    exit() {
      if (board !== null) {
        ctxRef?.stage.world.remove(board.object);
        board.dispose();
      }
      board = null;
      debugRoot?.remove();
      debugRoot = null;
      ctxRef = null;
    },
  };
}
