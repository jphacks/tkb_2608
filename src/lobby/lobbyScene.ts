// ロビー（lobby，VR 表示）．学校の防災学習室で開始ボタンを待ち，手のひらを 1 秒かざしたら（startGate.ts の
// startMode: "hand"）見え方の調整（二眼の像が重なるようゴーグル側で合わせる．開始ボタンと同じ部品・同じ判定の
// ボタン（十字の下）に手のひらを 1 秒かざして次へ．startMode が "auto" の時は一定時間で次へ）の後に指示を出して
// 正面 → 立つ → しゃがむ → しゃがみ歩き → 足踏み の順に行い（体験者には「練習」として見せる．各手順は
// 指示の読み上げ → 3 秒の準備（3・2・1）→ 計測），正面（yawOffset）と各手順の区間（segments．
// 値の計算は input/ が行う）を CalibrationProfile として Session.calibration に書く．
// 続けて訓練の説明（今日の訓練の内容と避難の注意．drillBriefing.ts）を時間で進めてからシナリオへ進む．
// ゴーグル装着中なので画面のタッチは使わない（各手順は制限時間で既定値に進むため詰まらない）．
// 開始ボタン・見え方の調整のボタンを待つ間に手がしばらく見つからなければ，手を目の前に出すよう案内する
// （自動では進まない．handPrompt.ts）．
// debug が有効な時だけ，注視での開始と Enter / Space による飛ばしを使える（デバッグ用．見え方の調整のボタンも同じ）

import type { Object3D } from "three";
import type { FrameInfo, Scene, SceneContext } from "../core/scene";
import type { Handedness, HandState, Quat } from "../core/types";
import {
  advanceCalibration,
  type CalibrationConfig,
  type CalibrationState,
  DEFAULT_CALIBRATION_CONFIG,
  finishAlignment,
  isCalibrationFinished,
  type OrientationSample,
  prepSignal,
  restartCalibrationStep,
  skipCalibrationStep,
  startCalibration,
  toCalibrationProfile,
} from "./calibration";
import {
  advanceBriefing,
  type BriefingConfig,
  type BriefingState,
  DEFAULT_BRIEFING_CONFIG,
  describeBriefing,
  isBriefingFinished,
  restartBriefingPage,
  skipBriefingPage,
  startBriefing,
} from "./drillBriefing";
import {
  advanceHandSearch,
  DEFAULT_HAND_PROMPT_CONFIG,
  type HandPromptConfig,
  type HandSearchState,
  handPromptIndex,
  INITIAL_HAND_SEARCH,
  isAnyHandTracked,
} from "./handPrompt";
import {
  type AlignmentMarker,
  createAlignmentMarker,
  createLobbyPanel,
  createLobbyRoom,
  createStartButton,
  LOBBY_EYE_HEIGHT,
  LOBBY_PANEL_CENTER,
  type LobbyPanel,
  type StartButtonView,
} from "./lobbyRoom";
import {
  type AlignButtonPrompt,
  describeCalibration,
  describeStartGate,
  type LobbyInstruction,
} from "./lobbyScript";
import {
  advanceNarrationTrack,
  DEFAULT_NARRATION_PACING_CONFIG,
  isNarrationSettled,
  markNarrationEnded,
  type NarrationPacingConfig,
  type NarrationTrack,
  pacedCalibrationDt,
  SILENT_NARRATION,
  startNarrationTrack,
} from "./narrationPacing";
import { NARRATION_RATE, narrate, stopNarration } from "./narrator";
import { angleDifference, yawOfQuat } from "./orientation";
import { approachHighlight, isGazingAtPanel } from "./panelGaze";
import { createPrepCueSound } from "./prepCueSound";
import { createSensorFeed, type SensorFeed } from "./sensorFeed";
import {
  ALIGN_BUTTON_ARM_SECONDS,
  ALIGN_BUTTON_OFFSET,
  advanceStartGate,
  autoStartRemainingSeconds,
  DEFAULT_START_GATE_CONFIG,
  INITIAL_START_GATE,
  isDeviceLevel,
  type StartGateConfig,
  type StartGateSources,
  type StartGateState,
  skipStartGate,
  startGateProgress,
} from "./startGate";

/** 指示の板に出している内容と，開始ボタン・見え方の調整の十字を出しているか（見守り画面へ送るため） */
export interface LobbyPanelView {
  readonly title: string;
  readonly body: string;
  /** 右上の補足（無ければ空の文字列） */
  readonly caption: string;
  /** 開始ボタンを出しているか */
  readonly startButton: boolean;
  /** 見え方の調整の十字を出しているか */
  readonly alignMarker: boolean;
}

/**
 * 手の印（開始ボタンへ手を合わせやすくするため）．実体は校舎と共通の部品（scenes/common/handMarkers.ts）で，
 * 画面を持つモジュール同士は import しないため app/ が作る関数を渡す（形はその HandMarkers と同じ）
 */
export interface LobbyHandMarkers {
  /** rig に足す（目の位置が原点） */
  readonly object: Object3D;
  /**
   * 認識している手の位置に印を出す（hands の position は頭の座標系）．visible が false なら隠す．
   * dt（前のフレームからの秒数）は手の形の補間・見失った時のフェードに使う
   */
  update(
    head: Quat,
    hands: Readonly<Record<Handedness, HandState>>,
    visible: boolean,
    dt?: number,
  ): void;
  dispose(): void;
}

export interface LobbySceneOptions {
  /** 手の印を作る（app/ が scenes/common/handMarkers.ts の createHandMarkers を渡す）．enter のたびに 1 回呼ぶ */
  readonly createHandMarkers: () => LobbyHandMarkers;
  readonly config?: CalibrationConfig;
  readonly startGateConfig?: StartGateConfig;
  readonly handPromptConfig?: HandPromptConfig;
  readonly briefingConfig?: BriefingConfig;
  readonly narrationPacingConfig?: NarrationPacingConfig;
  /**
   * デバッグ用の切り替え．true の時だけ，開始ボタンの注視での開始と，
   * Enter / Space による開始ボタン・手順の飛ばしを使える（本実装の開始は input/ の PlayerInput.hands の手だけ）
   */
  readonly debug?: boolean;
  /**
   * true の間は時間を止める（開始ボタンの自動開始・各手順の制限時間を数えず，センサーの値も捨てる）．
   * 縦向きの案内を出している間はゴーグルに入っておらず，指示も見えないため（app/ が orientationGuide の状態を渡す）
   */
  readonly isPaused?: () => boolean;
  /**
   * 指示の板の内容・開始ボタン・十字の表示が変わった時に呼ぶ（省略可．app/ が見守りの中継へ送る）．
   * 読み取るだけで，ロビーの進み方には影響しない
   */
  readonly onPanelView?: (view: LobbyPanelView) => void;
  /**
   * 指示の文を読み上げ始めた時に，その文と速さ（SpeechSynthesisUtterance.rate）を渡して呼ぶ（省略可．app/ が見守りの中継へ送る）．
   * 読み上げを始められなかった時は呼ばない．読み取るだけで，ロビーの進み方には影響しない
   */
  readonly onNarrate?: (text: string, rate: number) => void;
  /**
   * 準備の合図（3・2・1 と計測の始まり）の短い音を鳴らす AudioContext（省略可．無い・null の時は音を出さず，指示板の数字だけ）
   */
  readonly audioContext?: () => AudioContext | null;
}

/** 指示の板が頭の向きに追いつく速さ（1/秒）．見回した時に一瞬遅れて追いつく様子が分かるよう緩めにする */
const PANEL_FOLLOW_RATE = 1.2;

/** enter で作り，exit で片付けるもの */
interface Active {
  readonly ctx: SceneContext;
  readonly panel: LobbyPanel;
  readonly button: StartButtonView;
  /** 見え方の調整を終えるボタン（開始ボタンと同じ部品．startMode が "hand" の時だけ出す） */
  readonly alignButton: StartButtonView;
  readonly marker: AlignmentMarker;
  readonly handMarkers: LobbyHandMarkers;
  readonly feed: SensorFeed;
  readonly dispose: () => void;
  gate: StartGateState;
  /** 見え方の調整を終えるボタンの判定（開始ボタンと同じ判定．startMode が "hand" の時だけ進める） */
  alignGate: StartGateState;
  /** 見え方の調整に入ってからの秒数（ALIGN_BUTTON_ARM_SECONDS で頭打ち．ボタンを出すまでの待ち） */
  alignWaited: number;
  state: CalibrationState;
  /** 開始ボタン・見え方の調整のボタンを待つ間に，手が見つからない時間 */
  handSearch: HandSearchState;
  /** 訓練の説明．キャリブレーションを終えるまでは null */
  briefing: BriefingState | null;
  /** 最後に届いた向きのサンプル（端末が水平かの判定用．センサーが無ければ null） */
  lastOrientation: OrientationSample | null;
  lastNarrationKey: string;
  /** 今の読み上げ（時間で進む段階はこれが済むまで待つ．narrationPacing.ts） */
  narration: NarrationTrack;
  /** 読み上げの番号（end の知らせが今の読み上げのものかを見分ける） */
  narrationCount: number;
  /** 指示の板の枠の明るさ（0〜1） */
  highlight: number;
  skipRequested: boolean;
  /** 最後に onPanelView へ渡した内容（変わった時だけ呼ぶため） */
  lastPanelView: string;
  /** 直前のフレームで止めていたか（再開した時に今の手順をやり直すため） */
  wasPaused: boolean;
  done: boolean;
}

export function createLobbyScene(options: LobbySceneOptions): Scene {
  const config = options.config ?? DEFAULT_CALIBRATION_CONFIG;
  const gateConfig = options.startGateConfig ?? DEFAULT_START_GATE_CONFIG;
  const handPromptConfig = options.handPromptConfig ?? DEFAULT_HAND_PROMPT_CONFIG;
  const briefingConfig = options.briefingConfig ?? DEFAULT_BRIEFING_CONFIG;
  const pacingConfig = options.narrationPacingConfig ?? DEFAULT_NARRATION_PACING_CONFIG;
  const debug = options.debug ?? false;
  // 注視はデバッグ用．本実装は input/ の PlayerInput.hands（手と自動開始は gateConfig.startMode で決まる）
  const sources: StartGateSources = { gaze: debug };
  // 見え方の調整も，開始ボタンを手で押す設定の時は時間ではなくボタンで終える（制限時間は無い．開始ボタンと同じ）
  const alignByButton = gateConfig.startMode === "hand";
  // 開始ボタンと同じ判定を，ボタンの位置だけ十字の下に差し替えて使う
  const alignGateConfig: StartGateConfig = { ...gateConfig, buttonOffset: ALIGN_BUTTON_OFFSET };
  const prepCue = createPrepCueSound(options.audioContext ?? (() => null));
  let active: Active | null = null;

  const show = (a: Active, instruction: LobbyInstruction): void => {
    const hold = instruction.holdSeconds ?? null;
    const caption = [
      instruction.progressLabel,
      instruction.remainingSeconds === null ? null : `残り ${instruction.remainingSeconds} 秒`,
      hold === null ? null : `そのまま あと ${hold} 秒`,
    ]
      .filter((s) => s !== null)
      .join("　");
    const countdown = instruction.countdown ?? null;
    a.panel.show({ title: instruction.title, body: instruction.body, caption, countdown });
    if (options.onPanelView) {
      const startButton = a.gate.startedBy === null;
      // 見え方の調整のボタンは見守り画面に送らない（見守り画面は開始ボタンの位置にしかボタンを描けないため）
      const alignMarker = !startButton && a.briefing === null && a.state.phase === "align";
      // 見守りの画面には板の真ん中の数字を描けないため，前と同じく本文の後ろに付けて送る
      const body = countdown === null ? instruction.body : `${instruction.body}\n\n${countdown}`;
      const signature = `${instruction.title}\n${body}\n${caption}\n${startButton}\n${alignMarker}`;
      if (signature !== a.lastPanelView) {
        a.lastPanelView = signature;
        options.onPanelView({
          title: instruction.title,
          body,
          caption,
          startButton,
          alignMarker,
        });
      }
    }
    if (instruction.key !== a.lastNarrationKey) {
      a.lastNarrationKey = instruction.key;
      a.narrationCount += 1;
      const id = a.narrationCount;
      // 前の読み上げの end（narrate の中で止めた時の error を含む）は id が違うため無視される
      const spoken =
        instruction.narration !== null &&
        narrate(instruction.narration, () => {
          if (active === a) a.narration = markNarrationEnded(a.narration, id);
        });
      if (spoken && instruction.narration !== null) {
        options.onNarrate?.(instruction.narration, NARRATION_RATE);
      }
      a.narration = startNarrationTrack(id, instruction.narration, spoken, pacingConfig);
    }
  };

  /** 板（と開始ボタン）を頭のヨー角にゆっくり合わせる（どちらを向いていても見える） */
  const followHead = (a: Active, frame: FrameInfo): void => {
    const target = yawOfQuat(frame.input.head);
    const current = a.panel.object.rotation.y;
    const rate = Math.min(1, frame.dt * PANEL_FOLLOW_RATE);
    a.panel.object.rotation.y = current + angleDifference(current, target) * rate;
    // 板を正面に捉えている時だけ枠を明るくする（視線に反応していることが分かる控えめな演出）
    const gazing = isGazingAtPanel(frame.input.head, a.panel.object.rotation.y, LOBBY_PANEL_CENTER);
    a.highlight = approachHighlight(a.highlight, gazing, frame.dt);
    a.panel.setHighlight(a.highlight);
  };

  /** 開始ボタンを待つ．開始したら true */
  const updateGate = (a: Active, frame: FrameInfo, orientation: OrientationSample[]): boolean => {
    a.lastOrientation = orientation[orientation.length - 1] ?? a.lastOrientation;
    a.gate = advanceStartGate(
      a.gate,
      {
        dt: frame.dt,
        sources,
        head: frame.input.head,
        hands: frame.input.hands,
        buttonYaw: a.panel.object.rotation.y,
        deviceLevel:
          a.lastOrientation === null ? null : isDeviceLevel(a.lastOrientation, gateConfig),
      },
      gateConfig,
    );
    if (a.skipRequested) {
      a.skipRequested = false;
      stopNarration();
      a.gate = skipStartGate(a.gate);
    }
    a.button.setProgress(startGateProgress(a.gate, gateConfig));
    // 手が見つからない時の案内は，手で始める時だけ（自動開始の時は手を使わない）
    a.handSearch = advanceHandSearch(a.handSearch, frame.dt, isAnyHandTracked(frame.input.hands));
    const handPrompt =
      gateConfig.startMode === "hand" ? handPromptIndex(a.handSearch, handPromptConfig) : null;
    if (a.gate.startedBy === null) {
      a.handMarkers.update(frame.input.head, frame.input.hands, true, frame.dt);
      show(
        a,
        describeStartGate(
          a.state.reused,
          autoStartRemainingSeconds(a.gate, gateConfig),
          sources.gaze,
          handPrompt,
        ),
      );
      return false;
    }
    a.button.object.visible = false;
    a.handMarkers.update(frame.input.head, frame.input.hands, false, frame.dt);
    // 見え方の調整のボタンを待つ間の案内は数え直す
    a.handSearch = INITIAL_HAND_SEARCH;
    return true;
  };

  /**
   * 見え方の調整を終えるボタンを待つ（startMode が "hand" の時）．押したら true．
   * 開始ボタンと同じ判定・手の印・手が見つからない時の案内を使う．かざしっぱなしの手ですぐ押されないよう，
   * ALIGN_BUTTON_ARM_SECONDS たつまでボタンを出さず，判定も手の案内も数えない
   */
  const updateAlignGate = (
    a: Active,
    frame: FrameInfo,
    orientation: OrientationSample[],
  ): boolean => {
    a.lastOrientation = orientation[orientation.length - 1] ?? a.lastOrientation;
    const dt = Number.isFinite(frame.dt) && frame.dt > 0 ? frame.dt : 0;
    const armed = a.alignWaited >= ALIGN_BUTTON_ARM_SECONDS;
    if (armed) {
      a.alignGate = advanceStartGate(
        a.alignGate,
        {
          dt,
          sources,
          head: frame.input.head,
          hands: frame.input.hands,
          buttonYaw: a.panel.object.rotation.y,
          deviceLevel:
            a.lastOrientation === null ? null : isDeviceLevel(a.lastOrientation, alignGateConfig),
        },
        alignGateConfig,
      );
      a.handSearch = advanceHandSearch(a.handSearch, dt, isAnyHandTracked(frame.input.hands));
    } else {
      a.alignWaited = Math.min(ALIGN_BUTTON_ARM_SECONDS, a.alignWaited + dt);
    }
    if (a.skipRequested) {
      a.skipRequested = false;
      stopNarration();
      a.alignGate = skipStartGate(a.alignGate);
    }
    const pressed = a.alignGate.startedBy !== null;
    a.alignButton.object.visible = armed && !pressed;
    a.alignButton.setProgress(startGateProgress(a.alignGate, alignGateConfig));
    a.handMarkers.update(frame.input.head, frame.input.hands, !pressed, frame.dt);
    return pressed;
  };

  /** 訓練の説明を進める．終えたらシナリオへ */
  const updateBriefing = (a: Active, briefing: BriefingState, frame: FrameInfo): void => {
    let next = advanceBriefing(briefing, frame.dt, briefingConfig, isNarrationSettled(a.narration));
    if (a.skipRequested) {
      a.skipRequested = false;
      stopNarration();
      next = skipBriefingPage(next);
    }
    a.briefing = next;
    if (isBriefingFinished(next)) {
      a.done = true;
      a.ctx.goTo("scenario");
      return;
    }
    show(a, describeBriefing(next, a.ctx.session.plan, briefingConfig));
  };

  return {
    id: "lobby",

    enter(ctx) {
      const room = createLobbyRoom();
      const panel = createLobbyPanel();
      const button = createStartButton(gateConfig.buttonOffset);
      panel.object.add(button.object);
      const alignButton = createStartButton(alignGateConfig.buttonOffset);
      alignButton.object.visible = false;
      panel.object.add(alignButton.object);
      const marker = createAlignmentMarker();
      marker.object.visible = false;
      ctx.stage.rig.add(marker.object);
      const handMarkers = options.createHandMarkers();
      ctx.stage.rig.add(handMarkers.object);
      const feed = createSensorFeed();
      ctx.stage.world.add(room.root, panel.object);
      ctx.stage.rig.position.set(0, LOBBY_EYE_HEIGHT, 0);
      ctx.stage.rig.rotation.set(0, 0, 0);

      // デバッグ用（本実装は input/ の PlayerInput.hands）
      const onKeyDown = (event: KeyboardEvent): void => {
        if ((event.key === "Enter" || event.key === " ") && active !== null) {
          active.skipRequested = true;
        }
      };
      if (debug) window.addEventListener("keydown", onKeyDown);

      active = {
        ctx,
        panel,
        button,
        alignButton,
        marker,
        handMarkers,
        feed,
        gate: INITIAL_START_GATE,
        alignGate: INITIAL_START_GATE,
        alignWaited: 0,
        state: startCalibration(ctx.session.calibration),
        handSearch: INITIAL_HAND_SEARCH,
        briefing: null,
        lastOrientation: null,
        lastNarrationKey: "",
        narration: SILENT_NARRATION,
        narrationCount: 0,
        highlight: 0,
        lastPanelView: "",
        skipRequested: false,
        wasPaused: false,
        done: false,
        dispose: () => {
          window.removeEventListener("keydown", onKeyDown);
          feed.dispose();
          ctx.stage.world.remove(room.root, panel.object);
          room.dispose();
          panel.dispose();
          button.dispose();
          alignButton.dispose();
          ctx.stage.rig.remove(marker.object);
          marker.dispose();
          ctx.stage.rig.remove(handMarkers.object);
          handMarkers.dispose();
        },
      };
    },

    update(frame) {
      const a = active;
      if (a === null || a.done) return;
      const samples = a.feed.drain();
      followHead(a, frame);
      // 止めている間に届いたサンプルは，ゴーグルに入っていない時の値なので基準に混ぜない
      if (options.isPaused?.() === true) {
        a.wasPaused = true;
        return;
      }
      // 区間の時刻は input/ のセンサーのサンプルと同じ時計（performance.now() の ms）で記録する
      const nowMs = performance.now();
      if (a.wasPaused) {
        a.wasPaused = false;
        // 手順の途中で止めた時は，止める前後の値が区間に混ざらないよう，その手順を最初からやり直す（指示を読み直し，準備から）
        if (a.gate.startedBy !== null && a.state.phase === "step") {
          a.state = restartCalibrationStep(a.state, nowMs);
          a.lastNarrationKey = "";
          // 読み直しをこのフレームで始め，前の（済んだ）読み上げのまま準備を数え始めないようにする
          show(a, describeCalibration(a.state, config));
        }
        // 説明の途中で止めた時も，聞けていないためそのページを最初から読み直す
        if (a.briefing !== null) {
          a.briefing = restartBriefingPage(a.briefing);
          a.lastNarrationKey = "";
        }
      }
      // 読み上げの経過は止めていない間だけ数える（上限の時間で必ず進むため）
      a.narration = advanceNarrationTrack(a.narration, frame.dt);
      // 開始ボタンが押されるまでキャリブレーションを始めない（制限時間も数えない．サンプルは捨てる）
      if (a.gate.startedBy === null) {
        updateGate(a, frame, samples.orientation);
        return;
      }
      if (a.briefing !== null) {
        updateBriefing(a, a.briefing, frame);
        return;
      }
      // 見え方の調整をボタンで終える時は，押されるまで時間で進めない（制限時間は無い）
      if (alignByButton && a.state.phase === "align") {
        const pressed = updateAlignGate(a, frame, samples.orientation);
        if (!pressed) {
          a.marker.object.visible = true;
          const h = frame.input.head;
          a.marker.object.quaternion.set(h.x, h.y, h.z, h.w);
          const prompt: AlignButtonPrompt = {
            gazeEnabled: sources.gaze,
            handPrompt:
              a.alignWaited >= ALIGN_BUTTON_ARM_SECONDS
                ? handPromptIndex(a.handSearch, handPromptConfig)
                : null,
          };
          show(a, describeCalibration(a.state, config, prompt));
          return;
        }
        // 押したフレームから導入へ進める（下の時間で進む処理に続ける）
        a.state = finishAlignment(a.state);
      }
      // 読み上げが済むまで，時間で進む段階は次へ進めず，測る手順は準備も制限時間も数えない（準備の間のサンプルは捨てる）
      const dt = pacedCalibrationDt(a.state, frame.dt, isNarrationSettled(a.narration), config);
      const before = a.state;
      a.state = advanceCalibration(
        a.state,
        { dt, nowMs, motion: samples.motion, orientation: samples.orientation },
        config,
      );
      if (a.skipRequested) {
        a.skipRequested = false;
        stopNarration();
        a.state = skipCalibrationStep(a.state, config);
      }
      const signal = prepSignal(before, a.state, config);
      if (signal !== null) prepCue.play(signal);
      // 見え方の調整の間だけ，視野の中心（左右それぞれの目の画面の中心）に十字を出す
      a.marker.object.visible = a.state.phase === "align";
      const h = frame.input.head;
      a.marker.object.quaternion.set(h.x, h.y, h.z, h.w);
      show(a, describeCalibration(a.state, config));
      if (isCalibrationFinished(a.state)) {
        // 値は説明の前に書く（app/ が入力に渡して正面を合わせるため，説明の間に正面が定まる）
        a.ctx.session.calibration = toCalibrationProfile(a.state, Date.now());
        a.marker.object.visible = false;
        a.briefing = startBriefing(a.state.reused);
        show(a, describeBriefing(a.briefing, a.ctx.session.plan, briefingConfig));
      }
    },

    exit() {
      stopNarration();
      active?.dispose();
      active = null;
    },
  };
}
