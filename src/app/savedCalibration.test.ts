// しきい値の保存と読み込み（Issue #181「キャリブレーションの保存と読み込み」）のテスト
import { describe, expect, it } from "vitest";
import {
  type CalibrationStorageLike,
  describeSavedCalibration,
  loadCalibrationOverrides,
  parseCalibrationOverrides,
  SAVED_CALIBRATION_KEY,
  saveCalibrationOverrides,
  serializeCalibrationOverrides,
} from "./savedCalibration";

/** 最小のフェイク storage */
function fakeStorage(): CalibrationStorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

const throwing: CalibrationStorageLike = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

describe("serializeCalibrationOverrides / parseCalibrationOverrides", () => {
  it("往復で値が保たれる", () => {
    const o = { headPredictionMs: 42, gravityCutoffHz: 0.25, stepBandLowHz: 1.5 };
    expect(parseCalibrationOverrides(serializeCalibrationOverrides(o))).toEqual(o);
  });

  it("空のオブジェクトも往復で空のまま", () => {
    expect(parseCalibrationOverrides(serializeCalibrationOverrides({}))).toEqual({});
  });

  it.each([null, "", "not json", "{", "42", '"str"', "null", "[1,2]", "true"])(
    "JSON でない・オブジェクトでない %j は null",
    (text) => {
      expect(parseCalibrationOverrides(text)).toBeNull();
    },
  );

  it("数でない値・未知の項目は捨てる", () => {
    const text = JSON.stringify({
      headPredictionMs: "30",
      gravityCutoffHz: null,
      stepBandLowHz: 1.2,
      unknownKey: 5,
    });
    expect(parseCalibrationOverrides(text)).toEqual({ stepBandLowHz: 1.2 });
  });

  it("保存時に NaN・Infinity・未知の項目は残らない", () => {
    const text = serializeCalibrationOverrides({
      headPredictionMs: Number.NaN,
      gravityCutoffHz: Number.POSITIVE_INFINITY,
      stepBandLowHz: 0.9,
      ...({ bogus: 1 } as object),
    });
    expect(JSON.parse(text)).toEqual({ stepBandLowHz: 0.9 });
  });
});

describe("saveCalibrationOverrides / loadCalibrationOverrides", () => {
  it("保存したものを読み戻せる（決まったキーに入る）", () => {
    const s = fakeStorage();
    saveCalibrationOverrides(s, { headPredictionMs: 12 });
    expect(s.map.has(SAVED_CALIBRATION_KEY)).toBe(true);
    expect(SAVED_CALIBRATION_KEY).toBe("tkb2608.calibrationParams.v1");
    expect(loadCalibrationOverrides(s)).toEqual({ headPredictionMs: 12 });
  });

  it("保存が無ければ null", () => {
    expect(loadCalibrationOverrides(fakeStorage())).toBeNull();
  });

  it("壊れた値が入っていれば null", () => {
    const s = fakeStorage();
    s.map.set(SAVED_CALIBRATION_KEY, "{broken");
    expect(loadCalibrationOverrides(s)).toBeNull();
  });

  it("storage が null でも例外を出さない（読みは null）", () => {
    expect(() => saveCalibrationOverrides(null, { headPredictionMs: 1 })).not.toThrow();
    expect(loadCalibrationOverrides(null)).toBeNull();
  });

  it("getItem / setItem が例外を投げても外に出さない（読みは null）", () => {
    expect(() => saveCalibrationOverrides(throwing, { headPredictionMs: 1 })).not.toThrow();
    expect(() => loadCalibrationOverrides(throwing)).not.toThrow();
    expect(loadCalibrationOverrides(throwing)).toBeNull();
  });
});

describe("describeSavedCalibration", () => {
  it("null は保存なし", () => {
    expect(describeSavedCalibration(null)).toContain("保存なし");
  });

  it("値があれば項目名と値を含む", () => {
    const text = describeSavedCalibration({ headPredictionMs: 42 });
    expect(text).toContain("headPredictionMs=42.00");
  });

  it("空なら既定値のまま", () => {
    expect(describeSavedCalibration({})).toContain("既定値のまま");
  });
});
