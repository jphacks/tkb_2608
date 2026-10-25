// 配置の下書き（ES3）の AI の出力の検査（parseDraftBoxes）のテスト．
// 基準は docs/04_SPEC/SPEC_02「配置の下書き」と PR #168 で決めたこと（AI からは 0〜1000 の正規化座標
// box: [ymin, xmin, ymax, xmax] の矩形で受け取る．種類は room / corridor / outdoor / stairs / elevator）
import { describe, expect, it } from "vitest";
import {
  DRAFT_BOX_SCALE,
  DRAFT_ROOM_KINDS,
  MAX_DRAFT_ROOM_NAME_LENGTH,
  MAX_DRAFT_ROOMS,
  parseDraftBoxes,
} from "./floorDraftApi";

/** テスト用の矩形 1 つ（既定は名前付きの教室．一部だけ上書きできる） */
const item = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: "1年1組",
  kind: "room",
  box: [0, 0, 500, 500],
  ...overrides,
});

describe("parseDraftBoxes", () => {
  it("正しい矩形はそのまま返す", () => {
    const result = parseDraftBoxes({
      rooms: [item(), item({ name: "", kind: "corridor", box: [500, 0, 1000, 1000] })],
    });
    expect(result).toEqual([
      { name: "1年1組", kind: "room", box: [0, 0, 500, 500] },
      { name: "", kind: "corridor", box: [500, 0, 1000, 1000] },
    ]);
  });

  it.each(DRAFT_ROOM_KINDS)("種類 %s を受け付ける", (kind) => {
    expect(parseDraftBoxes({ rooms: [item({ kind })] })?.[0].kind).toBe(kind);
  });

  it("5 つの種類は room・corridor・outdoor・stairs・elevator", () => {
    expect([...DRAFT_ROOM_KINDS].sort()).toEqual(
      ["corridor", "elevator", "outdoor", "room", "stairs"].sort(),
    );
  });

  it.each<[string, unknown]>([
    ["null", null],
    ["undefined", undefined],
    ["数", 1],
    ["文字列", '{"rooms":[]}'],
    ["配列", [item()]],
    ["rooms が無い", {}],
    ["rooms が配列でない", { rooms: item() }],
    ["rooms が null", { rooms: null }],
    ["rooms が空", { rooms: [] }],
  ])("%s なら null", (_, value) => {
    expect(parseDraftBoxes(value)).toBeNull();
  });

  it("使える矩形が 1 つも無ければ null", () => {
    expect(
      parseDraftBoxes({ rooms: [item({ kind: "lava" }), item({ box: [0, 0, 1] })] }),
    ).toBeNull();
  });

  it.each<[string, unknown]>([
    ["知らない種類", { kind: "toilet" }],
    ["種類が大文字", { kind: "Room" }],
    ["種類が無い", { kind: undefined }],
    ["種類が数", { kind: 1 }],
  ])("%s の要素は捨てる", (_, overrides) => {
    const result = parseDraftBoxes({ rooms: [item(overrides as Record<string, unknown>), item()] });
    expect(result).toHaveLength(1);
    expect(result?.[0].kind).toBe("room");
  });

  it.each<[string, unknown]>([
    ["box が無い", undefined],
    ["box が配列でない", "0,0,10,10"],
    ["数が 3 つ", [0, 0, 10]],
    ["数が 5 つ", [0, 0, 10, 10, 10]],
    ["負の数", [-1, 0, 10, 10]],
    ["1000 を超える", [0, 0, 1001, 10]],
    ["NaN", [0, Number.NaN, 10, 10]],
    ["Infinity", [0, 0, Number.POSITIVE_INFINITY, 10]],
    ["数の文字列", ["0", "0", "10", "10"]],
    ["null を含む", [0, null, 10, 10]],
  ])("%s の要素は捨てる", (_, box) => {
    const result = parseDraftBoxes({ rooms: [item({ box }), item({ name: "残る" })] });
    expect(result?.map((r) => r.name)).toEqual(["残る"]);
  });

  it("座標の端の 0 と 1000 は受け付ける（小数も受け付ける）", () => {
    const result = parseDraftBoxes({ rooms: [item({ box: [0, 0.5, DRAFT_BOX_SCALE, 999.9] })] });
    expect(result?.[0].box).toEqual([0, 0.5, 1000, 999.9]);
  });

  it("配列でない要素（null・数・文字列）は捨てる", () => {
    const result = parseDraftBoxes({ rooms: [null, 1, "room", item()] });
    expect(result).toHaveLength(1);
  });

  it.each<[string, unknown]>([
    ["無い", undefined],
    ["数", 3],
    ["null", null],
    ["配列", ["1年1組"]],
  ])("名前が文字列でない（%s）なら空にする", (_, name) => {
    expect(parseDraftBoxes({ rooms: [item({ name })] })?.[0].name).toBe("");
  });

  it("名前の前後の空白は除く", () => {
    expect(parseDraftBoxes({ rooms: [item({ name: "  理科室 \n" })] })?.[0].name).toBe("理科室");
  });

  it(`名前は ${MAX_DRAFT_ROOM_NAME_LENGTH} 文字に切り詰める`, () => {
    const long = "あ".repeat(MAX_DRAFT_ROOM_NAME_LENGTH + 10);
    const exact = "い".repeat(MAX_DRAFT_ROOM_NAME_LENGTH);
    const result = parseDraftBoxes({ rooms: [item({ name: long }), item({ name: exact })] });
    expect(result?.[0].name).toBe("あ".repeat(MAX_DRAFT_ROOM_NAME_LENGTH));
    expect(result?.[1].name).toBe(exact);
  });

  it("要素の余計な項目は返さない", () => {
    const result = parseDraftBoxes({ rooms: [item({ extra: "x", confidence: 0.9 })] });
    expect(Object.keys(result?.[0] ?? {}).sort()).toEqual(["box", "kind", "name"]);
  });

  it(`矩形は最初の ${MAX_DRAFT_ROOMS} 個までしか受け取らない`, () => {
    const rooms = Array.from({ length: MAX_DRAFT_ROOMS + 5 }, (_, i) => item({ name: `r${i}` }));
    const result = parseDraftBoxes({ rooms });
    expect(result).toHaveLength(MAX_DRAFT_ROOMS);
    expect(result?.[0].name).toBe("r0");
    expect(result?.at(-1)?.name).toBe(`r${MAX_DRAFT_ROOMS - 1}`);
  });

  it("入力の box の配列をそのまま共有しない（写して返す）", () => {
    const box = [0, 0, 10, 10];
    const result = parseDraftBoxes({ rooms: [item({ box })] });
    box[0] = 999;
    expect(result?.[0].box[0]).toBe(0);
  });
});
