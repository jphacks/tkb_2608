// 重力の向きから，スマホが左右どちらの横向きで持たれているかを判断し，OS の画面の向きと食い違うか（画面が逆さか）を決める
// （DOM に依存しない純粋な関数）．回転ロック・素早い 180° の回転等で OS が画面を回さなかった時に案内を出すため（Issue #158）

/**
 * 端末の座標系（W3C．x: 縦持ちの画面の右，y: 縦持ちの画面の上，z: 画面から手前）での「上」の向き．
 * 長さは問わない（向きだけを使う）
 */
export interface UpVector {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * 横向きの左右．画面を正しく見せるのに要る screen.orientation.angle（deg）で表す．
 * 90 = 縦持ちから反時計回りに 90° 回した（縦持ちの右の辺が上），270 = 時計回りに 90° 回した（左の辺が上）
 */
export type LandscapeSide = 90 | 270;

export interface LandscapeSideConfig {
  /** 上の向きのうち x の成分の割合（-1〜1）の絶対値がこれ以上になったら，その側の横向きとみなす */
  readonly enterRatio: number;
  /** 割合の絶対値がこれより小さくなったら，判断しない（水平に近い・縦持ちに近い）．enterRatio との間は前の判断を保つ */
  readonly exitRatio: number;
  /** 新しい判断（判断しないことも含む）がこの時間（ms）続いたら採る．回す途中や揺れで変わらないため */
  readonly holdMs: number;
  /** 判断した側と OS の画面の向きの食い違いがこの時間（ms）続いたら逆さとみなす（OS の回転の遅れを待つ） */
  readonly flipHoldMs: number;
}

/**
 * 既定値．ゴーグルに入れて前を向くと上の向きはほぼ ±x（割合 ≒ ±1）なので，0.7（約 44° 傾く）までは判断を保つ．
 * 0.4（約 24°）より水平・縦持ちに近づいたら判断しない．OS が画面を回すのに 1 秒ほどかかることがあるため，食い違いは 1.5 秒待つ
 */
export const DEFAULT_LANDSCAPE_SIDE_CONFIG: LandscapeSideConfig = {
  enterRatio: 0.7,
  exitRatio: 0.4,
  holdMs: 300,
  flipHoldMs: 1500,
};

/** 左右の判断の状態（書き換える）．createLandscapeSideState で作る */
export interface LandscapeSideState {
  /** 採った判断．判断しない時は null */
  side: LandscapeSide | null;
  /** 1 サンプルごとの判断（ヒステリシスの後）．side と違う間は candidateSinceMs から数える */
  candidate: LandscapeSide | null;
  /** candidate が今の値になった時刻（ms） */
  candidateSinceMs: number;
  /** 判断と OS の画面の向きが食い違い始めた時刻（ms）．食い違っていなければ null */
  mismatchSinceMs: number | null;
  /** 画面が逆さとみなしているか */
  flipped: boolean;
}

export function createLandscapeSideState(): LandscapeSideState {
  return {
    side: null,
    candidate: null,
    candidateSinceMs: 0,
    mismatchSinceMs: null,
    flipped: false,
  };
}

const DEG = Math.PI / 180;

/**
 * deviceorientation の beta・gamma（deg）から，端末の座標系での上の向きを求める．
 * Z-X'-Y'' の回転（alpha・beta・gamma）の逆で地面の上 (0, 0, 1) を写したもの．alpha（方位）には依らない．
 * 値が有限でなければ null
 */
export function upFromOrientation(betaDeg: number, gammaDeg: number): UpVector | null {
  if (!Number.isFinite(betaDeg) || !Number.isFinite(gammaDeg)) return null;
  const b = betaDeg * DEG;
  const g = gammaDeg * DEG;
  return { x: -Math.sin(g) * Math.cos(b), y: Math.sin(b), z: Math.cos(g) * Math.cos(b) };
}

/**
 * 1 サンプルの上の向きから，ヒステリシスを掛けた判断を返す（時間の継続は見ない）．
 * 上の向きが使えない（有限でない・長さ 0）時は前の判断を保つ
 */
export function classifyLandscapeSide(
  up: UpVector | null,
  previous: LandscapeSide | null,
  config: LandscapeSideConfig = DEFAULT_LANDSCAPE_SIDE_CONFIG,
): LandscapeSide | null {
  if (up === null) return previous;
  const { x, y, z } = up;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return previous;
  const len = Math.hypot(x, y, z);
  if (len === 0) return previous;
  const ratio = x / len;
  if (ratio >= config.enterRatio) return 90;
  if (ratio <= -config.enterRatio) return 270;
  if (Math.abs(ratio) < config.exitRatio) return null;
  return previous;
}

/** 画面の向きの角度（deg）を 0・90・180・270 に丸める（-90 は 270）．有限でなければ null */
export function normalizeScreenAngleDeg(angle: number): number | null {
  if (!Number.isFinite(angle)) return null;
  const quarter = Math.round(angle / 90);
  return (((quarter % 4) + 4) % 4) * 90;
}

/**
 * 上の向きのサンプルを 1 つ進め，採った左右の判断を返す（state を書き換える）．
 * 新しい判断は holdMs 続いてから採る．時刻 tMs が有限でなければ何もしない
 */
export function updateLandscapeSide(
  state: LandscapeSideState,
  up: UpVector | null,
  tMs: number,
  config: LandscapeSideConfig = DEFAULT_LANDSCAPE_SIDE_CONFIG,
): LandscapeSide | null {
  if (!Number.isFinite(tMs)) return state.side;
  const next = classifyLandscapeSide(up, state.candidate, config);
  if (next !== state.candidate) {
    state.candidate = next;
    state.candidateSinceMs = tMs;
  }
  if (state.candidate !== state.side && tMs - state.candidateSinceMs >= config.holdMs) {
    state.side = state.candidate;
  }
  return state.side;
}

/**
 * 採った左右の判断と OS の画面の向き（deg．screen.orientation.angle）から，画面が逆さかを決める（state を書き換える）．
 * OS が横向き（90・270）で，判断がその逆の側の状態が flipHoldMs 続いたら逆さとする．
 * 食い違いが無くなったら（判断しない・OS が縦向き・同じ側）すぐに逆さでなくする（案内で操作を塞ぎ続けないため）
 */
export function updateFlipped(
  state: LandscapeSideState,
  screenAngleDeg: number,
  tMs: number,
  config: LandscapeSideConfig = DEFAULT_LANDSCAPE_SIDE_CONFIG,
): boolean {
  const angle = normalizeScreenAngleDeg(screenAngleDeg);
  const mismatch =
    Number.isFinite(tMs) &&
    state.side !== null &&
    (angle === 90 || angle === 270) &&
    angle !== state.side;
  if (!mismatch) {
    state.mismatchSinceMs = null;
    state.flipped = false;
    return false;
  }
  if (state.mismatchSinceMs === null) state.mismatchSinceMs = tMs;
  state.flipped = tMs - state.mismatchSinceMs >= config.flipHoldMs;
  return state.flipped;
}
