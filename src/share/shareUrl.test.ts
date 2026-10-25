// 生徒用の URL を作る buildShareUrl・createShareLink のテスト．
// 基準は docs/04_SPEC/SPEC_02「URL と QR への埋め込み」（`https://<配信先>/?app#p=<埋め込みデータ>`・エディタは QR を出す前に validatePlan を呼ぶ）・
// 「長さの上限」（URL 全体で 1,500 文字まで．超えたら「校舎が大きすぎます．使わない部分を消してください」．外側の void は切り詰めてから測る）・
// SPEC_01 の editor（E6: モードの選択と QR コードの表示）・PLAN_04 の E6 と Issue #130
import { describe, expect, it } from "vitest";
import type { CellRef, DrillMode, DrillSetup, SchoolPlan } from "../core/schoolPlan";
import { createPlanFingerprintFromHash, getRoomIdFromHash, ROOM_HASH_KEY } from "./monitorIds";
import { decodePlan, encodePlan } from "./planCodec";
import { loadPlanFromHash, PLAN_HASH_KEY } from "./planHash";
import { DEMO_SCHOOL, DEMO_SCHOOL_ROWS } from "./samples/demoSchool";
import { createFloorFromRows } from "./samples/floorFromRows";
import {
  buildMonitorUrl,
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

// Issue #129: E6 の QR に `room=` を入れ，見守り画面の URL も作る（SPEC_01「見守り」の「部屋の ID と URL」，
// SPEC_02「URL と QR への埋め込み」「長さの上限」（`room=` を含めた生徒用の URL で 1,500 文字まで））
const ROOM_ID = "AbCdEfGh012345-_";

describe("buildShareUrl（room=）", () => {
  it("`<配信先>?app#p=<埋め込みデータ>&room=<部屋の ID>` の形にする（room= は p= の後ろ）", () => {
    expect(buildShareUrl(BASE_URL, { plan: "abc", room: ROOM_ID })).toBe(
      `${BASE_URL}?app#p=abc&room=${ROOM_ID}`,
    );
  });

  it("room が無い時は room= を付けない", () => {
    expect(buildShareUrl(BASE_URL, { plan: "abc" })).not.toContain(`${ROOM_HASH_KEY}=`);
  });

  it("room= を足すと 16 文字の ID で URL は 22 文字長くなる", () => {
    const without = buildShareUrl(BASE_URL, { plan: "abc" });
    const withRoom = buildShareUrl(BASE_URL, { plan: "abc", room: ROOM_ID });
    expect(withRoom.length - without.length).toBe(22);
  });

  it("フラグメントから getRoomIdFromHash で部屋の ID を読める", () => {
    const url = buildShareUrl(BASE_URL, { plan: "abc", room: ROOM_ID });
    expect(getRoomIdFromHash(new URL(url).hash)).toBe(ROOM_ID);
  });
});

describe("buildMonitorUrl", () => {
  it("`<配信先>?monitor#p=<埋め込みデータ>&room=<部屋の ID>` の形にする", () => {
    expect(buildMonitorUrl(BASE_URL, { plan: "abc", room: ROOM_ID })).toBe(
      `${BASE_URL}?monitor#p=abc&room=${ROOM_ID}`,
    );
  });

  it("生徒用の URL の `?app` を `?monitor` に替えたもの（フラグメントは同じ）", () => {
    const fragment = { plan: "AZaz09-_".repeat(5), room: ROOM_ID };
    const app = new URL(buildShareUrl(BASE_URL, fragment));
    const monitor = new URL(buildMonitorUrl(BASE_URL, fragment));
    expect(monitor.search).toBe("?monitor");
    expect(monitor.hash).toBe(app.hash);
    expect(monitor.origin + monitor.pathname).toBe(app.origin + app.pathname);
    expect(buildMonitorUrl(BASE_URL, fragment)).toBe(
      buildShareUrl(BASE_URL, fragment).replace("?app#", "?monitor#"),
    );
  });
});

describe("createShareLink（resolveRoomId を渡した時）", () => {
  /** 渡された指紋を覚えて決まった ID を返す */
  function recorder(roomId = ROOM_ID): {
    resolve: (fp: string) => string;
    fingerprints: string[];
  } {
    const fingerprints: string[] = [];
    return {
      resolve: (fp) => {
        fingerprints.push(fp);
        return roomId;
      },
      fingerprints,
    };
  }

  function expectOkWithMonitor(result: ShareLinkResult): { url: string; monitorUrl: string } {
    if (!result.ok) throw new Error(`URL が作れなかった: ${result.reasons.join(" / ")}`);
    if (result.monitorUrl === undefined) throw new Error("monitorUrl が無い");
    return { url: result.url, monitorUrl: result.monitorUrl };
  }

  it("生徒用の URL のフラグメントに p= の後ろへ room=<引いた ID> を入れる", async () => {
    const r = recorder();
    const { url } = expectOkWithMonitor(
      await createShareLink(DEMO_SCHOOL, { baseUrl: BASE_URL, resolveRoomId: r.resolve }),
    );
    const encoded = await encodePlan(DEMO_SCHOOL);
    expect(url).toBe(`${BASE_URL}?app#p=${encoded}&room=${ROOM_ID}`);
    expect(getRoomIdFromHash(new URL(url).hash)).toBe(ROOM_ID);
  });

  it("見守り画面の URL は `?monitor` で，生徒用の URL と同じフラグメント", async () => {
    const { url, monitorUrl } = expectOkWithMonitor(
      await createShareLink(DEMO_SCHOOL, { baseUrl: BASE_URL, resolveRoomId: recorder().resolve }),
    );
    expect(new URL(monitorUrl).search).toBe("?monitor");
    expect(new URL(monitorUrl).hash).toBe(new URL(url).hash);
    expect(monitorUrl).toBe(url.replace("?app#", "?monitor#"));
  });

  it("resolveRoomId に渡す指紋は，生徒・見守り画面が URL の hash から求める指紋と同じ", async () => {
    const r = recorder();
    const { url, monitorUrl } = expectOkWithMonitor(
      await createShareLink(DEMO_SCHOOL, { baseUrl: BASE_URL, resolveRoomId: r.resolve }),
    );
    expect(r.fingerprints).toHaveLength(1);
    expect(r.fingerprints[0]).toBe(await createPlanFingerprintFromHash(new URL(url).hash));
    expect(r.fingerprints[0]).toBe(await createPlanFingerprintFromHash(new URL(monitorUrl).hash));
  });

  it("外側の void を切り詰めた校舎でも，指紋は送る URL の p の値から求める（void の無い校舎と同じ指紋）", async () => {
    const plain = recorder();
    const padded = recorder();
    await createShareLink(DEMO_SCHOOL, { baseUrl: BASE_URL, resolveRoomId: plain.resolve });
    const { url } = expectOkWithMonitor(
      await createShareLink(paddedDemo(4), { baseUrl: BASE_URL, resolveRoomId: padded.resolve }),
    );
    expect(padded.fingerprints[0]).toBe(plain.fingerprints[0]);
    expect(padded.fingerprints[0]).toBe(await createPlanFingerprintFromHash(new URL(url).hash));
  });

  it("校舎を直す（埋め込みデータが変わる）と違う指紋で引く", async () => {
    const a = recorder();
    const b = recorder();
    await createShareLink(planWith({}, { mode: "learn" }), {
      baseUrl: BASE_URL,
      resolveRoomId: a.resolve,
    });
    await createShareLink(planWith({}, { mode: "test" }), {
      baseUrl: BASE_URL,
      resolveRoomId: b.resolve,
    });
    expect(a.fingerprints[0]).not.toBe(b.fingerprints[0]);
  });

  it("同じ校舎なら同じ指紋で引く", async () => {
    const r = recorder();
    await createShareLink(DEMO_SCHOOL, { baseUrl: BASE_URL, resolveRoomId: r.resolve });
    await createShareLink(DEMO_SCHOOL, { baseUrl: BASE_URL, resolveRoomId: r.resolve });
    expect(r.fingerprints[0]).toBe(r.fingerprints[1]);
  });

  it.each<DrillMode>(["learn", "test"])(
    "room= があっても loadPlanFromHash は同じ校舎（%s）を読む（生徒用・見守り画面の両方）",
    async (mode) => {
      const p = planWith({}, { mode });
      const { url, monitorUrl } = expectOkWithMonitor(
        await createShareLink(p, { baseUrl: BASE_URL, resolveRoomId: recorder().resolve }),
      );
      for (const u of [url, monitorUrl]) {
        const loaded = await loadPlanFromHash(new URL(u).hash);
        expect(loaded.planLoadError).toBeNull();
        expect(loaded.plan).toEqual(p);
      }
    },
  );

  it("resolveRoomId を渡さない時は room= を付けず，monitorUrl も返さない（従来どおり）", async () => {
    const result = await createShareLink(DEMO_SCHOOL, { baseUrl: BASE_URL });
    if (!result.ok) throw new Error(result.reasons.join(" / "));
    expect(result.url).not.toContain("room=");
    expect(result.monitorUrl).toBeUndefined();
  });

  it("validatePlan の誤りがある時は URL を作らず，monitorUrl も無い", async () => {
    const broken = planWith({}, { fireOrigins: [], assembly: [] });
    const result = await createShareLink(broken, {
      baseUrl: BASE_URL,
      resolveRoomId: recorder().resolve,
    });
    expect(result.ok).toBe(false);
    expect("monitorUrl" in result).toBe(false);
  });

  /** room= を含めた生徒用の URL がちょうど length 文字になる配信先 */
  async function baseUrlForLengthWithRoom(length: number): Promise<string> {
    const fixedPart = buildShareUrl("", {
      plan: await encodePlan(DEMO_SCHOOL),
      room: ROOM_ID,
    }).length;
    const prefix = "https://example.com/";
    return prefix + "a".repeat(length - fixedPart - prefix.length);
  }

  it("room= を含めて URL 全体がちょうど 1,500 文字なら作れる", async () => {
    const baseUrl = await baseUrlForLengthWithRoom(MAX_SHARE_URL_LENGTH);
    const { url } = expectOkWithMonitor(
      await createShareLink(DEMO_SCHOOL, { baseUrl, resolveRoomId: recorder().resolve }),
    );
    expect(url.length).toBe(MAX_SHARE_URL_LENGTH);
  });

  it("room= を含めると 1,501 文字になる時は作らない（room= 無しなら上限に収まる長さでも）", async () => {
    const baseUrl = await baseUrlForLengthWithRoom(MAX_SHARE_URL_LENGTH + 1);
    // room= が無ければ 1,479 文字で収まる
    const plain = await createShareLink(DEMO_SCHOOL, { baseUrl });
    expect(plain.ok).toBe(true);
    const reasons = expectNg(
      await createShareLink(DEMO_SCHOOL, { baseUrl, resolveRoomId: recorder().resolve }),
    );
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain(SHARE_LINK_REASONS.tooLong);
  });

  it("デモの校舎は room= を含めても上限に収まる（SPEC_02 の実測 616 + 22 文字）", async () => {
    const { url } = expectOkWithMonitor(
      await createShareLink(DEMO_SCHOOL, { baseUrl: BASE_URL, resolveRoomId: recorder().resolve }),
    );
    expect(url.length).toBeLessThanOrEqual(MAX_SHARE_URL_LENGTH);
    const plain = expectOk(await createShareLink(DEMO_SCHOOL, { baseUrl: BASE_URL }));
    expect(url.length - plain.length).toBe(22);
  });
});
