// 赤い表示（redEdge.ts）のテスト．基準は SPEC_01「VR 避難の規則」の「赤い表示」
// （エラー行動の間は出し続け，やめたら消す．点滅させない）と Issue #121（短いフェードだけ・消えている間は描かない）

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createRedEdge, RED_EDGE, stepRedEdgeOpacity } from "./redEdge";

describe("RED_EDGE", () => {
  it("フェードは短く（0 秒より長く 1 秒以下），端の濃さと赤くし始める位置は 0〜1 の範囲", () => {
    expect(RED_EDGE.fadeSeconds).toBeGreaterThan(0);
    expect(RED_EDGE.fadeSeconds).toBeLessThanOrEqual(1);
    expect(RED_EDGE.edgeOpacity).toBeGreaterThan(0);
    expect(RED_EDGE.edgeOpacity).toBeLessThanOrEqual(1);
    expect(RED_EDGE.inner).toBeGreaterThanOrEqual(0);
    expect(RED_EDGE.inner).toBeLessThan(1);
  });

  it("色は赤（R が G・B より大きい）", () => {
    const c = new THREE.Color(RED_EDGE.color);
    expect(c.r).toBeGreaterThan(c.g);
    expect(c.r).toBeGreaterThan(c.b);
  });
});

describe("stepRedEdgeOpacity", () => {
  it("出す時は fadeSeconds 秒で 0 から 1 へ一様に上がる", () => {
    expect(stepRedEdgeOpacity(0, true, 0.05, 0.2)).toBeCloseTo(0.25);
    expect(stepRedEdgeOpacity(0.25, true, 0.05, 0.2)).toBeCloseTo(0.5);
    expect(stepRedEdgeOpacity(0, true, 0.2, 0.2)).toBeCloseTo(1);
  });

  it("消す時は fadeSeconds 秒で 1 から 0 へ一様に下がる", () => {
    expect(stepRedEdgeOpacity(1, false, 0.05, 0.2)).toBeCloseTo(0.75);
    expect(stepRedEdgeOpacity(1, false, 0.2, 0.2)).toBeCloseTo(0);
  });

  it("目標を越えない（1 より大きく・0 より小さくならない）", () => {
    expect(stepRedEdgeOpacity(0.9, true, 1, 0.2)).toBe(1);
    expect(stepRedEdgeOpacity(0.1, false, 1, 0.2)).toBe(0);
    expect(stepRedEdgeOpacity(1, true, 0.05, 0.2)).toBe(1);
    expect(stepRedEdgeOpacity(0, false, 0.05, 0.2)).toBe(0);
  });

  it("フレームを細かく分けても同じ時間で同じ値になる", () => {
    let a = 0;
    for (let i = 0; i < 6; i++) a = stepRedEdgeOpacity(a, true, 0.1 / 6, 0.2);
    expect(a).toBeCloseTo(stepRedEdgeOpacity(0, true, 0.1, 0.2));
  });

  it("出し続けている間は 1 のまま（点滅しない）", () => {
    let o = 0;
    const values: number[] = [];
    for (let i = 0; i < 120; i++) {
      o = stepRedEdgeOpacity(o, true, 1 / 60, 0.2);
      values.push(o);
    }
    // 単調に増え，上がりきった後は 1 のまま
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1] ?? 0);
    }
    expect(values.slice(20)).toEqual(new Array(100).fill(1));
  });

  it("dt が 0 なら動かない", () => {
    expect(stepRedEdgeOpacity(0.4, true, 0, 0.2)).toBe(0.4);
    expect(stepRedEdgeOpacity(0.4, false, 0, 0.2)).toBe(0.4);
  });

  it("dt が負なら動かない（戻らない）", () => {
    expect(stepRedEdgeOpacity(0.4, true, -0.1, 0.2)).toBe(0.4);
    expect(stepRedEdgeOpacity(0.4, false, -0.1, 0.2)).toBe(0.4);
  });

  it.each([
    ["undefined", undefined],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
  ])("dt が %s なら瞬時に目標へ切り替える", (_, dt) => {
    expect(stepRedEdgeOpacity(0.4, true, dt, 0.2)).toBe(1);
    expect(stepRedEdgeOpacity(0.4, false, dt, 0.2)).toBe(0);
  });

  it.each([
    ["0", 0],
    ["負", -1],
    ["NaN", Number.NaN],
  ])("fadeSeconds が %s なら瞬時に目標へ切り替える", (_, fade) => {
    expect(stepRedEdgeOpacity(0, true, 0.01, fade)).toBe(1);
    expect(stepRedEdgeOpacity(1, false, 0.01, fade)).toBe(0);
  });

  it("結果は常に 0〜1 に収まる（いろいろな入力）", () => {
    const currents = [0, 0.3, 1];
    const dts = [undefined, -1, 0, 0.001, 0.1, 10, Number.NaN];
    const fades = [-1, 0, 0.2, 5, Number.NaN];
    for (const c of currents) {
      for (const dt of dts) {
        for (const f of fades) {
          for (const active of [true, false]) {
            const v = stepRedEdgeOpacity(c, active, dt, f);
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });
});

/** 描画される不透明度（シェーダーに渡す uOpacity） */
function shaderOpacity(edge: ReturnType<typeof createRedEdge>): number {
  const material = edge.object.material;
  if (!(material instanceof THREE.ShaderMaterial)) throw new Error("ShaderMaterial でない");
  return material.uniforms.uOpacity?.value as number;
}

describe("createRedEdge", () => {
  it("消えた状態で始まり，描かない（visible: false・不透明度 0）", () => {
    const edge = createRedEdge();
    expect(edge.active).toBe(false);
    expect(edge.opacity).toBe(0);
    expect(edge.object.visible).toBe(false);
    expect(shaderOpacity(edge)).toBe(0);
    edge.update(1 / 60);
    expect(edge.object.visible).toBe(false);
    edge.dispose();
  });

  it("全画面の板は視錐台で消されず，半透明で深度に関係なく上に重なる", () => {
    const edge = createRedEdge();
    expect(edge.object).toBeInstanceOf(THREE.Mesh);
    expect(edge.object.frustumCulled).toBe(false);
    const material = edge.object.material as THREE.ShaderMaterial;
    expect(material.transparent).toBe(true);
    expect(material.depthTest).toBe(false);
    expect(material.depthWrite).toBe(false);
    edge.dispose();
  });

  it("setActive(true) の後の update で見えるようになり，フェードの長さで端の濃さまで上がる", () => {
    const edge = createRedEdge();
    edge.setActive(true);
    expect(edge.active).toBe(true);
    // update するまでは変わらない
    expect(edge.object.visible).toBe(false);
    edge.update(RED_EDGE.fadeSeconds / 2);
    expect(edge.object.visible).toBe(true);
    expect(edge.opacity).toBeCloseTo(0.5);
    expect(shaderOpacity(edge)).toBeCloseTo(0.5 * RED_EDGE.edgeOpacity);
    edge.update(RED_EDGE.fadeSeconds);
    expect(edge.opacity).toBe(1);
    expect(shaderOpacity(edge)).toBeCloseTo(RED_EDGE.edgeOpacity);
    edge.dispose();
  });

  it("setActive(false) の後はフェードで消え，消えきると描かない", () => {
    const edge = createRedEdge();
    edge.setActive(true);
    edge.update(1);
    edge.setActive(false);
    edge.update(RED_EDGE.fadeSeconds / 2);
    expect(edge.object.visible).toBe(true);
    expect(edge.opacity).toBeCloseTo(0.5);
    edge.update(RED_EDGE.fadeSeconds);
    expect(edge.opacity).toBe(0);
    expect(edge.object.visible).toBe(false);
    expect(shaderOpacity(edge)).toBe(0);
    edge.dispose();
  });

  it("同じ値を毎フレーム渡しても出し続ける", () => {
    const edge = createRedEdge();
    for (let i = 0; i < 60; i++) {
      edge.setActive(true);
      edge.update(1 / 60);
    }
    expect(edge.opacity).toBe(1);
    expect(edge.object.visible).toBe(true);
    edge.dispose();
  });

  it("update(dt なし) は瞬時に切り替える", () => {
    const edge = createRedEdge();
    edge.setActive(true);
    edge.update();
    expect(edge.opacity).toBe(1);
    expect(edge.object.visible).toBe(true);
    edge.setActive(false);
    edge.update();
    expect(edge.opacity).toBe(0);
    expect(edge.object.visible).toBe(false);
    edge.dispose();
  });

  it("fadeSeconds を指定できる（0 で瞬時）", () => {
    const slow = createRedEdge({ fadeSeconds: 1 });
    slow.setActive(true);
    slow.update(0.25);
    expect(slow.opacity).toBeCloseTo(0.25);
    slow.dispose();
    const instant = createRedEdge({ fadeSeconds: 0 });
    instant.setActive(true);
    instant.update(0.001);
    expect(instant.opacity).toBe(1);
    instant.dispose();
  });

  it("dispose でジオメトリとマテリアルを解放する", () => {
    const edge = createRedEdge();
    const disposed: string[] = [];
    edge.object.geometry.addEventListener("dispose", () => disposed.push("geometry"));
    (edge.object.material as THREE.Material).addEventListener("dispose", () =>
      disposed.push("material"),
    );
    edge.dispose();
    expect(disposed.sort()).toEqual(["geometry", "material"]);
  });
});
