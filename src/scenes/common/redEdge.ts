// 赤い表示（エラー行動の間，VR の画面の縁を赤くする．SPEC_01「VR 避難の規則」の「赤い表示」）．
// 頂点をクリップ座標にそのまま置く全画面の板なので，カメラ・ビューポートによらず描いた画面の縁に出る（左右 2 画面でも両方の縁に出る）

import * as THREE from "three";

/** 赤い表示の見た目と出し入れの速さ（仮の値．デモで横から見て決め直す） */
export const RED_EDGE = {
  /** 縁の色 */
  color: 0xe61414,
  /** 画面の端での不透明度（0〜1）．横から見ても分かる濃さにする */
  edgeOpacity: 0.85,
  /**
   * 赤くし始める位置（画面の中心を 0，端を 1 とした縦横それぞれの距離）．ここから端へ向けて濃くする．
   * ゴーグルではレンズの外周が見えにくいため，広めにかける
   */
  inner: 0.6,
  /** 出す・消す時のフェードの長さ（s）．点滅に見えないよう短いフェードだけにする */
  fadeSeconds: 0.2,
} as const;

/** 赤い表示を作る時の追加の指定 */
export interface RedEdgeOptions {
  /** フェードの長さ（s．既定 RED_EDGE.fadeSeconds．0 以下で瞬時に切り替える） */
  readonly fadeSeconds?: number;
}

/** 赤い表示．object を描く Scene のどこか（空間の root 等）に足し，setActive で出す・消す */
export interface RedEdge {
  /** 全画面の板（位置・向きは描画に関係しない．視錐台の外れで消されないよう frustumCulled は false） */
  readonly object: THREE.Mesh;
  /** 出すか（true でエラー行動の間）．同じ値を毎フレーム渡してよい */
  setActive(active: boolean): void;
  /** 今出す指示を受けているか */
  readonly active: boolean;
  /** 今の不透明度の倍率（0〜1．フェードの途中の値） */
  readonly opacity: number;
  /** フェードを dt（s）だけ進める．dt が無い（undefined）時は瞬時に切り替える */
  update(dt?: number): void;
  dispose(): void;
}

/**
 * 不透明度の倍率（0〜1）を，出す（active）なら 1 へ，消すなら 0 へ dt（s）だけ近づける．
 * fadeSeconds が 0 以下・dt が有限でない時は瞬時に切り替える．dt が負なら動かさない
 */
export function stepRedEdgeOpacity(
  current: number,
  active: boolean,
  dt: number | undefined,
  fadeSeconds: number,
): number {
  const target = active ? 1 : 0;
  if (dt === undefined || !Number.isFinite(dt) || !(fadeSeconds > 0)) return target;
  if (dt <= 0) return current;
  const delta = dt / fadeSeconds;
  return current < target ? Math.min(current + delta, target) : Math.max(current - delta, target);
}

const VERTEX_SHADER = /* glsl */ `
varying vec2 vPos;
void main() {
  // PlaneGeometry(2, 2) の頂点（-1〜1）をそのままクリップ座標にし，描いているビューポート全体を覆う
  vPos = position.xy;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uInner;
varying vec2 vPos;
void main() {
  // 縦横の端までの近さの大きい方で，四辺を同じ太さの縁にする
  float r = max(abs(vPos.x), abs(vPos.y));
  float a = smoothstep(uInner, 1.0, r);
  gl_FragColor = vec4(uColor, a * uOpacity);
}
`;

/** 赤い表示を作る（消えた状態で始まる） */
export function createRedEdge(options: RedEdgeOptions = {}): RedEdge {
  const fadeSeconds = options.fadeSeconds ?? RED_EDGE.fadeSeconds;
  const opacityUniform = { value: 0 };
  const material = new THREE.ShaderMaterial({
    name: "red-edge",
    uniforms: {
      uColor: { value: new THREE.Color(RED_EDGE.color) },
      uOpacity: opacityUniform,
      uInner: { value: RED_EDGE.inner },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.name = "red-edge";
  mesh.frustumCulled = false;
  // 煙・炎等の半透明の物より後に，すべての上へ重ねる
  mesh.renderOrder = 10_000;
  mesh.visible = false;

  let active = false;
  let opacity = 0;
  return {
    object: mesh,
    get active() {
      return active;
    },
    get opacity() {
      return opacity;
    },
    setActive(next) {
      active = next;
    },
    update(dt) {
      opacity = stepRedEdgeOpacity(opacity, active, dt, fadeSeconds);
      opacityUniform.value = opacity * RED_EDGE.edgeOpacity;
      // 消えている間は描かない（描画の回数を増やさない）
      mesh.visible = opacity > 0;
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}
