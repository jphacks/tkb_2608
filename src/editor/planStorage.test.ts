// loadSavedPlan・savePlan（エディタの校舎の localStorage への自動保存と読み戻し）のテスト．
// 基準は docs/04_SPEC/SPEC_01 の src/editor/ の行（保存はファイルの書き出し・読み込みと localStorage）・
// SPEC_02「URL と QR への埋め込み」（失敗の種類と順番．version が新しい時は形の検査より先に判定する）と
// Issue #134（編集してから再読み込みしても編集が残る．保存の読み書きの失敗（使えない・容量超過・壊れた中身）は例外で止めず，
// 案内を出してデモの校舎で始める．validatePlan の誤りだけなら開く）．
// Storage はフェイク（Map で持つ・例外を投げる）を渡す
import { describe, expect, it } from "vitest";
import type { SchoolPlan } from "../core/schoolPlan";
import { DEMO_SCHOOL } from "../share/samples/demoSchool";
import { validatePlan } from "../share/validatePlan";
import {
  loadSavedPlan,
  PLAN_STORAGE_KEY,
  PLAN_STORAGE_MESSAGES,
  type PlanStorageLike,
  savePlan,
} from "./planStorage";

/** Map で持つ Storage の代わり．getItem・setItem を例外にでき，書いた回数を数える */
function fakeStorage(
  options: {
    readonly initial?: Readonly<Record<string, string>>;
    readonly getThrows?: boolean;
    readonly setThrows?: boolean;
  } = {},
): PlanStorageLike & { readonly items: Map<string, string> } {
  const items = new Map(Object.entries(options.initial ?? {}));
  return {
    items,
    getItem(key) {
      if (options.getThrows) throw new DOMException("denied", "SecurityError");
      return items.get(key) ?? null;
    },
    setItem(key, value) {
      if (options.setThrows) throw new DOMException("full", "QuotaExceededError");
      items.set(key, value);
    },
  };
}

/** デモの校舎を編集した校舎（名前・経路・延焼を変える） */
function edited(overrides: Partial<SchoolPlan> = {}): SchoolPlan {
  return {
    ...DEMO_SCHOOL,
    name: "編集した小学校",
    drill: {
      ...DEMO_SCHOOL.drill,
      mode: "test",
      route: [],
      spread: { ...DEMO_SCHOOL.drill.spread, fireSecondsPerCell: 9 },
      timeLimitSeconds: 300,
    },
    ...overrides,
  };
}

describe("savePlan / loadSavedPlan の往復", () => {
  it("保存した校舎を次に開くと同じ校舎・同じ訓練条件で開く", () => {
    const storage = fakeStorage();
    const plan = edited();
    expect(savePlan(storage, plan)).toBe(true);
    expect(loadSavedPlan(storage)).toEqual({ kind: "opened", plan, errors: [] });
  });

  it("決まったキーに保存する", () => {
    const storage = fakeStorage();
    savePlan(storage, edited());
    expect([...storage.items.keys()]).toEqual([PLAN_STORAGE_KEY]);
  });

  it("保存し直すと最後の校舎が残る", () => {
    const storage = fakeStorage();
    savePlan(storage, edited({ name: "1 回目" }));
    savePlan(storage, edited({ name: "2 回目" }));
    const loaded = loadSavedPlan(storage);
    expect(loaded.kind).toBe("opened");
    if (loaded.kind === "opened") expect(loaded.plan.name).toBe("2 回目");
  });

  it("validatePlan の誤りがある編集の途中も保存し，誤りの一覧つきで開く", () => {
    const storage = fakeStorage();
    const plan = edited({ cellSize: 0 });
    const errors = validatePlan(plan);
    expect(errors.length).toBeGreaterThan(0);
    expect(savePlan(storage, plan)).toBe(true);
    expect(loadSavedPlan(storage)).toEqual({ kind: "opened", plan, errors });
  });
});

describe("loadSavedPlan", () => {
  it("保存が無ければ none（デモの校舎で始める）", () => {
    expect(loadSavedPlan(fakeStorage())).toEqual({ kind: "none" });
  });

  it("Storage が使えない（null）時は failed で，Storage は使えない", () => {
    expect(loadSavedPlan(null)).toEqual({
      kind: "failed",
      message: PLAN_STORAGE_MESSAGES.unavailable,
      storageUsable: false,
    });
  });

  it("getItem が例外を投げても止まらず failed で，Storage は使えない", () => {
    const storage = fakeStorage({ getThrows: true });
    expect(() => loadSavedPlan(storage)).not.toThrow();
    expect(loadSavedPlan(storage)).toEqual({
      kind: "failed",
      message: PLAN_STORAGE_MESSAGES.unavailable,
      storageUsable: false,
    });
  });

  it.each<[string, string]>([
    ["空文字", ""],
    ["JSON でない", "{壊れた"],
    ["形が違う", JSON.stringify({ version: 1, name: "x" })],
    ["新しい版", JSON.stringify({ version: 2 })],
    ["新しい版で形も違う", JSON.stringify({ version: 3, floors: null })],
  ])("中身が読めない（%s）時は例外で止めず failed で，Storage は使える", (_label, text) => {
    const storage = fakeStorage({ initial: { [PLAN_STORAGE_KEY]: text } });
    const loaded = loadSavedPlan(storage);
    expect(loaded.kind).toBe("failed");
    if (loaded.kind !== "failed") return;
    expect(loaded.storageUsable).toBe(true);
    expect(loaded.message.length).toBeGreaterThan(0);
  });

  it("新しい版の時の案内は新しい版で開くよう伝える", () => {
    const storage = fakeStorage({
      initial: { [PLAN_STORAGE_KEY]: JSON.stringify({ version: 2 }) },
    });
    const loaded = loadSavedPlan(storage);
    expect(loaded.kind).toBe("failed");
    if (loaded.kind === "failed") expect(loaded.message).toContain("新しい版");
  });

  it("他のキーの値は読まない", () => {
    const storage = fakeStorage({
      initial: { other: JSON.stringify({ version: 2 }) },
    });
    expect(loadSavedPlan(storage)).toEqual({ kind: "none" });
  });

  it("読むだけで書き換えない", () => {
    const text = "{壊れた";
    const storage = fakeStorage({ initial: { [PLAN_STORAGE_KEY]: text } });
    loadSavedPlan(storage);
    expect(storage.items.get(PLAN_STORAGE_KEY)).toBe(text);
  });
});

describe("savePlan", () => {
  it("Storage が使えない（null）時は false", () => {
    expect(savePlan(null, DEMO_SCHOOL)).toBe(false);
  });

  it("容量超過等で setItem が例外を投げても止まらず false", () => {
    const storage = fakeStorage({ setThrows: true });
    expect(() => savePlan(storage, DEMO_SCHOOL)).not.toThrow();
    expect(savePlan(storage, DEMO_SCHOOL)).toBe(false);
  });

  it("入力の校舎を書き換えない", () => {
    const plan = edited();
    const snapshot = JSON.stringify(plan);
    savePlan(fakeStorage(), plan);
    expect(JSON.stringify(plan)).toBe(snapshot);
  });

  it("保存する中身は version を持つ JSON", () => {
    const storage = fakeStorage();
    savePlan(storage, DEMO_SCHOOL);
    const text = storage.items.get(PLAN_STORAGE_KEY);
    expect(text).toBeDefined();
    expect((JSON.parse(text ?? "") as { version: unknown }).version).toBe(1);
  });
});

describe("PLAN_STORAGE_MESSAGES", () => {
  it("どの案内も空でない", () => {
    for (const message of Object.values(PLAN_STORAGE_MESSAGES)) {
      expect(message.length).toBeGreaterThan(0);
    }
  });
});
