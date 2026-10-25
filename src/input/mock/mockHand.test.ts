// モック入力の手（SPEC_01「モック入力」・ENV_04: マウスの位置が右手の位置（画面のマウスの下・目の前 0.45 m），
// 右ボタンか F キーで握る（grip: 1），ホイールで奥行き（0.2〜0.8 m），画面の外では未認識）
import { describe, expect, it } from "vitest";
import {
  applyMockHandPointer,
  applyMockHandWheel,
  DEFAULT_MOCK_HAND_OPTIONS,
  INITIAL_MOCK_HAND,
  type MockHandState,
  mockHandState,
} from "./mockHand";

function hand(o: Partial<MockHandState> = {}): MockHandState {
  return { ...INITIAL_MOCK_HAND, visible: true, ...o };
}

describe("INITIAL_MOCK_HAND", () => {
  it("最初は見えておらず（未認識），奥行きは 0.45 m，握っていない", () => {
    expect(INITIAL_MOCK_HAND.visible).toBe(false);
    expect(INITIAL_MOCK_HAND.depth).toBe(0.45);
    expect(INITIAL_MOCK_HAND.gripping).toBe(false);
    expect(mockHandState(INITIAL_MOCK_HAND).tracked).toBe(false);
  });
});

describe("applyMockHandPointer", () => {
  it.each([
    [400, 300, 0, 0],
    [0, 0, -1, 1],
    [800, 600, 1, -1],
    [800, 0, 1, 1],
    [200, 450, -0.5, -0.5],
  ])("要素 800x600 の (%s, %s) → NDC (%s, %s)", (x, y, ndcX, ndcY) => {
    const s = applyMockHandPointer(INITIAL_MOCK_HAND, x, y, 800, 600);
    expect(s.visible).toBe(true);
    expect(s.ndcX).toBeCloseTo(ndcX, 9);
    expect(s.ndcY).toBeCloseTo(ndcY, 9);
    expect(s.aspect).toBeCloseTo(800 / 600, 9);
  });

  it("要素の外の位置は -1〜1 に収める", () => {
    const s = applyMockHandPointer(INITIAL_MOCK_HAND, -100, 900, 800, 600);
    expect(s.ndcX).toBe(-1);
    expect(s.ndcY).toBe(-1);
  });

  it.each([
    ["幅 0", 10, 10, 0, 600],
    ["高さ負", 10, 10, 800, -1],
    ["x が NaN", Number.NaN, 10, 800, 600],
    ["y が Infinity", 10, Number.POSITIVE_INFINITY, 800, 600],
    ["幅 NaN", 10, 10, Number.NaN, 600],
  ])("%s なら変えない", (_, x, y, w, h) => {
    const s = INITIAL_MOCK_HAND;
    expect(applyMockHandPointer(s, x, y, w, h)).toBe(s);
  });

  it("握っている状態・奥行きは保つ", () => {
    const s = applyMockHandPointer(hand({ gripping: true, depth: 0.6 }), 1, 1, 800, 600);
    expect(s.gripping).toBe(true);
    expect(s.depth).toBe(0.6);
  });
});

describe("applyMockHandWheel", () => {
  it("下へ回す（deltaY 正）と手前，上へ回すと奥", () => {
    expect(applyMockHandWheel(hand(), 100).depth).toBeCloseTo(0.4, 9);
    expect(applyMockHandWheel(hand(), -100).depth).toBeCloseTo(0.5, 9);
  });

  it("奥行きは 0.2〜0.8 m に収める", () => {
    expect(applyMockHandWheel(hand(), 10_000).depth).toBe(0.2);
    expect(applyMockHandWheel(hand(), -10_000).depth).toBe(0.8);
  });

  it.each([0, Number.NaN, Number.POSITIVE_INFINITY])("deltaY が %s なら変えない", (d) => {
    const s = hand();
    expect(applyMockHandWheel(s, d)).toBe(s);
  });
});

describe("mockHandState", () => {
  it("画面の中央のマウスは，目の前（-z）0.45 m の所の手", () => {
    const h = mockHandState(hand({ ndcX: 0, ndcY: 0 }));
    expect(h.tracked).toBe(true);
    expect(h.position.x).toBeCloseTo(0, 9);
    expect(h.position.y).toBeCloseTo(0, 9);
    expect(h.position.z).toBeCloseTo(-0.45, 9);
  });

  it("手はマウスの下に見える（縦の画角 70° のカメラで投影すると同じ NDC に戻る）", () => {
    const s = hand({ ndcX: 0.6, ndcY: -0.4, aspect: 16 / 9, depth: 0.3 });
    const p = mockHandState(s).position;
    const t = Math.tan((DEFAULT_MOCK_HAND_OPTIONS.vfovDeg * Math.PI) / 360);
    expect(p.x / -p.z / (t * s.aspect)).toBeCloseTo(0.6, 9);
    expect(p.y / -p.z / t).toBeCloseTo(-0.4, 9);
    expect(p.z).toBeCloseTo(-0.3, 9);
  });

  it("握っている間は grip 1，離すと 0", () => {
    expect(mockHandState(hand({ gripping: true })).grip).toBe(1);
    expect(mockHandState(hand({ gripping: false })).grip).toBe(0);
  });

  it("見えていない（画面の外）時は tracked: false・grip 0（握っていても）", () => {
    const h = mockHandState(hand({ visible: false, gripping: true }));
    expect(h.tracked).toBe(false);
    expect(h.grip).toBe(0);
  });

  it("21 点を持ち，手のひらの中心が position に重なる", () => {
    const h = mockHandState(hand({ ndcX: 0.3, ndcY: -0.2 }));
    expect(h.landmarks).toHaveLength(21);
    const ids = [0, 5, 9, 13, 17];
    for (const k of ["x", "y", "z"] as const) {
      const mean = ids.reduce((a, i) => a + (h.landmarks?.[i][k] ?? Number.NaN), 0) / ids.length;
      expect(mean).toBeCloseTo(h.position[k], 9);
    }
  });

  it("握っている間は握った手の形（中指の先が手のひらに近い）", () => {
    const tipDist = (s: MockHandState) => {
      const h = mockHandState(s);
      const p = h.landmarks?.[12];
      return p === undefined
        ? Number.NaN
        : Math.hypot(p.x - h.position.x, p.y - h.position.y, p.z - h.position.z);
    };
    expect(tipDist(hand({ gripping: true }))).toBeLessThan(tipDist(hand({ gripping: false })) / 2);
  });
});

describe("mockHandState（手で押すボタンの判定点）", () => {
  it.each([
    ["見えている・開いた手", hand()],
    ["見えている・握った手", hand({ gripping: true })],
    ["見えていない手", INITIAL_MOCK_HAND],
    ["画面の端・奥行き 0.8 m", hand({ ndcX: 1, ndcY: -1, depth: 0.8 })],
  ])(
    "%s は人差し指の先（indexTip）を返さない（ボタンはマウスの位置＝手のひらの中心で判定される）",
    (_, s) => {
      const h = mockHandState(s);
      expect("indexTip" in h).toBe(false);
      expect(h.indexTip).toBeUndefined();
    },
  );

  it("21 点（形）を出していても indexTip は省く（形の 8 番を判定点にしない）", () => {
    const h = mockHandState(hand());
    expect(h.landmarks).toBeDefined();
    expect(h.indexTip).toBeUndefined();
  });
});
