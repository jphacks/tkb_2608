// ドラッグ量から視点の向き（yaw / pitch）を計算する（DOM に依存しない純粋な関数）

/** 視点の向き（rad）．yaw は Y 軸回り（0 で -Z，正で左），pitch は上向きが正 */
export interface LookAngles {
  readonly yaw: number;
  readonly pitch: number;
}

export interface LookOptions {
  /** 1 px あたりの回転量（rad） */
  readonly sensitivity: number;
  /** pitch の上下の限界（rad） */
  readonly pitchLimit: number;
}

export const DEFAULT_LOOK_OPTIONS: LookOptions = {
  sensitivity: 0.004,
  pitchLimit: (85 * Math.PI) / 180,
};

/** 角度を (-π, π] に収める */
export function wrapAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  const wrapped = angle - twoPi * Math.floor((angle + Math.PI) / twoPi);
  return wrapped === -Math.PI ? Math.PI : wrapped;
}

/** ドラッグ量（px）を向きに反映する．右へドラッグで右を向き，上へドラッグで上を向く */
export function applyLookDelta(
  look: LookAngles,
  dx: number,
  dy: number,
  options: LookOptions = DEFAULT_LOOK_OPTIONS,
): LookAngles {
  const pitch = look.pitch - dy * options.sensitivity;
  return {
    yaw: wrapAngle(look.yaw - dx * options.sensitivity),
    pitch: Math.max(-options.pitchLimit, Math.min(options.pitchLimit, pitch)),
  };
}
