// 片手の状態を認識の結果ごとに進め，描画のフレームごとに読む（experiment_山﨑/07）．DOM に触れない．
// 認識の結果が届いた時だけ observeHand でフィルタ・形・認識の有無を進め，readHandTrack は外挿して今の位置を返す
import type { HandState, Vec3 } from "../../core/types";
import type { HandParams } from "./handParams";
import {
  type ConfirmState,
  computeHandShape,
  gripOutput,
  INITIAL_CONFIRM,
  nextConfirmed,
  nextGripped,
  nextPinching,
  palmCenter,
  pinchAmount,
} from "./handShape";
import {
  createOneEuroVec3,
  extrapolateVec3,
  type OneEuroParams,
  type OneEuroVec3,
  stepOneEuroVec3,
} from "./oneEuro";
import { type CameraModel, estimateDepth, focalLengthPx, imageToHead } from "./projection";
import {
  HAND_LANDMARK_COUNT,
  type HandObservation,
  type HandReading,
  type Landmark,
  LM,
} from "./types";

/** 片手の追跡の状態（observeHand・resetHandTrack が書き換える） */
export interface HandTrack {
  tracked: boolean;
  /** 続けて認識した回数（見失ったら 0） */
  seenStreak: number;
  /** 最後に認識できた映像の時刻（ms）．まだなら -Infinity */
  lastSeenT: number;
  /** 手のひらの中心・人差し指の先のフィルタ（頭の座標系．m） */
  palm: OneEuroVec3 | null;
  tip: OneEuroVec3 | null;
  /** 21 点の手のひらの中心（フィルタ前）からのずれのフィルタ（頭の座標系．m．手の形を描く用．Issue #160） */
  shape: OneEuroVec3[] | null;
  gripRaw: number;
  gripped: boolean;
  pinchRatio: number;
  pinching: boolean;
  pointing: ConfirmState;
  /** 最後に見積もった奥行き（m．dev ページの表示用） */
  depth: number;
}

export function createHandTrack(): HandTrack {
  return {
    tracked: false,
    seenStreak: 0,
    lastSeenT: Number.NEGATIVE_INFINITY,
    palm: null,
    tip: null,
    shape: null,
    gripRaw: 0,
    gripped: false,
    pinchRatio: Number.POSITIVE_INFINITY,
    pinching: false,
    pointing: INITIAL_CONFIRM,
    depth: Number.NaN,
  };
}

/** 見失った扱いにする（形の状態も戻す．位置は直前の値を残す） */
export function resetHandTrack(track: HandTrack): void {
  track.tracked = false;
  track.seenStreak = 0;
  track.gripped = false;
  track.gripRaw = 0;
  track.pinching = false;
  track.pinchRatio = Number.POSITIVE_INFINITY;
  track.pointing = INITIAL_CONFIRM;
}

/** 見失ってから tracked を外すまでの時間（ms）．握っている間は長く待つ（しゃがんで握ると画角から外れやすい） */
export function lostTimeoutMs(track: HandTrack, params: HandParams): number {
  return track.gripped ? Math.max(params.gripHoldMs, params.trackLostMs) : params.trackLostMs;
}

/**
 * 認識が止まった時（カメラが止まった等）に読む側で見失ったとみなすまでの余裕（ms）．
 * 結果は映像より遅れて届くため，observeHand の判定より長く待つ
 */
const READ_TIMEOUT_MARGIN_MS = 500;

function oneEuroParams(p: HandParams): OneEuroParams {
  return { minCutoffHz: p.oneEuroMinCutoffHz, beta: p.oneEuroBeta, dCutoffHz: p.oneEuroDCutoffHz };
}

export function cameraModelOf(params: HandParams, width: number, height: number): CameraModel {
  return {
    hfovDeg: params.cameraHfovDeg,
    width,
    height,
    offset: { x: params.cameraOffsetXM, y: params.cameraOffsetYM, z: params.cameraOffsetZM },
  };
}

/**
 * 画像の上の 1 点を頭の座標系に直す．奥行きは手のひらの奥行き depth に，MediaPipe の相対の z（x と同じ縮尺）の
 * 手のひらの中心 center との差を足す（[minDepthM, maxDepthM] に収める）．求められなければ null
 */
function landmarkToHead(
  p: Landmark,
  center: Landmark,
  depth: number,
  f: number,
  cam: CameraModel,
  params: HandParams,
): Vec3 | null {
  const d = Math.min(
    Math.max(depth + ((p.z - center.z) * cam.width * depth) / f, params.minDepthM),
    params.maxDepthM,
  );
  return imageToHead(p, Number.isFinite(d) ? d : depth, cam);
}

/**
 * 頭の座標系の手のひらの中心・人差し指の先・21 点．求められなければ null
 * （21 点のどれか 1 つでも求められない時も null．形の崩れた手を描かないため）
 */
export function handPositions(
  obs: HandObservation,
  cam: CameraModel,
  params: HandParams,
): { palm: Vec3; tip: Vec3; landmarks: Vec3[]; depth: number } | null {
  const lm = obs.landmarks;
  if (lm.length < HAND_LANDMARK_COUNT) return null;
  const depth = estimateDepth(lm, cam, params.palmLengthM, params.minDepthM, params.maxDepthM);
  if (!Number.isFinite(depth)) return null;
  const center = palmCenter(lm);
  const palm = imageToHead(center, depth, cam);
  if (palm === null) return null;
  const f = focalLengthPx(cam);
  const landmarks: Vec3[] = [];
  for (let i = 0; i < HAND_LANDMARK_COUNT; i++) {
    const v = landmarkToHead(lm[i], center, depth, f, cam, params);
    if (v === null) return null;
    landmarks.push(v);
  }
  return { palm, tip: landmarks[LM.INDEX_TIP], landmarks, depth };
}

/** 21 点の手のひらの中心からのずれ（頭の座標系．m） */
function offsetsFromPalm(landmarks: readonly Vec3[], palm: Vec3): Vec3[] {
  return landmarks.map((p) => ({ x: p.x - palm.x, y: p.y - palm.y, z: p.z - palm.z }));
}

/**
 * 1 回の認識の結果で片手の状態を進める．obs が null ならこの回は見えなかった．
 * t は映像の時刻（ms），width・height は認識した画像の大きさ（px）
 */
export function observeHand(
  track: HandTrack,
  obs: HandObservation | null,
  t: number,
  width: number,
  height: number,
  params: HandParams,
): void {
  if (!Number.isFinite(t)) return;
  const cam = cameraModelOf(params, width, height);
  const shape = obs === null ? null : computeHandShape(obs.landmarks, width / height, params);
  const pos = obs === null || shape === null ? null : handPositions(obs, cam, params);
  if (shape === null || pos === null) {
    track.seenStreak = 0;
    if (track.tracked && t - track.lastSeenT > lostTimeoutMs(track, params)) resetHandTrack(track);
    return;
  }

  // 結果が届かない間（タブが裏に回った・映像が止まった等）をはさんだ認識は，続けて認識したとみなさない．
  // 見えなかった回の結果が来ないと seenStreak が 0 に戻らず，1 回の認識で tracked になってしまうため
  const lostGap = t - track.lastSeenT > lostTimeoutMs(track, params);
  if (lostGap) resetHandTrack(track);
  // 見失った後に戻った時は，古い位置から滑ってこないようにフィルタを作り直す
  const fresh =
    track.palm === null ||
    track.tip === null ||
    (!track.tracked && track.seenStreak === 0) ||
    lostGap;
  const oe = oneEuroParams(params);
  // 21 点は手のひらの中心からのずれ（手の形）だけをフィルタする．位置は手のひらのフィルタと外挿に任せ，
  // 認識の合間も手のひらと一緒に全体が動くようにする（21 点それぞれを外挿すると指がばらばらに飛ぶ）
  const offsets = offsetsFromPalm(pos.landmarks, pos.palm);
  if (fresh || track.palm === null || track.tip === null || track.shape === null) {
    track.palm = createOneEuroVec3(pos.palm, t);
    track.tip = createOneEuroVec3(pos.tip, t);
    track.shape = offsets.map((o) => createOneEuroVec3(o, t));
  } else {
    track.palm = stepOneEuroVec3(track.palm, pos.palm, t, oe);
    track.tip = stepOneEuroVec3(track.tip, pos.tip, t, oe);
    const shape = track.shape;
    track.shape = offsets.map((o, i) => stepOneEuroVec3(shape[i], o, t, oe));
  }
  track.depth = pos.depth;
  track.seenStreak++;
  track.lastSeenT = t;
  if (track.seenStreak >= Math.max(1, params.trackAppearCount)) track.tracked = true;

  track.gripRaw = shape.grip;
  track.gripped = nextGripped(track.gripped, shape.grip, params.gripOn, params.gripOff);
  track.pinchRatio = shape.pinchRatio;
  track.pinching = nextPinching(
    track.pinching,
    shape.pinchRatio,
    params.pinchOnRatio,
    params.pinchOffRatio,
  );
  track.pointing = nextConfirmed(track.pointing, shape.pointing, params.pointConfirmCount);
}

const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };

/** 今の時刻 now（ms）の片手の値を読む（状態は変えない） */
export function readHandTrack(track: HandTrack, now: number, params: HandParams): HandReading {
  const ageMs = Number.isFinite(track.lastSeenT) ? now - track.lastSeenT : Number.POSITIVE_INFINITY;
  const tracked = track.tracked && ageMs <= lostTimeoutMs(track, params) + READ_TIMEOUT_MARGIN_MS;
  const ex = {
    maxMs: params.extrapolateMaxMs,
    decayMs: params.extrapolateDecayMs,
    maxSpeed: params.extrapolateMaxSpeed,
  };
  const at = (f: OneEuroVec3 | null): Vec3 =>
    f === null ? ORIGIN : tracked ? extrapolateVec3(f, now, ex) : { x: f.x, y: f.y, z: f.z };
  const gripped = tracked && track.gripped;
  const pinching = tracked && track.pinching;
  const position = at(track.palm);
  const landmarks =
    track.shape === null
      ? null
      : track.shape.map((o) => ({ x: position.x + o.x, y: position.y + o.y, z: position.z + o.z }));
  return {
    tracked,
    position,
    indexTip: at(track.tip),
    landmarks,
    grip: gripOutput(gripped, tracked ? track.gripRaw : 0, params.gripOn, params.gripOff),
    pinch: tracked ? pinchAmount(track.pinchRatio, params.pinchOffRatio) : 0,
    pinching,
    pointing: tracked && track.pointing.value,
    ageMs,
  };
}

/** PlayerInput に載せる形にする（今の HandState にある項目だけ．Issue #64）．21 点が無ければ landmarks を省く */
export function toHandState(r: HandReading): HandState {
  const s = { tracked: r.tracked, position: r.position, grip: r.grip };
  return r.landmarks === null ? s : { ...s, landmarks: r.landmarks };
}
