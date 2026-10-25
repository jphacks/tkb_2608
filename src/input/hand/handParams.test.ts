// 手のしきい値の既定値・上書き・URL パラメータ（experiment_山﨑/07 の値）
import { describe, expect, it } from "vitest";
import { DEFAULT_HAND_PARAMS, handParamsFromSearch, mergeHandParams } from "./handParams";

describe("DEFAULT_HAND_PARAMS", () => {
  it("仕様の値: 握る 0.6／離す 0.4・2 回で表示・0.3 秒で消す・握ったまま約 0.5〜1 秒・外挿 80 ms・15→10→7 回/秒・30 fps", () => {
    expect(DEFAULT_HAND_PARAMS.gripOn).toBe(0.6);
    expect(DEFAULT_HAND_PARAMS.gripOff).toBe(0.4);
    expect(DEFAULT_HAND_PARAMS.trackAppearCount).toBe(2);
    expect(DEFAULT_HAND_PARAMS.trackLostMs).toBe(300);
    expect(DEFAULT_HAND_PARAMS.gripHoldMs).toBeGreaterThanOrEqual(500);
    expect(DEFAULT_HAND_PARAMS.gripHoldMs).toBeLessThanOrEqual(1000);
    expect(DEFAULT_HAND_PARAMS.extrapolateMaxMs).toBe(80);
    expect(DEFAULT_HAND_PARAMS.rateLevelsHz).toEqual([15, 10, 7]);
    expect(DEFAULT_HAND_PARAMS.rateDownFps).toBe(30);
    expect(DEFAULT_HAND_PARAMS.pointConfirmCount).toBe(2);
  });

  it("ヒステリシスの向きが正しい（入る値と出る値が逆になっていない）", () => {
    const p = DEFAULT_HAND_PARAMS;
    expect(p.gripOff).toBeLessThan(p.gripOn);
    expect(p.pinchOnRatio).toBeLessThan(p.pinchOffRatio);
    expect(p.fingerClosedRatio).toBeLessThan(p.fingerOpenRatio);
    expect(p.minDepthM).toBeLessThan(p.maxDepthM);
    expect(p.rateUpFps).toBeGreaterThan(p.rateDownFps);
    expect(p.rateUpHoldMs).toBeGreaterThan(p.rateDownHoldMs);
    // 握ったまま見失った時は，開いた手より長く保つ
    expect(p.gripHoldMs).toBeGreaterThan(p.trackLostMs);
  });
});

describe("mergeHandParams", () => {
  it("null・undefined なら元のまま", () => {
    expect(mergeHandParams(DEFAULT_HAND_PARAMS, null)).toBe(DEFAULT_HAND_PARAMS);
    expect(mergeHandParams(DEFAULT_HAND_PARAMS, undefined)).toBe(DEFAULT_HAND_PARAMS);
  });

  it("有限の数の項目だけを上書きし，元は変えない", () => {
    const out = mergeHandParams(DEFAULT_HAND_PARAMS, { cameraHfovDeg: 60, oneEuroBeta: 2 });
    expect(out.cameraHfovDeg).toBe(60);
    expect(out.oneEuroBeta).toBe(2);
    expect(out.gripOn).toBe(DEFAULT_HAND_PARAMS.gripOn);
    expect(DEFAULT_HAND_PARAMS.cameraHfovDeg).toBe(65);
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["文字列", "60"],
    ["null", null],
    ["真偽値", true],
  ])("%s の値は無視する", (_, v) => {
    expect(mergeHandParams(DEFAULT_HAND_PARAMS, { cameraHfovDeg: v }).cameraHfovDeg).toBe(65);
  });

  it("知らない項目は無視する", () => {
    const out = mergeHandParams(DEFAULT_HAND_PARAMS, { unknown: 1, stepHighStanding: 2 });
    expect(out).toEqual(DEFAULT_HAND_PARAMS);
    expect("unknown" in out).toBe(false);
  });

  it("rateLevelsHz は正の有限の数の配列の時だけ上書きし，複製する", () => {
    const levels = [12, 6];
    const out = mergeHandParams(DEFAULT_HAND_PARAMS, { rateLevelsHz: levels });
    expect(out.rateLevelsHz).toEqual([12, 6]);
    expect(out.rateLevelsHz).not.toBe(levels);
  });

  it.each([
    ["空の配列", []],
    ["0 を含む", [15, 0]],
    ["負の数を含む", [15, -1]],
    ["NaN を含む", [15, Number.NaN]],
    ["文字列を含む", [15, "10"]],
    ["配列でない", 15],
  ])("rateLevelsHz が %s なら無視する", (_, v) => {
    expect(mergeHandParams(DEFAULT_HAND_PARAMS, { rateLevelsHz: v }).rateLevelsHz).toEqual([
      15, 10, 7,
    ]);
  });
});

describe("handParamsFromSearch", () => {
  it("項目名の URL パラメータを数にする", () => {
    expect(handParamsFromSearch("?cameraHfovDeg=60&oneEuroBeta=2")).toEqual({
      cameraHfovDeg: 60,
      oneEuroBeta: 2,
    });
  });

  it.each([
    "",
    "?",
    "?cameraHfovDeg=",
    "?cameraHfovDeg=%20",
    "?cameraHfovDeg=abc",
    "?cameraHfovDeg=NaN",
    "?cameraHfovDeg=Infinity",
    "?unknown=1",
    "?CameraHfovDeg=60",
  ])("%s → 何も上書きしない", (search) => {
    expect(handParamsFromSearch(search)).toEqual({});
  });

  it("rateLevelsHz は URL からは読まない", () => {
    expect(handParamsFromSearch("?rateLevelsHz=10")).toEqual({});
  });

  it("負の数・小数も読む", () => {
    expect(handParamsFromSearch("?cameraOffsetZM=-0.1&gripOn=0.65")).toEqual({
      cameraOffsetZM: -0.1,
      gripOn: 0.65,
    });
  });

  it("他の URL パラメータと混ざっていても読める", () => {
    expect(handParamsFromSearch("?worker=0&gripOff=0.35&scene=room")).toEqual({ gripOff: 0.35 });
  });
});

describe("描く 21 点・認識に渡す画像の項目", () => {
  it("既定値: 固定の奥行き 1.2 m・z の倍率 1.5・21 点を出し続ける 120 ms・認識の幅 640 px", () => {
    expect(DEFAULT_HAND_PARAMS.skeletonDepthM).toBe(1.2);
    expect(DEFAULT_HAND_PARAMS.skeletonDepthScale).toBe(1.5);
    expect(DEFAULT_HAND_PARAMS.skeletonHoldMs).toBe(120);
    expect(DEFAULT_HAND_PARAMS.recognizeWidthPx).toBe(640);
  });

  it("21 点を出し続ける時間は tracked を外すまでの時間より短い（形を先に薄くする）", () => {
    expect(DEFAULT_HAND_PARAMS.skeletonHoldMs).toBeLessThan(DEFAULT_HAND_PARAMS.trackLostMs);
  });

  it("URL パラメータで変えられる", () => {
    expect(
      handParamsFromSearch(
        "?skeletonDepthM=0.8&skeletonDepthScale=2&skeletonHoldMs=200&recognizeWidthPx=320",
      ),
    ).toEqual({
      skeletonDepthM: 0.8,
      skeletonDepthScale: 2,
      skeletonHoldMs: 200,
      recognizeWidthPx: 320,
    });
  });

  it("mergeHandParams で上書きでき，数でない値は無視する", () => {
    const out = mergeHandParams(DEFAULT_HAND_PARAMS, {
      skeletonDepthM: 0.9,
      recognizeWidthPx: "320",
      skeletonHoldMs: Number.NaN,
    });
    expect(out.skeletonDepthM).toBe(0.9);
    expect(out.recognizeWidthPx).toBe(640);
    expect(out.skeletonHoldMs).toBe(120);
  });

  it("worker=0 は手のしきい値として読まない", () => {
    expect(handParamsFromSearch("?worker=0&recognizeWidthPx=480")).toEqual({
      recognizeWidthPx: 480,
    });
  });
});
