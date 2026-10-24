// バイクワッド（2 次の IIR）フィルタ（experiment_山﨑/04 ②）．係数は RBJ の Audio EQ Cookbook の式で，
// サンプルの周期（dt）から求める．周期の違う端末でも同じ特性になる．1 サンプルあたり O(1)（過去の値は 2 つずつ）

export type BiquadKind = "lowpass" | "highpass";

/** フィルタの係数と過去の値（a0 で割った形．直接形 I） */
export interface Biquad {
  kind: BiquadKind;
  /** 遮断周波数（Hz） */
  cutoffHz: number;
  /** 係数を求めた時のサンプリング周波数（Hz）．0 ならまだ求めていない */
  fs: number;
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

/** Q = 1/√2（バターワース．通過域が平ら） */
const Q_BUTTERWORTH = Math.SQRT1_2;

export function createBiquad(kind: BiquadKind, cutoffHz: number): Biquad {
  return {
    kind,
    cutoffHz,
    fs: 0,
    b0: 1,
    b1: 0,
    b2: 0,
    a1: 0,
    a2: 0,
    x1: 0,
    x2: 0,
    y1: 0,
    y2: 0,
  };
}

/**
 * サンプリング周波数 fs（Hz）と遮断周波数から係数を求める．
 * 遮断周波数はナイキスト周波数の 0.9 倍までに抑える（周期が遅い端末で不安定にしない）
 */
export function designBiquad(f: Biquad, fs: number, cutoffHz: number = f.cutoffHz): void {
  if (!(fs > 0) || !(cutoffHz > 0)) return;
  const fc = Math.min(cutoffHz, fs * 0.45);
  const w0 = (2 * Math.PI * fc) / fs;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Q_BUTTERWORTH);
  const a0 = 1 + alpha;
  if (f.kind === "lowpass") {
    f.b0 = (1 - cos) / 2 / a0;
    f.b1 = (1 - cos) / a0;
    f.b2 = (1 - cos) / 2 / a0;
  } else {
    f.b0 = (1 + cos) / 2 / a0;
    f.b1 = -(1 + cos) / a0;
    f.b2 = (1 + cos) / 2 / a0;
  }
  f.a1 = (-2 * cos) / a0;
  f.a2 = (1 - alpha) / a0;
  f.cutoffHz = cutoffHz;
  f.fs = fs;
}

/** 過去の値を 0 にする（係数はそのまま） */
export function resetBiquad(f: Biquad): void {
  f.x1 = 0;
  f.x2 = 0;
  f.y1 = 0;
  f.y2 = 0;
}

/** 1 サンプル通して出力を返す */
export function biquadStep(f: Biquad, x: number): number {
  const y = f.b0 * x + f.b1 * f.x1 + f.b2 * f.x2 - f.a1 * f.y1 - f.a2 * f.y2;
  f.x2 = f.x1;
  f.x1 = x;
  f.y2 = f.y1;
  f.y1 = y;
  return y;
}

/**
 * 係数を今の周期に合わせてから 1 サンプル通す．周期のゆらぎで毎回求め直さないよう，
 * fs か遮断周波数が 1% 以上変わった時だけ求め直す
 */
export function biquadStepAt(f: Biquad, x: number, fs: number, cutoffHz: number): number {
  if (f.fs === 0 || Math.abs(fs - f.fs) > f.fs * 0.01 || cutoffHz !== f.cutoffHz) {
    designBiquad(f, fs, cutoffHz);
  }
  return biquadStep(f, x);
}
