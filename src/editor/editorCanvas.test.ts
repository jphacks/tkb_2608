// エディタの上から見た図の描く順のテスト（下敷きの写真との重なり）．ピクセルは見ず，Canvas の操作の順と色だけを確かめる．
// 基準は docs/03_PLAN/PLAN_04_要件定義書.md の E1，Issue #135 で承認された見え方（写真がある間はマスの塗りを不透明のまま
// 白と半々に淡くし，写真は白黒の乗算で塗りの上に重ねる．延焼のプレビュー・マス線・壁・名前・経路・印は写真の上．
// Space を押している間（photoOnly）だけ塗りと延焼を隠して写真だけを見る）
import { describe, expect, it } from "vitest";
import type { Floor, Room } from "../core/schoolPlan";
import { createFloorFromRows } from "../share/samples/floorFromRows";
import type { SpreadMap } from "../sim";
import { drawEditorGrid, type SpreadOverlay } from "./editorCanvas";
import type { DrillMarkers, GridLayout } from "./editorLayout";
import type { AreaBounds } from "./editorState";
import {
  CELL_COLORS,
  EDITOR_COLORS,
  lightenColor,
  roomColor,
  UNDERLAY_FILL_LIGHTEN,
} from "./editorStyle";
import type { UnderlayOverlay } from "./underlay";

interface Call {
  readonly name: string;
  readonly args: readonly unknown[];
  readonly state: Readonly<Record<string, unknown>>;
}

/** Canvas の操作を順に記録する代わり．知らないメソッドは記録だけする．save / restore で状態を積む */
function recordingContext(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const state: Record<string, unknown> = {
    fillStyle: "#000000",
    strokeStyle: "#000000",
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    filter: "none",
  };
  const stack: Record<string, unknown>[] = [];
  const target: Record<string, unknown> = {};
  const ctx = new Proxy(target, {
    get(_, key: string) {
      if (key in state) return state[key];
      return (...args: unknown[]) => {
        if (key === "save") stack.push({ ...state });
        if (key === "restore") Object.assign(state, stack.pop() ?? {});
        if (key === "measureText") return { width: 10 };
        calls.push({ name: key, args, state: { ...state } });
        return undefined;
      };
    },
    set(_, key: string, value: unknown) {
      state[key] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

// 0: 教室，h: 廊下，o: 屋外，.: void
const FLOOR: Floor = createFloorFromRows(1, ["00h.", "hhho"]);
const ROOMS: readonly Room[] = [{ name: "1年1組" }];
const LAYOUT: GridLayout = { cellPx: 10, offsetX: 20, offsetY: 30 };
const MARKERS: DrillMarkers = {
  fireOrigins: [{ x: 0, z: 0 }],
  start: { x: 2, z: 1 },
  assembly: [{ x: 3, z: 1 }],
};
const IMAGE = { tag: "photo" } as unknown as CanvasImageSource;
const UNDERLAY: UnderlayOverlay = {
  image: IMAGE,
  size: { width: 400, height: 200 },
  placement: { centerX: 2, centerZ: 1, widthCells: 4, rotationDeg: 0 },
  opacity: 0.8,
};

/** 廊下の (1, 1) に火が着いている延焼 */
function spreadOverlay(): SpreadOverlay {
  const n = FLOOR.width * FLOOR.depth;
  const fire = Array<number>(n).fill(Infinity);
  fire[1 * FLOOR.width + 1] = 0;
  const smoke = Array<number>(n).fill(Infinity);
  smoke[1 * FLOOR.width + 1] = 0;
  const spread: SpreadMap = {
    fireSeconds: [fire],
    smokeSeconds: [smoke],
    fireAt: () => Infinity,
    smokeAt: () => Infinity,
  };
  return { spread, floorIndex: 0, atSeconds: 10 };
}

function draw(underlay: UnderlayOverlay | null, photoOnly = false, spread = true): Call[] {
  const { ctx, calls } = recordingContext();
  drawEditorGrid(
    ctx,
    FLOOR,
    ROOMS,
    LAYOUT,
    200,
    100,
    null,
    MARKERS,
    0,
    spread ? spreadOverlay() : null,
    {
      cells: [
        { x: 2, z: 1 },
        { x: 3, z: 1 },
      ],
      badSteps: [],
    },
    underlay,
    photoOnly,
  );
  return calls;
}

/** マス (x, z) を塗った fillRect の呼び出しの添字（なければ -1 を含む配列） */
function cellFills(calls: readonly Call[], x: number, z: number): number[] {
  const px = LAYOUT.offsetX + x * LAYOUT.cellPx;
  const pz = LAYOUT.offsetY + z * LAYOUT.cellPx;
  return calls
    .map((c, i) => ({ c, i }))
    .filter(
      ({ c }) =>
        c.name === "fillRect" &&
        c.args[0] === px &&
        c.args[1] === pz &&
        c.args[2] === LAYOUT.cellPx &&
        c.args[3] === LAYOUT.cellPx,
    )
    .map(({ i }) => i);
}

const drawImageIndex = (calls: readonly Call[]) => calls.findIndex((c) => c.name === "drawImage");

describe("drawEditorGrid（下敷きなし）", () => {
  it("写真を描かず，マスは元の色で塗る（void は塗らない）", () => {
    const calls = draw(null);
    expect(drawImageIndex(calls)).toBe(-1);
    expect(calls[cellFills(calls, 0, 0)[0]].state.fillStyle).toBe(roomColor(0));
    expect(calls[cellFills(calls, 2, 0)[0]].state.fillStyle).toBe(CELL_COLORS.corridor);
    expect(calls[cellFills(calls, 3, 1)[0]].state.fillStyle).toBe(CELL_COLORS.outdoor);
    expect(cellFills(calls, 3, 0)).toEqual([]);
  });

  it("photoOnly でも写真が無ければふだんどおり塗る", () => {
    const calls = draw(null, true);
    expect(calls[cellFills(calls, 0, 0)[0]].state.fillStyle).toBe(roomColor(0));
  });
});

describe("drawEditorGrid（下敷きあり）", () => {
  it("マスの塗りは不透明のまま白と半々に淡くした色（void も淡くした背景色で塗る）", () => {
    const calls = draw(UNDERLAY);
    const first = (x: number, z: number) => calls[cellFills(calls, x, z)[0]];
    expect(first(0, 0).state.fillStyle).toBe(lightenColor(roomColor(0), UNDERLAY_FILL_LIGHTEN));
    expect(first(2, 0).state.fillStyle).toBe(
      lightenColor(CELL_COLORS.corridor ?? "", UNDERLAY_FILL_LIGHTEN),
    );
    expect(first(3, 1).state.fillStyle).toBe(
      lightenColor(CELL_COLORS.outdoor ?? "", UNDERLAY_FILL_LIGHTEN),
    );
    expect(first(3, 0).state.fillStyle).toBe(
      lightenColor(EDITOR_COLORS.background, UNDERLAY_FILL_LIGHTEN),
    );
    // 半透明にしない
    expect(first(0, 0).state.globalAlpha).toBe(1);
  });

  it("写真は全部のマスの塗りの後に，白黒の乗算で描く", () => {
    const calls = draw(UNDERLAY);
    const img = drawImageIndex(calls);
    expect(img).toBeGreaterThan(-1);
    expect(calls[img].args[0]).toBe(IMAGE);
    expect(calls[img].state.globalCompositeOperation).toBe("multiply");
    expect(calls[img].state.filter).toBe("grayscale(1)");
    for (let z = 0; z < FLOOR.depth; z++) {
      for (let x = 0; x < FLOOR.width; x++) {
        const fills = cellFills(calls, x, z);
        expect(fills.length).toBeGreaterThan(0);
        expect(fills[0]).toBeLessThan(img);
      }
    }
  });

  it("延焼のプレビューは写真の上に，淡くしない色で重ねる", () => {
    const calls = draw(UNDERLAY);
    const img = drawImageIndex(calls);
    const fire = cellFills(calls, 1, 1).filter(
      (i) => calls[i].state.fillStyle === EDITOR_COLORS.spreadFire,
    );
    expect(fire).toHaveLength(1);
    expect(fire[0]).toBeGreaterThan(img);
  });

  it("線・文字（壁・マス線・名前・経路・印）は写真の後に，ふだんの重ね方で描く", () => {
    const calls = draw(UNDERLAY);
    const img = drawImageIndex(calls);
    const after = calls.slice(img + 1);
    for (const name of ["stroke", "fillText", "strokeRect"]) {
      expect(after.some((c) => c.name === name)).toBe(true);
    }
    // 写真の前に線・文字を描いていない（マス線は塗りの前の void 用の分を除く）
    expect(calls.slice(0, img).some((c) => c.name === "fillText")).toBe(false);
    for (const c of after) {
      expect(c.state.globalCompositeOperation).toBe("source-over");
      expect(c.state.filter).toBe("none");
    }
  });

  it("photoOnly の間はマスの塗りと延焼を隠し，白地に写真だけを見せる（線・印は残す）", () => {
    const calls = draw(UNDERLAY, true);
    const img = drawImageIndex(calls);
    expect(img).toBeGreaterThan(-1);
    for (let z = 0; z < FLOOR.depth; z++) {
      for (let x = 0; x < FLOOR.width; x++) {
        expect(cellFills(calls, x, z).filter((i) => i < img)).toEqual([]);
      }
    }
    expect(
      calls.some((c) => c.state.fillStyle === EDITOR_COLORS.spreadFire && c.name === "fillRect"),
    ).toBe(false);
    expect(
      calls
        .slice(0, img)
        .some(
          (c) => c.name === "fillRect" && String(c.state.fillStyle).toLowerCase() === "#ffffff",
        ),
    ).toBe(true);
    expect(calls.slice(img + 1).some((c) => c.name === "fillText")).toBe(true);
  });
});

describe("drawEditorGrid（集合場所のまとまり．Issue #167）", () => {
  // 屋外を広くとったマス目（o: 屋外）
  const YARD: Floor = createFloorFromRows(1, ["00hh", "oooo", "oooo"]);

  function drawYard(assembly: DrillMarkers["assembly"], area: AreaBounds | null = null): Call[] {
    const { ctx, calls } = recordingContext();
    drawEditorGrid(
      ctx,
      YARD,
      ROOMS,
      LAYOUT,
      200,
      100,
      null,
      { fireOrigins: [], start: null, assembly },
      0,
      null,
      null,
      null,
      false,
      area,
    );
    return calls;
  }
  /** 旗の三角を塗った回数（集合場所の緑で fill した回数） */
  const flagCount = (calls: readonly Call[]) =>
    calls.filter((c) => c.name === "fill" && c.state.fillStyle === EDITOR_COLORS.assembly).length;
  /** 集合場所の淡い塗り */
  const zoneFills = (calls: readonly Call[]) =>
    calls.filter((c) => c.name === "fillRect" && c.state.fillStyle === EDITOR_COLORS.assemblyFill);

  it("つながった集合場所は旗 1 つで，マスごとの枠を描かない", () => {
    const calls = drawYard([
      { x: 0, z: 1 },
      { x: 1, z: 1 },
      { x: 0, z: 2 },
      { x: 1, z: 2 },
    ]);
    expect(flagCount(calls)).toBe(1);
    expect(zoneFills(calls)).toHaveLength(4);
    // strokeRect はマス目の外枠の 1 回だけ（マスごとの枠は描かない）
    expect(calls.filter((c) => c.name === "strokeRect")).toHaveLength(1);
  });

  it("離れた集合場所はまとまりごとに旗を立てる", () => {
    const calls = drawYard([
      { x: 0, z: 1 },
      { x: 3, z: 2 },
    ]);
    expect(flagCount(calls)).toBe(2);
  });

  it("ドラッグ中の範囲は淡い塗りと破線の枠で重ね，描いた後に破線を戻す", () => {
    const calls = drawYard([], { minX: 1, minZ: 1, maxX: 2, maxZ: 2 });
    const fill = zoneFills(calls);
    expect(fill).toHaveLength(1);
    expect(fill[0].args).toEqual([
      LAYOUT.offsetX + LAYOUT.cellPx,
      LAYOUT.offsetY + LAYOUT.cellPx,
      2 * LAYOUT.cellPx,
      2 * LAYOUT.cellPx,
    ]);
    expect(calls.filter((c) => c.name === "setLineDash").at(-1)?.args).toEqual([[]]);
  });
});
