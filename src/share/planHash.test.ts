// loadPlanFromHash（URL のフラグメント `#p=<埋め込みデータ>` から生徒の体験で使う校舎を決める）のテスト．
// 基準は docs/04_SPEC/SPEC_01「起動の切り替え」（`?app#p=<埋め込みデータ>`．`#p=` が無い時は同梱のデモの校舎）・
// 「受け渡すデータ」の Session.plan／planLoadError（読み込めなかった時は plan が null，理由は decodePlan の失敗の kind と reason．
// 読み込めた時と URL に無い時は planLoadError が null）・SPEC_02「URL と QR への埋め込み」と Issue #86
import { describe, expect, expectTypeOf, it } from "vitest";
import type { Session } from "../core/scene";
import type { PlanLoadFailureKind, SchoolPlan } from "../core/schoolPlan";
import { decodePlan, encodePlan } from "./planCodec";
import { loadPlanFromHash, PLAN_HASH_KEY, type PlanFromHash } from "./planHash";
import { DEMO_SCHOOL } from "./samples/demoSchool";
import { validatePlan } from "./validatePlan";

/** バイト列を deflate-raw で圧縮して base64url にする（SPEC_02 の手順 2・3．細工した入力を作るために使う） */
async function embedJson(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = "";
  for (const b of compressed) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** デモの校舎の一部を上書きした校舎 */
const planWith = (overrides: Partial<SchoolPlan> = {}): SchoolPlan => ({
  ...DEMO_SCHOOL,
  ...overrides,
});

/** encodePlan の出力に `-` と `_` の両方が入る校舎を，名前を変えながら探す（決まった順に試すので毎回同じものになる） */
async function planWithDashAndUnderscore(): Promise<{ plan: SchoolPlan; encoded: string }> {
  for (let i = 0; i < 500; i++) {
    const plan = planWith({ name: `テスト校舎 ${i}` });
    const encoded = await encodePlan(plan);
    if (encoded.includes("-") && encoded.includes("_")) return { plan, encoded };
  }
  throw new Error("`-` と `_` を含む埋め込みデータが見つからない");
}

function expectFailure(result: PlanFromHash, kind: PlanLoadFailureKind): void {
  expect(result.plan).toBeNull();
  expect(result.planLoadError).not.toBeNull();
  expect(result.planLoadError?.kind).toBe(kind);
  expect(typeof result.planLoadError?.reason).toBe("string");
  expect(result.planLoadError?.reason.length).toBeGreaterThan(0);
  // 失敗の結果は PlanLoadError（kind と reason）だけで，decodePlan の ok は含めない
  expect(Object.keys(result.planLoadError ?? {}).sort()).toEqual(["kind", "reason"]);
}

describe("PLAN_HASH_KEY", () => {
  it("フラグメントの名前は p（`#p=<埋め込みデータ>`）", () => {
    expect(PLAN_HASH_KEY).toBe("p");
  });
});

describe("PlanFromHash", () => {
  it("plan・planLoadError は Session にそのまま書ける型", () => {
    expectTypeOf<PlanFromHash["plan"]>().toMatchTypeOf<Session["plan"]>();
    expectTypeOf<PlanFromHash["planLoadError"]>().toMatchTypeOf<Session["planLoadError"]>();
  });
});

describe("loadPlanFromHash（`#p=` が無い）", () => {
  it.each([
    ["フラグメントが空", ""],
    ["`#` だけ", "#"],
    ["別の値だけ（`#` あり）", "#x=1"],
    ["別の値だけ（`#` なし）", "x=1"],
    ["別の値が複数", "#x=1&y=2"],
    ["名前が大文字の P", "#P=abc"],
    ["名前が p で始まる別の名前", "#plan=abc"],
  ])("%s ならデモの校舎で，理由は null", async (_label, hash) => {
    const result = await loadPlanFromHash(hash);
    expect(result.plan).toBe(DEMO_SCHOOL);
    expect(result.planLoadError).toBeNull();
  });

  it("デモの校舎は validatePlan に通る（そのまま体験に使える）", async () => {
    const result = await loadPlanFromHash("");
    expect(result.plan).not.toBeNull();
    if (result.plan) expect(validatePlan(result.plan)).toEqual([]);
  });
});

describe("loadPlanFromHash（`#p=<埋め込みデータ>` を読める）", () => {
  it("encodePlan の出力を `#p=` に入れると元の校舎に戻り，理由は null", async () => {
    const plan = planWith({ name: "南校舎" });
    const result = await loadPlanFromHash(`#p=${await encodePlan(plan)}`);
    expect(result.plan).toEqual(plan);
    expect(result.planLoadError).toBeNull();
  });

  it("先頭の `#` が無くても読める", async () => {
    const plan = planWith({ name: "南校舎" });
    const result = await loadPlanFromHash(`p=${await encodePlan(plan)}`);
    expect(result.plan).toEqual(plan);
    expect(result.planLoadError).toBeNull();
  });

  it("base64url の `-`・`_` を含む埋め込みデータもそのまま元の校舎に戻る", async () => {
    const { plan, encoded } = await planWithDashAndUnderscore();
    const result = await loadPlanFromHash(`#p=${encoded}`);
    expect(result.plan).toEqual(plan);
    expect(result.planLoadError).toBeNull();
  });

  it.each([
    ["別の値の後ろ", (e: string) => `#x=1&p=${e}`],
    ["別の値の前", (e: string) => `#p=${e}&x=1`],
    ["別の値に挟まれる", (e: string) => `#a=1&p=${e}&b=2`],
  ])("%s に `p` があっても読める", async (_label, toHash) => {
    const plan = planWith({ name: "北校舎" });
    const result = await loadPlanFromHash(toHash(await encodePlan(plan)));
    expect(result.plan).toEqual(plan);
    expect(result.planLoadError).toBeNull();
  });

  it("デモと違う校舎を渡すと，デモではなく渡した校舎になる", async () => {
    const plan = planWith({ name: "デモではない校舎" });
    const result = await loadPlanFromHash(`#p=${await encodePlan(plan)}`);
    expect(result.plan).not.toBe(DEMO_SCHOOL);
    expect(result.plan?.name).toBe("デモではない校舎");
  });
});

describe("loadPlanFromHash（`#p=<埋め込みデータ>` を読めない）", () => {
  it("`#p=`（中身が空）はデモにせず corrupted", async () => {
    expectFailure(await loadPlanFromHash("#p="), "corrupted");
  });

  it("`#x=1&p=`（中身が空）もデモにせず corrupted", async () => {
    expectFailure(await loadPlanFromHash("#x=1&p="), "corrupted");
  });

  it("`#p`（= も中身も無い）もデモにせず corrupted", async () => {
    expectFailure(await loadPlanFromHash("#p"), "corrupted");
  });

  it.each([
    ["base64url で使わない文字", "#p=!!!!"],
    ["deflate として読めないバイト列", "#p=____________"],
    ["短すぎる", "#p=a"],
  ])("壊れたデータ（%s）は corrupted", async (_label, hash) => {
    expectFailure(await loadPlanFromHash(hash), "corrupted");
  });

  it("後ろが欠けた埋め込みデータは corrupted", async () => {
    const encoded = await encodePlan(DEMO_SCHOOL);
    expectFailure(
      await loadPlanFromHash(`#p=${encoded.slice(0, Math.floor(encoded.length / 2))}`),
      "corrupted",
    );
  });

  it("未知の版（今より新しい version）は unsupportedVersion", async () => {
    const encoded = await encodePlan(planWith({ version: 2 as 1 }));
    expectFailure(await loadPlanFromHash(`#p=${encoded}`), "unsupportedVersion");
  });

  it("新しい版なら形が違っていても unsupportedVersion", async () => {
    const encoded = await embedJson({ version: 99, other: "別の形" });
    expectFailure(await loadPlanFromHash(`#p=${encoded}`), "unsupportedVersion");
  });

  it("中身の誤り（火元が 1 つもない）は invalidPlan で，理由に validatePlan の最初の誤りが入る", async () => {
    const plan = planWith({ drill: { ...DEMO_SCHOOL.drill, fireOrigins: [] } });
    const errors = validatePlan(plan);
    expect(errors.length).toBeGreaterThan(0);
    const result = await loadPlanFromHash(`#p=${await encodePlan(plan)}`);
    expectFailure(result, "invalidPlan");
    expect(result.planLoadError?.reason).toContain(errors[0]);
  });

  it.each([
    ["壊れたデータ", "#p=!!!!"],
    ["中身が空", "#p="],
  ])("失敗の理由は decodePlan の kind・reason と同じ（%s）", async (_label, hash) => {
    const decoded = await decodePlan(new URLSearchParams(hash.slice(1)).get("p") ?? "");
    expect(decoded.ok).toBe(false);
    const result = await loadPlanFromHash(hash);
    if (!decoded.ok) {
      expect(result.planLoadError).toEqual({ kind: decoded.kind, reason: decoded.reason });
    }
  });
});

describe("loadPlanFromHash（例外を投げない）", () => {
  it.each([
    ["空", ""],
    ["`#` だけ", "#"],
    ["`#p=`", "#p="],
    ["壊れたデータ", "#p=!!!!"],
    ["`%` の誤ったエスケープ", "#p=%E0%A4%A"],
    ["`+` を含む（URLSearchParams では空白になる）", "#p=ab+cd"],
    ["`=` が重なる", "#p==="],
    ["`&` だけ", "#&&&"],
    ["`p` が 2 つ", "#p=!!!!&p=abc"],
    ["とても長い壊れたデータ", `#p=${"A".repeat(100_000)}`],
  ])("%s でも reject せず，plan か planLoadError のどちらかが入る", async (_label, hash) => {
    const result = await loadPlanFromHash(hash);
    // plan と planLoadError はちょうど一方だけが入る
    expect((result.plan === null) !== (result.planLoadError === null)).toBe(true);
  });
});
