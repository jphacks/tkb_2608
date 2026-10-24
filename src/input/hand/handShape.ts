// 21 点から手の形（握る・つまむ・指を差す）を計算する純粋な関数（experiment_山﨑/07「手の形」）．
// 距離はすべて手の大きさ（手首から中指の付け根まで）で割り，カメラからの距離が変わっても同じしきい値で判定する
import { type Landmark, LM } from "./types";

/** 縦横の比を直した点（x・z を画像の幅/高さ倍にして，y と同じ縮尺にする） */
interface IsoPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

function iso(p: Landmark, aspect: number): IsoPoint {
  return { x: p.x * aspect, y: p.y, z: p.z * aspect };
}

function dist(a: IsoPoint, b: IsoPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** 手の形の計算に使う値（1 回の認識ごと） */
export interface HandShapeRaw {
  /** 手の大きさ（手首から中指の付け根．画像の高さを 1 とした長さ） */
  readonly size: number;
  /** 指ごとの曲がり具合（0: 伸びている，1: 曲がりきっている）．人差し指・中指・薬指・小指の順 */
  readonly curls: readonly [number, number, number, number];
  /** 4 本の指の曲がりの平均（握り具合の生の値．0〜1） */
  readonly grip: number;
  /** 親指と人差し指の先の距離（手の大きさで割った値） */
  readonly pinchRatio: number;
  /** 人差し指だけが伸び，他の指が曲がっているか（1 回分） */
  readonly pointing: boolean;
}

export interface HandShapeParams {
  readonly fingerOpenRatio: number;
  readonly fingerClosedRatio: number;
  readonly pointIndexMaxCurl: number;
  readonly pointOthersMinCurl: number;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** 手のひらの中心（手首と 4 本の指の付け根の平均．画像の座標） */
export function palmCenter(lm: readonly Landmark[]): Landmark {
  const ids = [LM.WRIST, LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP];
  let x = 0;
  let y = 0;
  let z = 0;
  for (const i of ids) {
    x += lm[i].x;
    y += lm[i].y;
    z += lm[i].z;
  }
  return { x: x / ids.length, y: y / ids.length, z: z / ids.length };
}

/**
 * 21 点から手の形の値を計算する．aspect は画像の幅/高さ．
 * 点が足りない・手の大きさが 0 に近い・値が有限でない時は null
 */
export function computeHandShape(
  lm: readonly Landmark[],
  aspect: number,
  params: HandShapeParams,
): HandShapeRaw | null {
  if (lm.length < 21 || !(aspect > 0)) return null;
  for (const p of lm) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return null;
  }
  const size = dist(iso(lm[LM.WRIST], aspect), iso(lm[LM.MIDDLE_MCP], aspect));
  if (!(size > 1e-4)) return null;
  const center = iso(palmCenter(lm), aspect);
  const range = params.fingerOpenRatio - params.fingerClosedRatio;
  const curlOf = (tip: number): number => {
    const r = dist(iso(lm[tip], aspect), center) / size;
    return range > 0
      ? clamp01((params.fingerOpenRatio - r) / range)
      : r < params.fingerOpenRatio
        ? 1
        : 0;
  };
  const curls: [number, number, number, number] = [
    curlOf(LM.INDEX_TIP),
    curlOf(LM.MIDDLE_TIP),
    curlOf(LM.RING_TIP),
    curlOf(LM.PINKY_TIP),
  ];
  const grip = (curls[0] + curls[1] + curls[2] + curls[3]) / 4;
  const pinchRatio = dist(iso(lm[LM.THUMB_TIP], aspect), iso(lm[LM.INDEX_TIP], aspect)) / size;
  const pointing =
    curls[0] < params.pointIndexMaxCurl &&
    curls[1] > params.pointOthersMinCurl &&
    curls[2] > params.pointOthersMinCurl &&
    curls[3] > params.pointOthersMinCurl;
  return { size, curls, grip, pinchRatio, pointing };
}

/**
 * 握ったか（ヒステリシス）．開いている時は on を超えたら握った，握っている時は off を下回ったら開いた．
 * raw が有限でなければ前の状態を保つ
 */
export function nextGripped(prev: boolean, raw: number, on: number, off: number): boolean {
  if (!Number.isFinite(raw)) return prev;
  return prev ? raw >= off : raw > on;
}

/**
 * 外に出す握り具合．握った状態の間は on 以上，開いた状態の間は off 以下に収める
 * （受け取る側が 0.5 等の 1 つのしきい値で見ても，ヒステリシスと同じ結果になるようにする）
 */
export function gripOutput(gripped: boolean, raw: number, on: number, off: number): number {
  const v = Number.isFinite(raw) ? clamp01(raw) : gripped ? 1 : 0;
  return gripped ? Math.max(v, on) : Math.min(v, off);
}

/** つまんでいるか（ヒステリシス）．距離の比が on より小さくなったらつまんだ，off より大きくなったらやめた */
export function nextPinching(prev: boolean, ratio: number, on: number, off: number): boolean {
  if (!Number.isFinite(ratio)) return prev;
  return prev ? ratio <= off : ratio < on;
}

/** つまむ具合（0〜1）．距離の比が off 以上で 0，0 で 1 */
export function pinchAmount(ratio: number, off: number): number {
  if (!Number.isFinite(ratio) || !(off > 0)) return 0;
  return clamp01(1 - ratio / off);
}

/** 続けて確かめる判定の状態（指を差す） */
export interface ConfirmState {
  readonly value: boolean;
  /** 今の値と違う結果が続いた回数 */
  readonly streak: number;
}

export const INITIAL_CONFIRM: ConfirmState = { value: false, streak: 0 };

/** raw が今の値と違う結果を count 回続けたら切り替える */
export function nextConfirmed(prev: ConfirmState, raw: boolean, count: number): ConfirmState {
  if (raw === prev.value) return prev.streak === 0 ? prev : { value: prev.value, streak: 0 };
  const streak = prev.streak + 1;
  return streak >= Math.max(1, count) ? { value: raw, streak: 0 } : { value: prev.value, streak };
}
