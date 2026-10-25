// 図面の写真の下敷き（E1）の純粋な関数のテスト．
// 基準は docs/03_PLAN/PLAN_04_要件定義書.md の E1（写真を半透明の下敷きにし，位置・大きさ・回転を合わせる），
// docs/04_SPEC/SPEC_01_画面遷移とモジュール構成.md の editor の行（下敷きの写真．保存はファイルと localStorage．サーバーは使わない），
// docs/04_SPEC/SPEC_02_校舎データの形式.md「配置の下書き」（座標: x は右，z は下．ES3 に渡す image は
// マス目に重なる範囲だけを切り出し，E1 で合わせた位置・大きさ・回転を反映した画像．切り出した範囲がそのままマス目に対応する），
// Issue #135（下敷きは SchoolPlan・URL・履歴に入れない・写真は保存しない・白黒の乗算で塗りの上に重ねる）
import { describe, expect, it } from "vitest";
import type { PlanStorageLike } from "./planStorage";
import {
  angleFromCenterDeg,
  CROP_BACKGROUND,
  canvasToGridPoint,
  clampOpacity,
  DEFAULT_UNDERLAY_OPACITY,
  drawUnderlay,
  drawUnderlayCrop,
  fitUnderlay,
  type GridPoint,
  gridToImage,
  type ImagePoint,
  type ImageSize,
  imageToGrid,
  initialUnderlay,
  isValidPlacement,
  loadUnderlayMemory,
  MAX_CROP_SIDE_PX,
  MAX_UNDERLAY_CENTER_OFFSET,
  MAX_UNDERLAY_WIDTH_CELLS,
  MIN_UNDERLAY_WIDTH_CELLS,
  moveUnderlay,
  normalizeDegrees,
  parseUnderlayMemory,
  rotateUnderlay,
  saveUnderlayMemory,
  scaleUnderlayAt,
  serializeUnderlayMemory,
  UNDERLAY_STORAGE_KEY,
  type UnderlayCropContext,
  type UnderlayMemory,
  type UnderlayOverlay,
  type UnderlayPlacement,
  underlayCropSize,
  updatePlacement,
} from "./underlay";

const placement = (patch: Partial<UnderlayPlacement> = {}): UnderlayPlacement => ({
  centerX: 10,
  centerZ: 8,
  widthCells: 20,
  rotationDeg: 0,
  ...patch,
});
const img = (width: number, height: number): ImageSize => ({ width, height });
const memory = (patch: Partial<UnderlayMemory> = {}): UnderlayMemory => ({
  fileName: "school.png",
  imageWidth: 2000,
  imageHeight: 1000,
  placement: placement(),
  opacity: 0.6,
  ...patch,
});

function expectPoint(actual: GridPoint, x: number, z: number): void {
  expect(actual.x).toBeCloseTo(x, 9);
  expect(actual.z).toBeCloseTo(z, 9);
}
function expectImagePoint(actual: ImagePoint, u: number, v: number): void {
  expect(actual.u).toBeCloseTo(u, 9);
  expect(actual.v).toBeCloseTo(v, 9);
}

describe("imageToGrid", () => {
  it("回転なしなら写真の中心が placement の中心に，4 隅が幅 widthCells・縦横比どおりの長方形の角に来る", () => {
    // 2000 × 1000 px を幅 20 マスで敷くと高さは 10 マス．中心 (10, 8)
    const p = placement();
    const size = img(2000, 1000);
    expectPoint(imageToGrid(p, size, { u: 1000, v: 500 }), 10, 8);
    expectPoint(imageToGrid(p, size, { u: 0, v: 0 }), 0, 3);
    expectPoint(imageToGrid(p, size, { u: 2000, v: 0 }), 20, 3);
    expectPoint(imageToGrid(p, size, { u: 0, v: 1000 }), 0, 13);
    expectPoint(imageToGrid(p, size, { u: 2000, v: 1000 }), 20, 13);
  });

  it("2000 × 1000 px を 40 × 30 マスに収めて 90 度回すと，右辺の中点 (2000, 500) が (20, 35) に来る（時計回り）", () => {
    const size = img(2000, 1000);
    const fitted = fitUnderlay(size, { width: 40, depth: 30 });
    const p = rotateUnderlay(fitted, 90);
    expectPoint(imageToGrid(p, size, { u: 2000, v: 500 }), 20, 35);
    // 上辺の中点は右へ（画面で時計回り: 上 → 右）
    expectPoint(imageToGrid(p, size, { u: 1000, v: 0 }), 30, 15);
  });

  it("回転は中心のまわりで，中心は動かない", () => {
    const size = img(800, 600);
    for (const deg of [-135, -45, 30, 90, 180]) {
      expectPoint(imageToGrid(placement({ rotationDeg: deg }), size, { u: 400, v: 300 }), 10, 8);
    }
  });

  it("-90 度では右辺の中点が中心の上（z が小さい側）に来る", () => {
    // 幅 20 マス．右辺の中点は中心から 10 マス
    expectPoint(
      imageToGrid(placement({ rotationDeg: -90 }), img(2000, 1000), {
        u: 2000,
        v: 500,
      }),
      10,
      -2,
    );
  });

  it("縦長の写真でも 1 画素は縦横同じ大きさ（縮尺は幅だけで決まる）", () => {
    const size = img(500, 1500);
    const p = placement({ widthCells: 5 });
    const a = imageToGrid(p, size, { u: 0, v: 0 });
    const b = imageToGrid(p, size, { u: 0, v: 1500 });
    expect(b.z - a.z).toBeCloseTo(15, 9);
    expect(b.x - a.x).toBeCloseTo(0, 9);
  });
});

describe("gridToImage", () => {
  it.each<[number, ImageSize]>([
    [0, img(2000, 1000)],
    [90, img(2000, 1000)],
    [-45, img(2000, 1000)],
    [30, img(600, 1800)],
    [180, img(1234, 567)],
    [-170, img(640, 640)],
  ])("imageToGrid と互いに戻る（回転 %s 度）", (deg, size) => {
    const p = placement({
      rotationDeg: deg,
      widthCells: 17.5,
      centerX: -3.25,
      centerZ: 42,
    });
    for (const pt of [
      { u: 0, v: 0 },
      { u: size.width, v: 0 },
      { u: size.width, v: size.height },
      { u: 123.4, v: 56.7 },
      { u: -500, v: 3000 },
    ]) {
      const g = imageToGrid(p, size, pt);
      expectImagePoint(gridToImage(p, size, g), pt.u, pt.v);
      const back = imageToGrid(p, size, gridToImage(p, size, { x: 7.5, z: -2 }));
      expectPoint(back, 7.5, -2);
    }
  });

  it("写真の外のマス目の座標も求める（範囲で切らない）", () => {
    const pt = gridToImage(placement(), img(2000, 1000), { x: -10, z: 8 });
    expectImagePoint(pt, -1000, 500);
  });
});

describe("canvasToGridPoint", () => {
  it("マス目の左上からの距離を 1 マスの大きさで割る（添字に丸めない・外も求める）", () => {
    const layout = { cellPx: 20, offsetX: 16, offsetY: 40 };
    expectPoint(canvasToGridPoint(layout, 16, 40), 0, 0);
    expectPoint(canvasToGridPoint(layout, 26, 50), 0.5, 0.5);
    expectPoint(canvasToGridPoint(layout, 216, 140), 10, 5);
    expectPoint(canvasToGridPoint(layout, 0, 0), -0.8, -2);
  });
});

describe("fitUnderlay", () => {
  it.each<[string, ImageSize, number, number]>([
    // 40 × 30 マスに 2000 × 1000 px: 幅で決まる → 40 × 20 マス
    ["横長", img(2000, 1000), 40, 20],
    // 40 × 30 マスに 1000 × 2000 px: 高さで決まる → 15 × 30 マス
    ["縦長", img(1000, 2000), 15, 30],
    // 40 × 30 マスに 400 × 300 px: ちょうど同じ縦横比 → 40 × 30 マス
    ["同じ縦横比", img(400, 300), 40, 30],
  ])("%s: 回転なしで写真全体がマス目全体に収まる最大の大きさにし，中央に置く", (_, size, w, h) => {
    const grid = { width: 40, depth: 30 };
    const p = fitUnderlay(size, grid);
    expect(p.rotationDeg).toBe(0);
    expect(p.centerX).toBe(20);
    expect(p.centerZ).toBe(15);
    expect(p.widthCells).toBeCloseTo(w, 9);
    // 高さ（縦横比から）がマス目に収まる
    const height = (p.widthCells * size.height) / size.width;
    expect(height).toBeCloseTo(h, 9);
    expect(p.widthCells).toBeLessThanOrEqual(grid.width + 1e-9);
    expect(height).toBeLessThanOrEqual(grid.depth + 1e-9);
    // 4 隅がマス目の中
    for (const c of [
      { u: 0, v: 0 },
      { u: size.width, v: size.height },
    ]) {
      const g = imageToGrid(p, size, c);
      expect(g.x).toBeGreaterThanOrEqual(-1e-9);
      expect(g.x).toBeLessThanOrEqual(grid.width + 1e-9);
      expect(g.z).toBeGreaterThanOrEqual(-1e-9);
      expect(g.z).toBeLessThanOrEqual(grid.depth + 1e-9);
    }
  });

  it("結果は位置として受け付けられる", () => {
    expect(isValidPlacement(fitUnderlay(img(2000, 1000), { width: 40, depth: 30 }))).toBe(true);
  });
});

describe("moveUnderlay", () => {
  it("中心を (dx, dz) マスずらし，幅と回転は変えない", () => {
    expect(moveUnderlay(placement({ rotationDeg: 30 }), 2.5, -3)).toEqual(
      placement({ centerX: 12.5, centerZ: 5, rotationDeg: 30 }),
    );
  });

  it.each([NaN, Infinity, -Infinity])("数でないずれ（%s）では動かない", (bad) => {
    const p = placement();
    expect(moveUnderlay(p, bad, 1)).toEqual(p);
    expect(moveUnderlay(p, 1, bad)).toEqual(p);
  });

  it("中心はマス目から離れてよい範囲の外に出ない", () => {
    const p = moveUnderlay(placement(), 1e9, -1e9);
    expect(isValidPlacement(p)).toBe(true);
    expect(Math.abs(p.centerX)).toBeLessThanOrEqual(MAX_UNDERLAY_CENTER_OFFSET);
    expect(Math.abs(p.centerZ)).toBeLessThanOrEqual(MAX_UNDERLAY_CENTER_OFFSET);
  });
});

describe("scaleUnderlayAt", () => {
  const size = img(2000, 1000);

  it.each<[number, GridPoint, number]>([
    [2, { x: 3, z: 4 }, 0],
    [0.5, { x: 15, z: 7 }, 0],
    [1.25, { x: 0, z: 0 }, 37],
    [0.8, { x: 10, z: 8 }, -90],
  ])("倍率 %s: pivot に重なる写真の画素は動かない", (factor, pivot, deg) => {
    const p = placement({ rotationDeg: deg });
    const before = gridToImage(p, size, pivot);
    const next = scaleUnderlayAt(p, factor, pivot);
    expect(next.widthCells).toBeCloseTo(p.widthCells * factor, 9);
    expect(next.rotationDeg).toBe(deg);
    expectPoint(imageToGrid(next, size, before), pivot.x, pivot.z);
  });

  it("中心は pivot から倍率の分だけ離れる", () => {
    const next = scaleUnderlayAt(placement(), 2, { x: 0, z: 0 });
    expect(next.centerX).toBeCloseTo(20, 9);
    expect(next.centerZ).toBeCloseTo(16, 9);
  });

  it("中心で拡大すれば中心は動かない", () => {
    const next = scaleUnderlayAt(placement(), 3, { x: 10, z: 8 });
    expect(next.centerX).toBeCloseTo(10, 9);
    expect(next.centerZ).toBeCloseTo(8, 9);
  });

  it("幅は下限で止まり，その時も pivot は動かない", () => {
    const p = placement();
    const pivot = { x: 4, z: 6 };
    const before = gridToImage(p, size, pivot);
    const next = scaleUnderlayAt(p, 0.0001, pivot);
    expect(next.widthCells).toBe(MIN_UNDERLAY_WIDTH_CELLS);
    expectPoint(imageToGrid(next, size, before), pivot.x, pivot.z);
  });

  it("幅は上限で止まる", () => {
    const next = scaleUnderlayAt(placement(), 1e6, { x: 10, z: 8 });
    expect(next.widthCells).toBe(MAX_UNDERLAY_WIDTH_CELLS);
    expect(isValidPlacement(next)).toBe(true);
  });

  it.each([0, -1, NaN, Infinity, -Infinity])("不正な倍率（%s）では変わらない", (factor) => {
    const p = placement();
    expect(scaleUnderlayAt(p, factor, { x: 1, z: 1 })).toEqual(p);
  });

  it("pivot が数でなければ変わらない", () => {
    const p = placement();
    expect(scaleUnderlayAt(p, 2, { x: NaN, z: 1 })).toEqual(p);
    expect(scaleUnderlayAt(p, 2, { x: 1, z: Infinity })).toEqual(p);
  });
});

describe("angleFromCenterDeg", () => {
  it.each<[GridPoint, number]>([
    [{ x: 15, z: 8 }, 0],
    // z は下が正．画面で下は時計回りに 90 度
    [{ x: 10, z: 13 }, 90],
    [{ x: 10, z: 3 }, -90],
    [{ x: 15, z: 13 }, 45],
  ])("中心から見た %o の向きは %s 度（画面で時計回りが正）", (pt, deg) => {
    expect(angleFromCenterDeg(placement(), pt)).toBeCloseTo(deg, 9);
  });

  it("左向きは ±180 度", () => {
    const a = angleFromCenterDeg(placement(), { x: 0, z: 8 });
    expect(Math.abs(a ?? 0)).toBeCloseTo(180, 9);
  });

  it("中心と同じ点・数でない点は null", () => {
    expect(angleFromCenterDeg(placement(), { x: 10, z: 8 })).toBeNull();
    expect(angleFromCenterDeg(placement(), { x: NaN, z: 8 })).toBeNull();
  });

  it("回転の差に使える: 2 点の向きの差だけ回すと，最初の点の向きの画素が次の点の向きに来る", () => {
    const p = placement();
    const size = img(2000, 1000);
    const from = { x: 15, z: 8 };
    const to = { x: 10, z: 13 };
    const delta = (angleFromCenterDeg(p, to) ?? 0) - (angleFromCenterDeg(p, from) ?? 0);
    const pix = gridToImage(p, size, from);
    expectPoint(imageToGrid(rotateUnderlay(p, delta), size, pix), 10, 13);
  });
});

describe("normalizeDegrees", () => {
  it.each<[number, number]>([
    [0, 0],
    [90, 90],
    [180, 180],
    [-180, 180],
    [181, -179],
    [-181, 179],
    [360, 0],
    [540, 180],
    [-540, 180],
    [720 + 45, 45],
    [-90, -90],
  ])("%s 度は %s 度にそろう（(-180, 180]）", (deg, expected) => {
    expect(normalizeDegrees(deg)).toBeCloseTo(expected, 9);
  });

  it("-0 は 0（表示に -0 を出さない）", () => {
    expect(Object.is(normalizeDegrees(-0), 0)).toBe(true);
    expect(Object.is(normalizeDegrees(-360), 0)).toBe(true);
  });

  it.each([NaN, Infinity, -Infinity])("数でない %s は 0", (deg) => {
    expect(normalizeDegrees(deg)).toBe(0);
  });
});

describe("rotateUnderlay", () => {
  it("回転だけを足し，(-180, 180] にそろえる（中心・幅は変えない）", () => {
    expect(rotateUnderlay(placement({ rotationDeg: 170 }), 20)).toEqual(
      placement({ rotationDeg: -170 }),
    );
    expect(rotateUnderlay(placement({ rotationDeg: -170 }), -10).rotationDeg).toBe(180);
  });

  it.each([NaN, Infinity])("数でない回転（%s）では変わらない", (d) => {
    const p = placement({ rotationDeg: 12 });
    expect(rotateUnderlay(p, d)).toEqual(p);
  });
});

describe("updatePlacement", () => {
  it("入れた値を当てはめ，回転をそろえる", () => {
    expect(updatePlacement(placement(), { centerX: 3, rotationDeg: 270 })).toEqual(
      placement({ centerX: 3, rotationDeg: -90 }),
    );
  });

  it("範囲の端は受け付ける", () => {
    expect(updatePlacement(placement(), { widthCells: MIN_UNDERLAY_WIDTH_CELLS })).not.toBeNull();
    expect(updatePlacement(placement(), { widthCells: MAX_UNDERLAY_WIDTH_CELLS })).not.toBeNull();
    expect(updatePlacement(placement(), { centerX: -MAX_UNDERLAY_CENTER_OFFSET })).not.toBeNull();
    expect(updatePlacement(placement(), { centerZ: MAX_UNDERLAY_CENTER_OFFSET })).not.toBeNull();
  });

  it.each<[string, Partial<UnderlayPlacement>]>([
    ["中心 X が NaN", { centerX: NaN }],
    ["中心 Z が Infinity", { centerZ: Infinity }],
    ["幅が NaN", { widthCells: NaN }],
    ["回転が NaN", { rotationDeg: NaN }],
    ["回転が Infinity", { rotationDeg: Infinity }],
    ["幅が 0", { widthCells: 0 }],
    ["幅が負", { widthCells: -5 }],
    ["幅が下限より小さい", { widthCells: MIN_UNDERLAY_WIDTH_CELLS - 0.01 }],
    ["幅が上限より大きい", { widthCells: MAX_UNDERLAY_WIDTH_CELLS + 0.01 }],
    ["中心がマス目から遠すぎる（+）", { centerX: MAX_UNDERLAY_CENTER_OFFSET + 1 }],
    ["中心がマス目から遠すぎる（-）", { centerZ: -MAX_UNDERLAY_CENTER_OFFSET - 1 }],
  ])("%s なら null", (_, patch) => {
    expect(updatePlacement(placement(), patch)).toBeNull();
  });

  it("元の位置は書き換えない", () => {
    const p = Object.freeze(placement());
    updatePlacement(p, { centerX: 1 });
    expect(p).toEqual(placement());
  });
});

describe("clampOpacity", () => {
  it.each<[number, number]>([
    [0, 0],
    [0.3, 0.3],
    [1, 1],
    [-0.5, 0],
    [1.5, 1],
    [NaN, DEFAULT_UNDERLAY_OPACITY],
  ])("%s は %s", (v, expected) => {
    expect(clampOpacity(v)).toBe(expected);
  });

  it("既定値は 0〜1 の中", () => {
    expect(DEFAULT_UNDERLAY_OPACITY).toBeGreaterThan(0);
    expect(DEFAULT_UNDERLAY_OPACITY).toBeLessThanOrEqual(1);
  });
});

/** Canvas の操作を順に記録する代わり（save / restore で状態を積む） */
function fakeContext(initial: Partial<{ alpha: number; composite: string; filter: string }> = {}) {
  const calls: {
    name: string;
    args: unknown[];
    state: Record<string, unknown>;
  }[] = [];
  const stack: Record<string, unknown>[] = [];
  const state: Record<string, unknown> = {
    globalAlpha: initial.alpha ?? 1,
    globalCompositeOperation: initial.composite ?? "source-over",
    filter: initial.filter ?? "none",
    fillStyle: "#000000",
  };
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push({ name, args, state: { ...state } });
    };
  const ctx = {
    get globalAlpha() {
      return state.globalAlpha as number;
    },
    set globalAlpha(v: number) {
      state.globalAlpha = v;
    },
    get globalCompositeOperation() {
      return state.globalCompositeOperation as GlobalCompositeOperation;
    },
    set globalCompositeOperation(v: GlobalCompositeOperation) {
      state.globalCompositeOperation = v;
    },
    get filter() {
      return state.filter as string;
    },
    set filter(v: string) {
      state.filter = v;
    },
    get fillStyle() {
      return state.fillStyle as string;
    },
    set fillStyle(v: string) {
      state.fillStyle = v;
    },
    save() {
      stack.push({ ...state });
      record("save")();
    },
    restore() {
      Object.assign(state, stack.pop() ?? {});
      record("restore")();
    },
    transform: record("transform"),
    drawImage: record("drawImage"),
    fillRect: record("fillRect"),
  };
  return { ctx: ctx as unknown as UnderlayCropContext, calls, state };
}

const IMAGE = { tag: "image" } as unknown as CanvasImageSource;
const overlay = (patch: Partial<UnderlayOverlay> = {}): UnderlayOverlay => ({
  image: IMAGE,
  size: img(2000, 1000),
  placement: placement(),
  opacity: 0.4,
  ...patch,
});

/** transform の呼び出しを順に掛け合わせ，写真の画素 (u, v) が Canvas のどこに描かれるかを求める */
function canvasPointOf(
  calls: { name: string; args: unknown[] }[],
  u: number,
  v: number,
): { x: number; y: number } {
  // 後から掛けた変換ほど先に効く（Canvas の transform の約束）
  const ts = calls.filter((c) => c.name === "transform").map((c) => c.args as number[]);
  let x = u;
  let y = v;
  for (let i = ts.length - 1; i >= 0; i--) {
    const [a, b, c, d, e, f] = ts[i];
    [x, y] = [a * x + c * y + e, b * x + d * y + f];
  }
  return { x, y };
}

describe("drawUnderlay", () => {
  it("写真の全体を，マス目の座標 → Canvas（origin・cellPx）の変換で描く", () => {
    const { ctx, calls } = fakeContext();
    const o = overlay({ placement: placement({ rotationDeg: 90 }) });
    drawUnderlay(ctx, o, 16, 40, 12);
    const draw = calls.find((c) => c.name === "drawImage");
    expect(draw?.args).toEqual([IMAGE, 0, 0, 2000, 1000]);
    // 写真の画素がマス目の座標に重なる位置を，Canvas の px にしたもの
    for (const pt of [
      { u: 0, v: 0 },
      { u: 2000, v: 500 },
      { u: 1000, v: 1000 },
    ]) {
      const g = imageToGrid(o.placement, o.size, pt);
      const c = canvasPointOf(calls, pt.u, pt.v);
      expect(c.x).toBeCloseTo(16 + g.x * 12, 6);
      expect(c.y).toBeCloseTo(40 + g.z * 12, 6);
    }
  });

  it("変換は save の後・drawImage の前に掛け，restore で戻す", () => {
    const { ctx, calls } = fakeContext();
    drawUnderlay(ctx, overlay(), 0, 0, 10);
    const names = calls.map((c) => c.name);
    const save = names.indexOf("save");
    const draw = names.indexOf("drawImage");
    const restore = names.lastIndexOf("restore");
    expect(save).toBeGreaterThanOrEqual(0);
    expect(draw).toBeGreaterThan(save);
    expect(restore).toBeGreaterThan(draw);
    names.forEach((n, i) => {
      if (n === "transform") {
        expect(i).toBeGreaterThan(save);
        expect(i).toBeLessThan(draw);
      }
    });
  });

  it("不透明度で描き，0〜1 の外は丸める", () => {
    for (const [opacity, expected] of [
      [0.4, 0.4],
      [2, 1],
      [-1, 0],
    ]) {
      const { ctx, calls } = fakeContext();
      drawUnderlay(ctx, overlay({ opacity }), 0, 0, 10);
      expect(calls.find((c) => c.name === "drawImage")?.state.globalAlpha).toBe(expected);
    }
  });

  it("lines では白黒にして乗算で重ねる", () => {
    const { ctx, calls } = fakeContext();
    drawUnderlay(ctx, overlay(), 0, 0, 10, "lines");
    const draw = calls.find((c) => c.name === "drawImage");
    expect(draw?.state.filter).toBe("grayscale(1)");
    expect(draw?.state.globalCompositeOperation).toBe("multiply");
  });

  it("plain（既定）では重ね方・フィルターを変えない", () => {
    const { ctx, calls } = fakeContext({
      composite: "source-over",
      filter: "none",
    });
    drawUnderlay(ctx, overlay(), 0, 0, 10);
    const draw = calls.find((c) => c.name === "drawImage");
    expect(draw?.state.filter).toBe("none");
    expect(draw?.state.globalCompositeOperation).toBe("source-over");
  });

  it.each<["plain" | "lines"]>([["plain"], ["lines"]])(
    "%s: 描いた後は不透明度・重ね方・フィルターが描く前の値に戻る（後の壁・印に影響しない）",
    (blend) => {
      const { ctx, state } = fakeContext({
        alpha: 0.7,
        composite: "source-atop",
        filter: "blur(1px)",
      });
      drawUnderlay(ctx, overlay(), 0, 0, 10, blend);
      expect(state.globalAlpha).toBe(0.7);
      expect(state.globalCompositeOperation).toBe("source-atop");
      expect(state.filter).toBe("blur(1px)");
    },
  );

  it("restore が状態を戻さない Canvas でも，描いた後は描く前の値に戻る", () => {
    const { ctx, state } = fakeContext();
    // restore を何もしないものに差し替える
    (ctx as unknown as { restore: () => void }).restore = () => {};
    drawUnderlay(ctx, overlay(), 0, 0, 10, "lines");
    expect(state.globalAlpha).toBe(1);
    expect(state.globalCompositeOperation).toBe("source-over");
    expect(state.filter).toBe("none");
  });
});

describe("underlayCropSize", () => {
  it.each<[number, number, number, number, number]>([
    // [マス目の幅, 奥行き, 画像の幅, 高さ, 1 マスの px]
    [40, 30, 2048, 1536, 51.2],
    [30, 40, 1536, 2048, 51.2],
    [32, 32, 2048, 2048, 64],
    [100, 5, 2048, 102, 20.48],
    [3, 200, 31, 2048, 10.24],
  ])("%s × %s マス: 長い辺を 2048 px にそろえ，縦横比はマス目どおり", (w, d, cw, ch, cell) => {
    const c = underlayCropSize({ width: w, depth: d });
    expect(c.width).toBe(cw);
    expect(c.height).toBe(ch);
    expect(c.cellPx).toBeCloseTo(cell, 9);
    expect(Math.max(c.width, c.height)).toBe(MAX_CROP_SIDE_PX);
  });

  it("上限を渡せる", () => {
    expect(underlayCropSize({ width: 20, depth: 10 }, 512)).toEqual({
      width: 512,
      height: 256,
      cellPx: 25.6,
    });
  });

  it("極端に細長いマス目でも短い辺は 1 px 以上", () => {
    const c = underlayCropSize({ width: 10_000, depth: 1 });
    expect(c.height).toBeGreaterThanOrEqual(1);
    expect(c.width).toBe(MAX_CROP_SIDE_PX);
  });

  it("切り出しの範囲がそのままマス目に対応する（画像の幅・高さ ÷ 1 マスの px がマス目の数）", () => {
    const c = underlayCropSize({ width: 40, depth: 30 });
    expect(c.width / c.cellPx).toBeCloseTo(40, 9);
    expect(c.height / c.cellPx).toBeCloseTo(30, 9);
  });
});

describe("drawUnderlayCrop", () => {
  it("先に画像の全体を白で塗り，その上に写真を描く", () => {
    const { ctx, calls } = fakeContext();
    const crop = underlayCropSize({ width: 40, depth: 30 });
    drawUnderlayCrop(ctx, overlay(), crop);
    const fill = calls.findIndex((c) => c.name === "fillRect");
    const draw = calls.findIndex((c) => c.name === "drawImage");
    expect(fill).toBeGreaterThanOrEqual(0);
    expect(fill).toBeLessThan(draw);
    expect(calls[fill].args).toEqual([0, 0, crop.width, crop.height]);
    expect(calls[fill].state.fillStyle).toBe(CROP_BACKGROUND);
    expect(CROP_BACKGROUND.toLowerCase()).toBe("#ffffff");
  });

  it("E1 で合わせた位置・大きさ・回転を反映する（マス目の左上が画像の (0, 0)，1 マスが cellPx）", () => {
    const { ctx, calls } = fakeContext();
    const crop = underlayCropSize({ width: 40, depth: 30 });
    const o = overlay({
      placement: placement({ rotationDeg: -30, centerX: 18, widthCells: 25 }),
    });
    drawUnderlayCrop(ctx, o, crop);
    for (const pt of [
      { u: 0, v: 0 },
      { u: 2000, v: 1000 },
      { u: 700, v: 300 },
    ]) {
      const g = imageToGrid(o.placement, o.size, pt);
      const c = canvasPointOf(calls, pt.u, pt.v);
      expect(c.x).toBeCloseTo(g.x * crop.cellPx, 6);
      expect(c.y).toBeCloseTo(g.z * crop.cellPx, 6);
    }
  });

  it("下敷きの不透明度によらず，そのままの濃さ・重ね方で描く", () => {
    const { ctx, calls } = fakeContext();
    drawUnderlayCrop(ctx, overlay({ opacity: 0.2 }), underlayCropSize({ width: 4, depth: 3 }));
    const draw = calls.find((c) => c.name === "drawImage");
    expect(draw?.state.globalAlpha).toBe(1);
    expect(draw?.state.globalCompositeOperation).toBe("source-over");
    expect(draw?.state.filter).toBe("none");
  });
});

describe("parseUnderlayMemory / serializeUnderlayMemory", () => {
  it("書いたものを読むと元に戻る", () => {
    const m = memory({
      placement: placement({ rotationDeg: -45, centerX: -3.5 }),
    });
    expect(parseUnderlayMemory(serializeUnderlayMemory(m))).toEqual(m);
  });

  it("写真そのもの（画素）は書かない", () => {
    const text = serializeUnderlayMemory(memory());
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(
      ["fileName", "imageHeight", "imageWidth", "opacity", "placement"].sort(),
    );
  });

  it("不透明度は 0〜1 に丸め，回転はそろえる", () => {
    const text = JSON.stringify({
      ...memory(),
      opacity: 3,
      placement: placement({ rotationDeg: 270 }),
    });
    const m = parseUnderlayMemory(text);
    expect(m?.opacity).toBe(1);
    expect(m?.placement.rotationDeg).toBe(-90);
  });

  const base = () => JSON.parse(serializeUnderlayMemory(memory())) as Record<string, unknown>;
  it.each<[string, string | null]>([
    ["null", null],
    ["空文字", ""],
    ["壊れた JSON", "{"],
    ["配列", "[]"],
    ["数", "3"],
    ["null の JSON", "null"],
    ["ファイル名が無い", JSON.stringify({ ...base(), fileName: undefined })],
    ["ファイル名が数", JSON.stringify({ ...base(), fileName: 1 })],
    ["画像の幅が 0", JSON.stringify({ ...base(), imageWidth: 0 })],
    ["画像の高さが負", JSON.stringify({ ...base(), imageHeight: -1 })],
    ["画像の幅が文字", JSON.stringify({ ...base(), imageWidth: "2000" })],
    ["不透明度が無い", JSON.stringify({ ...base(), opacity: undefined })],
    ["placement が無い", JSON.stringify({ ...base(), placement: undefined })],
    ["placement が配列", JSON.stringify({ ...base(), placement: [1, 2, 3, 4] })],
    [
      "placement の項目が欠けている",
      JSON.stringify({
        ...base(),
        placement: { centerX: 1, centerZ: 1, widthCells: 5 },
      }),
    ],
    [
      "幅が範囲の外",
      JSON.stringify({
        ...base(),
        placement: placement({ widthCells: MAX_UNDERLAY_WIDTH_CELLS * 2 }),
      }),
    ],
    ["幅が 0", JSON.stringify({ ...base(), placement: placement({ widthCells: 0 }) })],
    [
      "中心が遠すぎる",
      JSON.stringify({
        ...base(),
        placement: placement({ centerX: MAX_UNDERLAY_CENTER_OFFSET * 2 }),
      }),
    ],
    [
      "中心が文字",
      JSON.stringify({
        ...base(),
        placement: { ...placement(), centerZ: "1" },
      }),
    ],
  ])("%s なら null（例外を投げない）", (_, text) => {
    expect(() => parseUnderlayMemory(text)).not.toThrow();
    expect(parseUnderlayMemory(text)).toBeNull();
  });
});

describe("initialUnderlay", () => {
  const grid = { width: 40, depth: 30 };

  it("前回と同じ名前・同じ大きさの写真なら前回の位置と不透明度", () => {
    const m = memory();
    expect(initialUnderlay(m, "school.png", img(2000, 1000), grid)).toEqual({
      placement: m.placement,
      opacity: m.opacity,
      restored: true,
    });
  });

  it.each<[string, string, ImageSize]>([
    ["名前が違う", "other.png", img(2000, 1000)],
    ["幅が違う", "school.png", img(2001, 1000)],
    ["高さが違う", "school.png", img(2000, 999)],
  ])("%s なら写真全体をマス目に収める（不透明度は前回のまま）", (_, name, size) => {
    const r = initialUnderlay(memory(), name, size, grid);
    expect(r.restored).toBe(false);
    expect(r.placement).toEqual(fitUnderlay(size, grid));
    expect(r.opacity).toBe(0.6);
  });

  it("前回が無ければ写真全体をマス目に収め，不透明度は既定値", () => {
    const r = initialUnderlay(null, "school.png", img(2000, 1000), grid);
    expect(r).toEqual({
      placement: fitUnderlay(img(2000, 1000), grid),
      opacity: DEFAULT_UNDERLAY_OPACITY,
      restored: false,
    });
  });
});

describe("loadUnderlayMemory / saveUnderlayMemory", () => {
  const mapStorage = (): PlanStorageLike & { map: Map<string, string> } => {
    const map = new Map<string, string>();
    return {
      map,
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => {
        map.set(k, v);
      },
    };
  };
  const throwing: PlanStorageLike = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("quota");
    },
  };

  it("保存したものを読める（校舎のキーとは別のキー）", () => {
    const s = mapStorage();
    saveUnderlayMemory(s, memory());
    expect([...s.map.keys()]).toEqual([UNDERLAY_STORAGE_KEY]);
    expect(UNDERLAY_STORAGE_KEY).not.toBe("tkb2608.editor.plan");
    expect(loadUnderlayMemory(s)).toEqual(memory());
  });

  it("何も保存していなければ null", () => {
    expect(loadUnderlayMemory(mapStorage())).toBeNull();
  });

  it("Storage が無い・例外を投げる時も例外を投げない", () => {
    expect(loadUnderlayMemory(null)).toBeNull();
    expect(() => saveUnderlayMemory(null, memory())).not.toThrow();
    expect(loadUnderlayMemory(throwing)).toBeNull();
    expect(() => saveUnderlayMemory(throwing, memory())).not.toThrow();
  });

  it("壊れた値が入っていれば null", () => {
    const s = mapStorage();
    s.map.set(UNDERLAY_STORAGE_KEY, "not json");
    expect(loadUnderlayMemory(s)).toBeNull();
  });
});
