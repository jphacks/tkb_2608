// ロビー（lobby，VR 表示）．簡単な部屋で開始ボタンを待ち，押されたら見え方の調整（二眼の像が重なるよう
// ゴーグル側で合わせる．一定時間で次へ）の後に指示を出して
// 正面 → 立つ → しゃがむ → 足踏み の順に基準を取り，CalibrationProfile を Session.calibration に書いてシナリオへ進む．
// ゴーグル装着中なので画面のタッチは使わない（各手順は制限時間で既定値に進むため詰まらない）．
// 開始は今は一定時間で自動（ゴーグルを付ける時間）．input/ の手が揃ったら
// DEFAULT_START_GATE_CONFIG.startMode を "hand" にして，手で開始ボタンに触れて始める方法に切り替える（startGate.ts）．
// debug が有効な時だけ，注視での開始と Enter / Space による飛ばしを使える（デバッグ用）

import type { FrameInfo, Scene, SceneContext } from "../core/scene";
import {
  advanceCalibration,
  type CalibrationConfig,
  type CalibrationState,
  DEFAULT_CALIBRATION_CONFIG,
  isCalibrationFinished,
  type OrientationSample,
  skipCalibrationStep,
  startCalibration,
  toCalibrationProfile,
} from "./calibration";
import {
  type AlignmentMarker,
  createAlignmentMarker,
  createLobbyPanel,
  createLobbyRoom,
  createStartButton,
  LOBBY_EYE_HEIGHT,
  type LobbyPanel,
  type StartButtonView,
} from "./lobbyRoom";
import { describeCalibration, describeStartGate, type LobbyInstruction } from "./lobbyScript";
import { narrate, stopNarration } from "./narrator";
import { angleDifference, yawOfQuat } from "./orientation";
import { createSensorFeed, type SensorFeed } from "./sensorFeed";
import {
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

export interface LobbySceneOptions {
  readonly config?: CalibrationConfig;
  readonly startGateConfig?: StartGateConfig;
  /**
   * デバッグ用の切り替え．true の時だけ，開始ボタンの注視での開始と，
   * Enter / Space による開始ボタン・手順の飛ばしを使える（本実装の開始は input/ の PlayerInput.hands の手だけ）
   */
  readonly debug?: boolean;
}

/** 指示の板が頭の向きに追いつく速さ（1/秒） */
const PANEL_FOLLOW_RATE = 2;

/** enter で作り，exit で片付けるもの */
interface Active {
  readonly ctx: SceneContext;
  readonly panel: LobbyPanel;
  readonly button: StartButtonView;
  readonly marker: AlignmentMarker;
  readonly feed: SensorFeed;
  readonly dispose: () => void;
  gate: StartGateState;
  state: CalibrationState;
  /** 最後に届いた向きのサンプル（端末が水平かの判定用．センサーが無ければ null） */
  lastOrientation: OrientationSample | null;
  lastNarrationKey: string;
  skipRequested: boolean;
  done: boolean;
}

export function createLobbyScene(options: LobbySceneOptions = {}): Scene {
  const config = options.config ?? DEFAULT_CALIBRATION_CONFIG;
  const gateConfig = options.startGateConfig ?? DEFAULT_START_GATE_CONFIG;
  const debug = options.debug ?? false;
  // 注視はデバッグ用．本実装は input/ の PlayerInput.hands（手と自動開始は gateConfig.startMode で決まる）
  const sources: StartGateSources = { gaze: debug };
  let active: Active | null = null;

  const show = (a: Active, instruction: LobbyInstruction): void => {
    const caption = [
      instruction.progressLabel,
      instruction.remainingSeconds === null ? null : `残り ${instruction.remainingSeconds} 秒`,
    ]
      .filter((s) => s !== null)
      .join("　");
    a.panel.show({ title: instruction.title, body: instruction.body, caption });
    if (instruction.key !== a.lastNarrationKey) {
      a.lastNarrationKey = instruction.key;
      if (instruction.narration !== null) narrate(instruction.narration);
    }
  };

  /** 板（と開始ボタン）を頭のヨー角にゆっくり合わせる（どちらを向いていても見える） */
  const followHead = (a: Active, frame: FrameInfo): void => {
    const target = yawOfQuat(frame.input.head);
    const current = a.panel.object.rotation.y;
    const rate = Math.min(1, frame.dt * PANEL_FOLLOW_RATE);
    a.panel.object.rotation.y = current + angleDifference(current, target) * rate;
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
      a.gate = skipStartGate(a.gate);
    }
    a.button.setProgress(startGateProgress(a.gate, gateConfig));
    if (a.gate.startedBy === null) {
      show(
        a,
        describeStartGate(
          a.state.reused,
          autoStartRemainingSeconds(a.gate, gateConfig),
          sources.gaze,
        ),
      );
      return false;
    }
    a.button.object.visible = false;
    return true;
  };

  return {
    id: "lobby",

    enter(ctx) {
      const room = createLobbyRoom();
      const panel = createLobbyPanel();
      const button = createStartButton(gateConfig.buttonOffset);
      panel.object.add(button.object);
      const marker = createAlignmentMarker();
      marker.object.visible = false;
      ctx.stage.rig.add(marker.object);
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
        marker,
        feed,
        gate: INITIAL_START_GATE,
        state: startCalibration(ctx.session.calibration),
        lastOrientation: null,
        lastNarrationKey: "",
        skipRequested: false,
        done: false,
        dispose: () => {
          window.removeEventListener("keydown", onKeyDown);
          feed.dispose();
          ctx.stage.world.remove(room.root, panel.object);
          room.dispose();
          panel.dispose();
          button.dispose();
          ctx.stage.rig.remove(marker.object);
          marker.dispose();
        },
      };
    },

    update(frame) {
      const a = active;
      if (a === null || a.done) return;
      const samples = a.feed.drain();
      followHead(a, frame);
      // 開始ボタンが押されるまでキャリブレーションを始めない（制限時間も数えない．サンプルは捨てる）
      if (a.gate.startedBy === null) {
        updateGate(a, frame, samples.orientation);
        return;
      }
      a.state = advanceCalibration(
        a.state,
        { dt: frame.dt, motion: samples.motion, orientation: samples.orientation },
        config,
      );
      if (a.skipRequested) {
        a.skipRequested = false;
        a.state = skipCalibrationStep(a.state, config);
      }
      // 見え方の調整の間だけ，視野の中心（左右それぞれの目の画面の中心）に十字を出す
      a.marker.object.visible = a.state.phase === "align";
      const h = frame.input.head;
      a.marker.object.quaternion.set(h.x, h.y, h.z, h.w);
      show(a, describeCalibration(a.state, config));
      if (isCalibrationFinished(a.state)) {
        a.done = true;
        a.ctx.session.calibration = toCalibrationProfile(a.state, Date.now());
        a.ctx.goTo("scenario");
      }
    },

    exit() {
      stopNarration();
      active?.dispose();
      active = null;
    },
  };
}
