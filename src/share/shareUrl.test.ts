// 生徒用の URL を作る buildShareUrl・createShareLink のテスト．
// 基準は docs/04_SPEC/SPEC_02「URL と QR への埋め込み」（`https://<配信先>/?app#p=<埋め込みデータ>`・エディタは QR を出す前に validatePlan を呼ぶ）・
// 「長さの上限」（URL 全体で 1,500 文字まで．超えたら「校舎が大きすぎます．使わない部分を消してください」．外側の void は切り詰めてから測る）・
// SPEC_01 の editor（E6: モードの選択と QR コードの表示）・PLAN_04 の E6 と Issue #130
import { describe, expect, it } from "vitest";
import type { CellRef, DrillMode, DrillSetup, SchoolPlan } from "../core/schoolPlan";
import { decodePlan, encodePlan } from "./planCodec";
import { loadPlanFromHash, PLAN_HASH_KEY } from "./planHash";
import { DEMO_SCHOOL, DEMO_SCHOOL_ROWS } from "./samples/demoSchool";
import { createFloorFromRows } from "./samples/floorFromRows";
import {
  buildShareUrl,
  createShareLink,
  isLoopbackHost,
  MAX_SHARE_URL_LENGTH,
  SHARE_LINK_REASONS,
  type ShareLinkResult,
} from "./shareUrl";
import { trimVoidMargins } from "./trimPlan";
import { validatePlan } from "./validatePlan";

const BASE_URL = "https://staging.tkb2608.pages.dev/";

/** デモの校舎の一部を上書きした校舎 */
const planWith = (
  overrides: Partial<SchoolPlan> = {},
  drill: Partial<DrillSetup> = {},
): SchoolPlan => ({
  ...DEMO_SCHOOL,
  ...overrides,
  drill: { ...DEMO_SCHOOL.drill, ...overrides.drill, ...drill },
});

/** デモの校舎の周りに void を足し，訓練条件も同じだけずらした校舎 */
function paddedDemo(margin: number): SchoolPlan {
  const width = DEMO_SCHOOL_ROWS[0].length + margin * 2;
  const blank = ".".repeat(width);
  const rows = [
    ...Array.from({ length: margin }, () => blank),
    ...DEMO_SCHOOL_ROWS.map((r) => ".".repeat(margin) + r + ".".repeat(margin)),
    ...Array.from({ length: margin }, () => blank),
  ];
  const m = (r: CellRef): CellRef => ({ ...r, x: r.x + margin, z: r.z + margin });
  const d = DEMO_SCHOOL.drill;
  return {
    ...DEMO_SCHOOL,
    floors: [createFloorFromRows(1, rows)],
    drill: {
      ...d,
      fireOrigins: d.fireOrigins.map(m),
      start: m(d.start),
      assembly: d.assembly.map(m),
      route: d.route.map(m),
    },
  };
}

function expectOk(result: ShareLinkResult): string {
  if (!result.ok) throw new Error(`URL が作れなかった: ${result.reasons.join(" / ")}`);
  return result.url;
}

function expectNg(result: ShareLinkResult): readonly string[] {
  if (result.ok) throw new Error(`URL が作られてしまった: ${result.url}`);
  return result.reasons;
}

/** URL から `?` の後ろと `#` の後ろを取り出す */
function partsOf(url: string): { base: string; search: string; hash: string } {
  const hashAt = url.indexOf("#");
  const beforeHash = hashAt < 0 ? url : url.slice(0, hashAt);
  const queryAt = beforeHash.indexOf("?");
  return {
    base: queryAt < 0 ? beforeHash : beforeHash.slice(0, queryAt),
    search: queryAt < 0 ? "" : beforeHash.slice(queryAt),
    hash: hashAt < 0 ? "" : url.slice(hashAt),
  };
}

describe("MAX_SHARE_URL_LENGTH / SHARE_LINK_REASONS", () => {
  it("URL 全体の上限は 1,500 文字", () => {
    expect(MAX_SHARE_URL_LENGTH).toBe(1500);
  });

  it("長すぎる時の理由は SPEC_02 の文", () => {
    expect(SHARE_LINK_REASONS.tooLong).toBe("校舎が大きすぎます．使わない部分を消してください");
  });
});

describe("buildShareUrl", () => {
  it("`<配信先>?app#p=<埋め込みデータ>` の形にする", () => {
    expect(buildShareUrl(BASE_URL, { plan: "abc-_XYZ09" })).toBe(
      `${BASE_URL}?app#${PLAN_HASH_KEY}=abc-_XYZ09`,
    );
  });

  it("フラグメントの名前は PLAN_HASH_KEY（loadPlanFromHash が読む名前）", () => {
    const url = buildShareUrl(BASE_URL, { plan: "data" });
    const { hash } = partsOf(url);
    expect(new URLSearchParams(hash.slice(1)).get(PLAN_HASH_KEY)).toBe("data");
  });

  it("クエリは `?app` だけ（生徒の体験の流れで開く）", () => {
    const { base, search } = partsOf(buildShareUrl(BASE_URL, { plan: "data" }));
    expect(base).toBe(BASE_URL);
    expect(search).toBe("?app");
  });

  it("base64url の文字（英数字・`-`・`_`）は書き換えずにそのまま載せる", () => {
    const data = "AZaz09-_".repeat(10);
    expect(buildShareUrl(BASE_URL, { plan: data }).endsWith(`#p=${data}`)).toBe(true);
  });
});

describe("createShareLink", () => {
  it("デモの校舎から URL を作れ，SPEC_02 の実測（616 文字）に近い長さで上限に収まる", async () => {
    const url = expectOk(await createShareLink(DEMO_SCHOOL, { baseUrl: BASE_URL }));
    expect(url.length).toBeLessThanOrEqual(MAX_SHARE_URL_LENGTH);
    expect(url.startsWith(`${BASE_URL}?app#p=`)).toBe(true);
  });

  it("URL のデータは encodePlan の出力そのもの（外側に void が無い校舎）", async () => {
    const url = expectOk(await createShareLink(DEMO_SCHOOL, { baseUrl: BASE_URL }));
    expect(url).toBe(buildShareUrl(BASE_URL, { plan: await encodePlan(DEMO_SCHOOL) }));
  });

  it.each<DrillMode>(["learn", "test"])(
    "URL のフラグメントを loadPlanFromHash で読むと，同じ校舎・同じモード（%s）になる",
    async (mode) => {
      const p = planWith({}, { mode });
      const url = expectOk(await createShareLink(p, { baseUrl: BASE_URL }));
      const loaded = await loadPlanFromHash(partsOf(url).hash);
      expect(loaded.planLoadError).toBeNull();
      expect(loaded.plan).toEqual(p);
      expect(loaded.plan?.drill.mode).toBe(mode);
    },
  );

  it("URL のフラグメントを new URL().hash 経由で読んでも同じ校舎になる", async () => {
    const p = planWith({}, { mode: "test" });
    const url = expectOk(await createShareLink(p, { baseUrl: BASE_URL }));
    const parsed = new URL(url);
    expect(parsed.search).toBe("?app");
    const loaded = await loadPlanFromHash(parsed.hash);
    expect(loaded.plan).toEqual(p);
  });

  it("外側の void を切り詰めてから載せ，読み戻すと切り詰めた校舎になる（モードも保つ）", async () => {
    const padded = planWith(paddedDemo(5), { mode: "test" });
    expect(validatePlan(padded)).toEqual([]);
    const url = expectOk(await createShareLink(padded, { baseUrl: BASE_URL }));
    const decoded = await decodePlan(
      new URLSearchParams(partsOf(url).hash.slice(1)).get("p") ?? "",
    );
    if (!decoded.ok) throw new Error(decoded.reason);
    expect(decoded.plan).toEqual(trimVoidMargins(padded));
    expect(decoded.plan.floors[0].width).toBe(DEMO_SCHOOL.floors[0].width);
    expect(decoded.plan.floors[0].depth).toBe(DEMO_SCHOOL.floors[0].depth);
    expect(decoded.plan.drill.mode).toBe("test");
    expect(decoded.plan.drill.start).toEqual(DEMO_SCHOOL.drill.start);
  });

  it("外側の void が多くても，切り詰めた後の長さで測る（void の無い校舎と同じ URL）", async () => {
    const plain = planWith({}, { mode: "test" });
    const padded = planWith(paddedDemo(30), { mode: "test" });
    const a = expectOk(await createShareLink(plain, { baseUrl: BASE_URL }));
    const b = expectOk(await createShareLink(padded, { baseUrl: BASE_URL }));
    expect(b).toBe(a);
  });

  it("validatePlan の誤りがある時は URL を作らず，その誤りを理由に出す", async () => {
    const broken = planWith({}, { fireOrigins: [], assembly: [] });
    const expected = validatePlan(broken);
    expect(expected.length).toBeGreaterThan(0);
    const reasons = expectNg(await createShareLink(broken, { baseUrl: BASE_URL }));
    expect(reasons).toEqual(expected);
  });

  it("開始地点が教室でない時は理由に出す", async () => {
    const broken = planWith({}, { start: { floor: 0, x: 5, z: 6 }, route: [] });
    const reasons = expectNg(await createShareLink(broken, { baseUrl: BASE_URL }));
    expect(reasons.some((r) => r.includes("開始地点"))).toBe(true);
  });

  it("誤りがある時は切り詰め前の（編集中の）校舎の座標で理由を出す", async () => {
    const padded = paddedDemo(3);
    const broken = { ...padded, drill: { ...padded.drill, start: { floor: 0, x: 8, z: 9 } } };
    const reasons = expectNg(await createShareLink(broken, { baseUrl: BASE_URL }));
    expect(reasons).toEqual(validatePlan(broken));
  });

  /** 埋め込みデータの長さ（配信先に依らない）から，URL 全体がちょうど length 文字になる配信先を作る */
  async function baseUrlForLength(length: number): Promise<string> {
    const fixedPart = buildShareUrl("", { plan: await encodePlan(DEMO_SCHOOL) }).length;
    const prefix = "https://example.com/";
    return prefix + "a".repeat(length - fixedPart - prefix.length);
  }

  it("URL 全体がちょうど 1,500 文字なら作れる", async () => {
    const baseUrl = await baseUrlForLength(MAX_SHARE_URL_LENGTH);
    const url = expectOk(await createShareLink(DEMO_SCHOOL, { baseUrl }));
    expect(url.length).toBe(MAX_SHARE_URL_LENGTH);
  });

  it("URL 全体が 1,501 文字なら作らず，長すぎる理由を出す", async () => {
    const baseUrl = await baseUrlForLength(MAX_SHARE_URL_LENGTH + 1);
    const reasons = expectNg(await createShareLink(DEMO_SCHOOL, { baseUrl }));
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain(SHARE_LINK_REASONS.tooLong);
  });

  it("経路が長く上限を超える校舎は作らず，長すぎる理由を出す", async () => {
    // 60 × 30 の校舎で，教室から校庭まで蛇行する長い経路（validatePlan は通る）
    const width = 60;
    const depth = 30;
    const rows = Array.from({ length: depth }, (_, z) =>
      z === 0
        ? `0${"h".repeat(width - 1)}`
        : z === depth - 1
          ? "o".repeat(width)
          : "h".repeat(width),
    );
    const route: CellRef[] = [];
    for (let z = 0; z < depth; z++) {
      for (let i = 0; i < width; i++) {
        const x = z % 2 === 0 ? i : width - 1 - i;
        route.push({ floor: 0, x, z });
      }
    }
    const last = route[route.length - 1];
    const big = planWith(
      { floors: [createFloorFromRows(1, rows)] },
      {
        start: { floor: 0, x: 0, z: 0 },
        fireOrigins: [{ floor: 0, x: 30, z: 15 }],
        assembly: [last],
        route,
      },
    );
    expect(validatePlan(big)).toEqual([]);
    const reasons = expectNg(await createShareLink(big, { baseUrl: BASE_URL }));
    expect(reasons[0]).toContain(SHARE_LINK_REASONS.tooLong);
  });

  it("入力の校舎は書き換えない", async () => {
    const padded = paddedDemo(2);
    const snapshot = JSON.parse(JSON.stringify(padded));
    await createShareLink(padded, { baseUrl: BASE_URL });
    expect(JSON.parse(JSON.stringify(padded))).toEqual(snapshot);
  });
});

// Issue #133: 正解経路は空でもよい（空なら生徒側で proposeRoute() の提案を使う．SPEC_01「結果の評価」）
describe("createShareLink（空の正解経路）", () => {
  it("経路が空の校舎でも URL を作れ，読み戻すと経路は空のまま", async () => {
    const p = planWith({}, { route: [] });
    const url = expectOk(await createShareLink(p, { baseUrl: BASE_URL }));
    const loaded = await loadPlanFromHash(new URL(url).hash);
    expect(loaded.planLoadError).toBeNull();
    expect(loaded.plan?.drill.route).toEqual([]);
  });
});

describe("isLoopbackHost", () => {
  it.each<string>(["localhost", "127.0.0.1", "[::1]", "::1", "LOCALHOST", "LocalHost"])(
    "%s は自分の PC だけを指す名前（true）",
    (host) => {
      expect(isLoopbackHost(host)).toBe(true);
    },
  );

  it.each<string>([
    "",
    "staging.tkb2608.pages.dev",
    "example.trycloudflare.com",
    "192.168.0.10",
    "localhost.example.com",
    "127.0.0.2",
  ])("%s は false", (host) => {
    expect(isLoopbackHost(host)).toBe(false);
  });
});
