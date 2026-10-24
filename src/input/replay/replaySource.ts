// 記録を再生して PlayerInput を作るモック入力の殻（?input=replay．開発時だけ動的に読み込む．experiment_山﨑/10「PC 用のモック入力」）．
// 記録したセンサーの値を，記録した時と同じ間隔で本物の入力と同じ判定（DeviceTracker）に流す．
// 他の担当が，実機の動きのとおりの入力で部屋やシナリオを確かめるためのもの（例: しゃがんだまま 30 秒の記録を流す）
import { IDLE_PLAYER_INPUT, type PlayerInput } from "../../core/types";
import { DeviceTracker } from "../deviceTracker";
import type { InputSource, InputSourceOptions, ReplayOptions } from "../inputSource";
import { INPUT_LOG_ENDPOINT, INPUT_LOG_ROUTES } from "../recorder/logProtocol";
import {
  parseRecordsJsonl,
  parseReplaySearch,
  type ReplayEvent,
  replayEventsOf,
  replayIndexUntil,
} from "./replayLog";

/** 記録の中身を取る．指定が無ければ開発サーバーの最も新しい記録 */
async function loadReplayText(replay: ReplayOptions): Promise<string> {
  if (replay.text !== undefined) return replay.text;
  let name = replay.log ?? null;
  if (name === null) {
    const res = await fetch(`${INPUT_LOG_ENDPOINT}${INPUT_LOG_ROUTES.list}`, { cache: "no-store" });
    const list: unknown = await res.json();
    name = Array.isArray(list) && typeof list[0] === "string" ? list[0] : null;
    if (name === null) throw new Error("logs/input/ に記録がありません");
  }
  const res = await fetch(
    `${INPUT_LOG_ENDPOINT}${INPUT_LOG_ROUTES.file}?name=${encodeURIComponent(name)}`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`記録 ${name} を読めません（${res.status}）`);
  return res.text();
}

/** 記録を再生する入力を作る（記録は非同期に読み込む．読み込むまでは止まって立っている） */
export function createReplaySource(options: InputSourceOptions): InputSource {
  const search = parseReplaySearch(typeof location === "undefined" ? "" : location.search);
  const replay: ReplayOptions = {
    log: search.log,
    fromSec: search.fromSec,
    loop: search.loop,
    ...options.replay,
  };
  const tracker = new DeviceTracker({ calibration: options.calibration, params: options.params });
  let events: ReplayEvent[] = [];
  let firstMotionT = 0;
  let index = 0;
  /** 再生の時刻 − 記録の時刻（ms）．次の read で決める時は null */
  let offset: number | null = null;
  let disposed = false;

  void loadReplayText(replay).then(
    (text) => {
      if (disposed) return;
      events = replayEventsOf(parseRecordsJsonl(text).records);
      firstMotionT = events.find((e) => e.kind === "motion")?.t ?? events[0]?.t ?? 0;
    },
    (err: unknown) => {
      // 開発時だけの入力のため，原因を開発者のコンソールに出す（止まって立ったままになる）
      console.warn(`[input=replay] 記録を読み込めません: ${String(err)}`);
    },
  );

  function feed(e: ReplayEvent, shift: number): void {
    if (e.kind === "visibility") tracker.reset();
    else if (e.kind === "motion") tracker.onMotion({ ...e.sample, t: e.t + shift });
    else if (e.kind === "orientation") tracker.onOrientation({ ...e.sample, t: e.t + shift });
    else tracker.onScreen({ ...e.sample, t: e.t + shift });
  }

  function read(now: number): PlayerInput {
    if (events.length === 0) return { ...IDLE_PLAYER_INPUT, time: now };
    if (offset === null) {
      const startT = firstMotionT + (replay.fromSec ?? 0) * 1000;
      offset = now - startT;
      // 始める時刻より前の出来事は飛ばす（頭の向きだけは直前の値から始めたいので，直前の向き・画面は流す）
      index = replayIndexUntil(events, 0, startT);
      for (let i = index - 1; i >= 0; i--) {
        const e = events[i];
        if (e.kind === "orientation" || e.kind === "screen") {
          feed(e, offset);
          break;
        }
      }
    }
    const next = replayIndexUntil(events, index, now - offset);
    for (let i = index; i < next; i++) feed(events[i], offset);
    index = next;
    const input = tracker.read(now);
    if (index >= events.length && replay.loop !== false) {
      // 最初に戻る．間隔が飛ぶので体の判定は初期化する（姿勢は保つ）
      tracker.reset();
      offset = null;
    }
    return input;
  }

  return {
    kind: "replay",
    tracker,
    read,
    activate: () => Promise.resolve({ motion: "not-required", orientation: "not-required" }),
    recenter: () => tracker.recenter(),
    attachCamera: () => undefined,
    dispose: () => {
      disposed = true;
      events = [];
    },
  };
}
