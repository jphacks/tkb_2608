// 防火シャッターのくぐり戸の自動の開閉の計算（shutterWicket.ts）のテスト．
// 基準は SPEC_02「通れる・燃え広がる」: 目の位置がくぐり戸の中心から水平に 1.5 m 以内で開き始め，1.9 m を超えると閉じ始める
// （その間は直前の状態を保つ）．閉から全開まで 0.4 s，全開は 90°．開く向きは体験者のいる側と反対
import { describe, expect, it } from "vitest";
import {
  stepWicketOpenAmount,
  WICKET_AUTO,
  wicketLeafRotationY,
  wicketShouldOpen,
  wicketSwingFrom,
} from "./shutterWicket";

describe("WICKET_AUTO", () => {
  it("SPEC_02 の値（開く 1.5 m・閉じる 1.9 m・0.4 s・90°）", () => {
    expect(WICKET_AUTO.openDistance).toBe(1.5);
    expect(WICKET_AUTO.closeDistance).toBe(1.9);
    expect(WICKET_AUTO.travelSeconds).toBe(0.4);
    expect(WICKET_AUTO.maxAngle).toBeCloseTo(Math.PI / 2);
  });

  it("閉じる距離は開く距離より大きい（境目で開閉を繰り返さない）", () => {
    expect(WICKET_AUTO.closeDistance).toBeGreaterThan(WICKET_AUTO.openDistance);
  });
});

describe("wicketShouldOpen", () => {
  it.each([
    // [直前に開いていたか, 距離, 期待]
    [false, 0, true],
    [false, 1.0, true],
    [false, 1.5, true], // 1.5 m 以内（ちょうど）で開く
    [false, 1.5001, false],
    [false, 1.7, false], // 間は直前の状態（閉）を保つ
    [false, 1.9, false],
    [false, 5, false],
    [true, 0, true],
    [true, 1.5, true],
    [true, 1.7, true], // 間は直前の状態（開）を保つ
    [true, 1.9, true], // 1.9 m ちょうどはまだ超えていない
    [true, 1.9001, false], // 超えると閉じる
    [true, 5, false],
  ])("wasOpen=%s・距離 %s m なら %s", (wasOpen, distance, expected) => {
    expect(wicketShouldOpen(wasOpen, distance)).toBe(expected);
  });

  it.each([true, false])("距離が NaN なら閉じる（wasOpen=%s）", (wasOpen) => {
    expect(wicketShouldOpen(wasOpen, Number.NaN)).toBe(false);
  });

  it.each([true, false])("距離が Infinity なら閉じる（wasOpen=%s）", (wasOpen) => {
    expect(wicketShouldOpen(wasOpen, Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("近づいて離れる間の状態の移り変わり（1.7 m で止まっても開閉を繰り返さない）", () => {
    let open = false;
    const seen: boolean[] = [];
    for (const d of [3, 2, 1.7, 1.5, 1.0, 1.7, 1.9, 1.7, 2.0, 1.7]) {
      open = wicketShouldOpen(open, d);
      seen.push(open);
    }
    expect(seen).toEqual([false, false, false, true, true, true, true, true, false, false]);
  });
});

describe("stepWicketOpenAmount", () => {
  it("閉から全開まで 0.4 s（0.1 s ごとに 1/4 ずつ開く）", () => {
    let amount = 0;
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      amount = stepWicketOpenAmount(amount, true, 0.1);
      seen.push(amount);
    }
    expect(seen[0]).toBeCloseTo(0.25);
    expect(seen[1]).toBeCloseTo(0.5);
    expect(seen[2]).toBeCloseTo(0.75);
    expect(seen[3]).toBeCloseTo(1);
    expect(seen[4]).toBe(1); // 全開で止まる
  });

  it("全開から閉まで 0.4 s で，0 で止まる", () => {
    expect(stepWicketOpenAmount(1, false, 0.2)).toBeCloseTo(0.5);
    expect(stepWicketOpenAmount(0.5, false, 0.2)).toBeCloseTo(0);
    expect(stepWicketOpenAmount(0.1, false, 1)).toBe(0);
    expect(stepWicketOpenAmount(0, false, 0.1)).toBe(0);
  });

  it("大きな dt でも 0〜1 を超えない", () => {
    expect(stepWicketOpenAmount(0, true, 100)).toBe(1);
    expect(stepWicketOpenAmount(1, false, 100)).toBe(0);
  });

  it("途中から向きを変えられる（開いている途中で閉じ始める）", () => {
    const half = stepWicketOpenAmount(0, true, 0.2);
    expect(half).toBeCloseTo(0.5);
    expect(stepWicketOpenAmount(half, false, 0.1)).toBeCloseTo(0.25);
  });

  it.each([
    ["undefined", undefined],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
  ])("dt が %s なら瞬時に切り替える", (_, dt) => {
    expect(stepWicketOpenAmount(0, true, dt)).toBe(1);
    expect(stepWicketOpenAmount(0.3, true, dt)).toBe(1);
    expect(stepWicketOpenAmount(1, false, dt)).toBe(0);
    expect(stepWicketOpenAmount(0.6, false, dt)).toBe(0);
  });

  it("負の dt は 0 として扱う（動かない）", () => {
    expect(stepWicketOpenAmount(0.5, true, -1)).toBeCloseTo(0.5);
    expect(stepWicketOpenAmount(0.5, false, -1)).toBeCloseTo(0.5);
  });

  it("dt が 0 なら動かない", () => {
    expect(stepWicketOpenAmount(0.3, true, 0)).toBeCloseTo(0.3);
    expect(stepWicketOpenAmount(0.3, false, 0)).toBeCloseTo(0.3);
  });

  it("範囲外の開き具合は 0〜1 に切り詰めてから進める", () => {
    expect(stepWicketOpenAmount(-5, true, 0.1)).toBeCloseTo(0.25);
    expect(stepWicketOpenAmount(5, false, 0.1)).toBeCloseTo(0.75);
    expect(stepWicketOpenAmount(5, true, 0.1)).toBe(1);
    expect(stepWicketOpenAmount(-5, false, 0.1)).toBe(0);
  });

  it("開き具合が NaN でも結果は 0〜1 の有限の数", () => {
    for (const open of [true, false]) {
      const v = stepWicketOpenAmount(Number.NaN, open, 0.1);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe("wicketSwingFrom", () => {
  it("人がいる側の反対へ開く（+Z にいれば -Z の側へ＝1，-Z にいれば +Z の側へ＝-1）", () => {
    expect(wicketSwingFrom(0.8)).toBe(1);
    expect(wicketSwingFrom(1e-9)).toBe(1);
    expect(wicketSwingFrom(-0.8)).toBe(-1);
    expect(wicketSwingFrom(-1e-9)).toBe(-1);
  });

  it.each([
    ["0", 0],
    ["-0", -0],
    ["NaN", Number.NaN],
  ])("%s なら 1（-Z の側へ開く）", (_, z) => {
    expect(wicketSwingFrom(z)).toBe(1);
  });
});

describe("wicketLeafRotationY", () => {
  it("閉じている時は回らない", () => {
    expect(wicketLeafRotationY(0, 1)).toBeCloseTo(0);
    expect(wicketLeafRotationY(0, -1)).toBeCloseTo(0);
  });

  it("全開で 90°．向きで符号が変わる", () => {
    expect(wicketLeafRotationY(1, 1)).toBeCloseTo(Math.PI / 2);
    expect(wicketLeafRotationY(1, -1)).toBeCloseTo(-Math.PI / 2);
  });

  it("正の回転で扉の +X の端が -Z の側へ動く（swing 1 は -Z の側へ開く）", () => {
    const angle = wicketLeafRotationY(1, 1);
    // Y 軸回りの回転で (1, 0, 0) は (cos, 0, -sin) に移る
    expect(-Math.sin(angle)).toBeLessThan(0);
    expect(-Math.sin(wicketLeafRotationY(1, -1))).toBeGreaterThan(0);
  });

  it("開き具合に対して単調に増え，半分で 45°（動き始めと終わりは緩やか）", () => {
    let prev = -Infinity;
    for (let i = 0; i <= 20; i++) {
      const r = wicketLeafRotationY(i / 20, 1);
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
    expect(wicketLeafRotationY(0.5, 1)).toBeCloseTo(Math.PI / 4);
    // 動き始めは線形より小さい（緩やか）
    expect(wicketLeafRotationY(0.1, 1)).toBeLessThan((Math.PI / 2) * 0.1);
    // 終わりは線形より大きい（全開に近づくと緩やか）
    expect(wicketLeafRotationY(0.9, 1)).toBeGreaterThan((Math.PI / 2) * 0.9);
  });

  it("範囲外の開き具合は 0〜1 に切り詰める．NaN は閉じた扱い", () => {
    expect(wicketLeafRotationY(2, 1)).toBeCloseTo(Math.PI / 2);
    expect(wicketLeafRotationY(-1, 1)).toBeCloseTo(0);
    expect(wicketLeafRotationY(Number.NaN, 1)).toBeCloseTo(0);
    expect(wicketLeafRotationY(Number.POSITIVE_INFINITY, -1)).toBeCloseTo(0);
  });
});
