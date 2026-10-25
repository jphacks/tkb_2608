// 見守りの部屋の ID を校舎の指紋との組で保つ roomStorage のテスト．
// 基準は docs/04_SPEC/SPEC_01「見守り」の「部屋の ID と URL」の「部屋の ID の保ち方」
// （キー `tkb2608.editor.monitorRooms`・`[{fingerprint, roomId}]` の JSON 配列・最近使った順・20 件を超えたら最も古い組を消す・
// 壊れた中身は空・形の合わない組は捨てる・localStorage が使えない／書けない時は手元の組で同じ ID を保つ・引くたびに読み直す）
import { describe, expect, it } from "vitest";
import { isRoomId } from "../share/monitorIds";
import type { PlanStorageLike } from "./planStorage";
import {
  assignRoomId,
  createRoomIdResolver,
  MAX_ROOM_ENTRIES,
  parseRoomEntries,
  ROOM_STORAGE_KEY,
  type RoomEntry,
  serializeRoomEntries,
} from "./roomStorage";

/** 形に合う 16 文字の部屋の ID（n で区別する） */
const roomIdOf = (n: number): string => `room${String(n).padStart(12, "0")}`;

/** 組を作る */
const entry = (n: number, overrides: Partial<RoomEntry> = {}): RoomEntry => ({
  fingerprint: `fp${n}`,
  roomId: roomIdOf(n),
  ...overrides,
});

/** fp0..fp(count-1) の組の並び */
const entriesOf = (count: number): RoomEntry[] => Array.from({ length: count }, (_, i) => entry(i));

/** 呼ばれるたびに違う ID を返す（乱数を使わない）．呼ばれた回数も数える */
function idFactory(prefix = "newid"): { create: () => string; calls: () => number } {
  let count = 0;
  return {
    create: () => {
      count += 1;
      return `${prefix}${String(count).padStart(16 - prefix.length, "0")}`;
    },
    calls: () => count,
  };
}

/** Map で持つ Storage の代わり．getItem・setItem を投げるようにもできる */
function memoryStorage(
  options: { throwOnGet?: boolean; throwOnSet?: boolean; initial?: Record<string, string> } = {},
): PlanStorageLike & { data: Map<string, string>; throwOnGet: boolean; throwOnSet: boolean } {
  const data = new Map(Object.entries(options.initial ?? {}));
  return {
    data,
    throwOnGet: options.throwOnGet ?? false,
    throwOnSet: options.throwOnSet ?? false,
    getItem(key) {
      if (this.throwOnGet) throw new Error("SecurityError");
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      if (this.throwOnSet) throw new Error("QuotaExceededError");
      data.set(key, value);
    },
  };
}

describe("ROOM_STORAGE_KEY / MAX_ROOM_ENTRIES", () => {
  it("キーは tkb2608.editor.monitorRooms", () => {
    expect(ROOM_STORAGE_KEY).toBe("tkb2608.editor.monitorRooms");
  });

  it("上限は 20 件", () => {
    expect(MAX_ROOM_ENTRIES).toBe(20);
  });
});

describe("assignRoomId", () => {
  it("空の並びでは新しい ID を作り，その組だけの並びにする", () => {
    const ids = idFactory();
    const result = assignRoomId([], "fpA", ids.create);
    expect(ids.calls()).toBe(1);
    expect(result.roomId).toBe("newid00000000001");
    expect(result.entries).toEqual([{ fingerprint: "fpA", roomId: "newid00000000001" }]);
    expect(result.changed).toBe(true);
  });

  it("先頭にある指紋はその ID を返し，並びは変えない（changed は false）", () => {
    const ids = idFactory();
    const entries = entriesOf(3);
    const result = assignRoomId(entries, "fp0", ids.create);
    expect(result.roomId).toBe(roomIdOf(0));
    expect(result.entries).toEqual(entries);
    expect(result.changed).toBe(false);
    expect(ids.calls()).toBe(0);
  });

  it("先頭以外にある指紋は同じ ID を返し，その組を先頭へ移す（残りの順は保つ）", () => {
    const ids = idFactory();
    const result = assignRoomId(entriesOf(4), "fp2", ids.create);
    expect(result.roomId).toBe(roomIdOf(2));
    expect(result.entries.map((e) => e.fingerprint)).toEqual(["fp2", "fp0", "fp1", "fp3"]);
    expect(result.changed).toBe(true);
    expect(ids.calls()).toBe(0);
  });

  it("新しい指紋は ID を作って先頭に足す", () => {
    const ids = idFactory();
    const result = assignRoomId(entriesOf(2), "fpNew", ids.create);
    expect(result.entries.map((e) => e.fingerprint)).toEqual(["fpNew", "fp0", "fp1"]);
    expect(result.entries[0].roomId).toBe(result.roomId);
    expect(result.changed).toBe(true);
  });

  it("入力の並びは書き換えない", () => {
    const entries = entriesOf(3);
    const snapshot = JSON.parse(JSON.stringify(entries));
    assignRoomId(entries, "fp2", idFactory().create);
    assignRoomId(entries, "fpNew", idFactory().create);
    expect(entries).toEqual(snapshot);
  });

  it("20 件ある時に新しい指紋を足すと，最も古い（末尾の）組を消して 20 件に保つ", () => {
    const result = assignRoomId(entriesOf(MAX_ROOM_ENTRIES), "fpNew", idFactory().create);
    expect(result.entries).toHaveLength(MAX_ROOM_ENTRIES);
    expect(result.entries[0].fingerprint).toBe("fpNew");
    expect(result.entries.some((e) => e.fingerprint === `fp${MAX_ROOM_ENTRIES - 1}`)).toBe(false);
    expect(result.entries.some((e) => e.fingerprint === `fp${MAX_ROOM_ENTRIES - 2}`)).toBe(true);
  });

  it("19 件なら新しい指紋を足しても何も消さない（20 件）", () => {
    const result = assignRoomId(entriesOf(MAX_ROOM_ENTRIES - 1), "fpNew", idFactory().create);
    expect(result.entries).toHaveLength(MAX_ROOM_ENTRIES);
    expect(result.entries[MAX_ROOM_ENTRIES - 1].fingerprint).toBe(`fp${MAX_ROOM_ENTRIES - 2}`);
  });

  it("20 件の末尾の組を引くと，消さずに先頭へ移す（最近使ったので残る）", () => {
    const last = `fp${MAX_ROOM_ENTRIES - 1}`;
    const result = assignRoomId(entriesOf(MAX_ROOM_ENTRIES), last, idFactory().create);
    expect(result.entries).toHaveLength(MAX_ROOM_ENTRIES);
    expect(result.entries[0].fingerprint).toBe(last);
    expect(result.roomId).toBe(roomIdOf(MAX_ROOM_ENTRIES - 1));
  });

  it("引き直した組は先頭に移るので，その後に足しても消えない（最も長く使っていない組から消す）", () => {
    const max = 3;
    const ids = idFactory();
    let entries: readonly RoomEntry[] = entriesOf(3); // fp0, fp1, fp2（fp2 が最も古い）
    entries = assignRoomId(entries, "fp2", ids.create, max).entries; // fp2, fp0, fp1
    entries = assignRoomId(entries, "fpNew", ids.create, max).entries; // fpNew, fp2, fp0
    expect(entries.map((e) => e.fingerprint)).toEqual(["fpNew", "fp2", "fp0"]);
  });

  it("maxEntries を指定するとその件数で切る", () => {
    const result = assignRoomId(entriesOf(5), "fpNew", idFactory().create, 3);
    expect(result.entries.map((e) => e.fingerprint)).toEqual(["fpNew", "fp0", "fp1"]);
  });

  it.each<[string, number]>([
    ["0", 0],
    ["負の数", -5],
    ["NaN", Number.NaN],
    ["1 未満の小数", 0.5],
  ])("maxEntries が異常値（%s）でも，引いた組だけは残して同じ ID を返す", (_label, maxEntries) => {
    const result = assignRoomId(entriesOf(3), "fpNew", idFactory().create, maxEntries);
    expect(result.entries.length).toBeGreaterThanOrEqual(1);
    expect(result.entries[0]).toEqual({ fingerprint: "fpNew", roomId: result.roomId });
  });

  it("maxEntries が小数なら切り捨てた件数で切る", () => {
    const result = assignRoomId(entriesOf(5), "fpNew", idFactory().create, 2.9);
    expect(result.entries).toHaveLength(2);
  });

  it("maxEntries が Infinity なら切らない", () => {
    const result = assignRoomId(entriesOf(30), "fpNew", idFactory().create, Infinity);
    expect(result.entries).toHaveLength(31);
  });
});

describe("serializeRoomEntries / parseRoomEntries", () => {
  it("書いた並びを読み戻すと同じ並び（順も保つ）", () => {
    const entries = entriesOf(5);
    expect(parseRoomEntries(serializeRoomEntries(entries))).toEqual(entries);
  });

  it("`[{fingerprint, roomId}]` の JSON 配列にする（余計な項目は書かない）", () => {
    const extra = { ...entry(1), note: "x" } as RoomEntry;
    expect(JSON.parse(serializeRoomEntries([extra]))).toEqual([
      { fingerprint: "fp1", roomId: roomIdOf(1) },
    ]);
  });

  it("空の並びは `[]`", () => {
    expect(serializeRoomEntries([])).toBe("[]");
    expect(parseRoomEntries("[]")).toEqual([]);
  });
});

describe("parseRoomEntries", () => {
  it("null（まだ置いていない）は空", () => {
    expect(parseRoomEntries(null)).toEqual([]);
  });

  it.each<string>(["", "{", "not json", "[{]", "undefined"])(
    "JSON として壊れた中身（%j）は空",
    (text) => {
      expect(parseRoomEntries(text)).toEqual([]);
    },
  );

  it.each<string>([
    "{}",
    '{"fingerprint":"fp","roomId":"room000000000001"}',
    "1",
    '"x"',
    "null",
    "true",
  ])("配列でない中身（%s）は空", (text) => {
    expect(parseRoomEntries(text)).toEqual([]);
  });

  it.each<[string, unknown]>([
    ["短すぎる（7 文字）", "abcdefg"],
    ["長すぎる（65 文字）", "a".repeat(65)],
    ["base64url でない文字を含む", "abcd+efgh/ij"],
    ["空白を含む", "abcd efgh ij"],
    ["空", ""],
    ["文字でない", 12345678],
    ["無い", undefined],
  ])("部屋の ID の形が違う組（%s）は捨てる", (_label, roomId) => {
    const text = JSON.stringify([entry(0), { fingerprint: "bad", roomId }, entry(1)]);
    expect(parseRoomEntries(text)).toEqual([entry(0), entry(1)]);
  });

  it.each<[string, string]>([
    ["8 文字", "a".repeat(8)],
    ["64 文字", "A".repeat(64)],
    ["`-` と `_` を含む", "ab-_CD09"],
  ])("部屋の ID の形の境界（%s）は受け付ける", (_label, roomId) => {
    expect(isRoomId(roomId)).toBe(true);
    const text = JSON.stringify([{ fingerprint: "fp", roomId }]);
    expect(parseRoomEntries(text)).toEqual([{ fingerprint: "fp", roomId }]);
  });

  it.each<[string, unknown]>([
    ["空の文字", ""],
    ["文字でない", 1],
    ["null", null],
    ["無い", undefined],
  ])("指紋が %s の組は捨てる", (_label, fingerprint) => {
    const text = JSON.stringify([{ fingerprint, roomId: roomIdOf(9) }, entry(1)]);
    expect(parseRoomEntries(text)).toEqual([entry(1)]);
  });

  it("同じ指紋の 2 つ目以降の組は捨て，先頭（最新）の組を使う", () => {
    const text = JSON.stringify([
      entry(0),
      { fingerprint: "fp0", roomId: roomIdOf(90) },
      entry(1),
      { fingerprint: "fp0", roomId: roomIdOf(91) },
    ]);
    expect(parseRoomEntries(text)).toEqual([entry(0), entry(1)]);
  });

  it("形の合わない 1 つ目の組は重複として数えない（2 つ目の正しい組を使う）", () => {
    const text = JSON.stringify([
      { fingerprint: "fp0", roomId: "bad" },
      { fingerprint: "fp0", roomId: roomIdOf(5) },
    ]);
    expect(parseRoomEntries(text)).toEqual([{ fingerprint: "fp0", roomId: roomIdOf(5) }]);
  });

  it("オブジェクトでない要素（null・数・文字・配列）は捨てる", () => {
    const text = JSON.stringify([null, 1, "x", [roomIdOf(1)], entry(2)]);
    expect(parseRoomEntries(text)).toEqual([entry(2)]);
  });

  it("余計な項目は落として fingerprint と roomId だけにする", () => {
    const text = JSON.stringify([{ ...entry(3), extra: true }]);
    expect(parseRoomEntries(text)).toEqual([entry(3)]);
  });
});

describe("createRoomIdResolver", () => {
  it("同じ指紋なら何度引いても同じ ID（作るのは 1 回）", () => {
    const storage = memoryStorage();
    const ids = idFactory();
    const resolve = createRoomIdResolver(storage, ids.create);
    const a = resolve("fpA");
    expect(resolve("fpA")).toBe(a);
    expect(resolve("fpA")).toBe(a);
    expect(ids.calls()).toBe(1);
  });

  it("違う指紋（校舎を直した）なら新しい ID になる", () => {
    const resolve = createRoomIdResolver(memoryStorage(), idFactory().create);
    expect(resolve("fpA")).not.toBe(resolve("fpB"));
  });

  it("作った組をキー tkb2608.editor.monitorRooms に JSON 配列で書く（最近使った順）", () => {
    const storage = memoryStorage();
    const resolve = createRoomIdResolver(storage, idFactory().create);
    const a = resolve("fpA");
    const b = resolve("fpB");
    const stored = JSON.parse(storage.data.get(ROOM_STORAGE_KEY) ?? "null");
    expect(stored).toEqual([
      { fingerprint: "fpB", roomId: b },
      { fingerprint: "fpA", roomId: a },
    ]);
    resolve("fpA");
    expect(parseRoomEntries(storage.data.get(ROOM_STORAGE_KEY) ?? null)[0].fingerprint).toBe("fpA");
  });

  it("エディタを開き直しても（別の resolver でも）同じ Storage なら同じ ID", () => {
    const storage = memoryStorage();
    const first = createRoomIdResolver(storage, idFactory("aaaa").create)("fpA");
    const ids = idFactory("bbbb");
    const second = createRoomIdResolver(storage, ids.create)("fpA");
    expect(second).toBe(first);
    expect(ids.calls()).toBe(0);
  });

  it("前もって置いてある組の ID を使う", () => {
    const storage = memoryStorage({
      initial: { [ROOM_STORAGE_KEY]: serializeRoomEntries([entry(1), entry(2)]) },
    });
    const ids = idFactory();
    expect(createRoomIdResolver(storage, ids.create)("fp2")).toBe(roomIdOf(2));
    expect(ids.calls()).toBe(0);
  });

  it("引くたびに読み直し，別のタブで足した組の ID を使う", () => {
    const storage = memoryStorage();
    const resolveHere = createRoomIdResolver(storage, idFactory("here").create);
    const resolveOther = createRoomIdResolver(storage, idFactory("othr").create);
    resolveHere("fpA");
    const otherId = resolveOther("fpB");
    expect(resolveHere("fpB")).toBe(otherId);
  });

  it("別のタブで足した組を消さずに，自分の組を加えて書く", () => {
    const storage = memoryStorage();
    const resolveHere = createRoomIdResolver(storage, idFactory("here").create);
    const resolveOther = createRoomIdResolver(storage, idFactory("othr").create);
    resolveHere("fpA");
    resolveOther("fpB");
    resolveHere("fpC");
    const fps = parseRoomEntries(storage.data.get(ROOM_STORAGE_KEY) ?? null).map(
      (e) => e.fingerprint,
    );
    expect(fps).toEqual(["fpC", "fpB", "fpA"]);
  });

  it("Storage の中身が壊れていても止めずに ID を返し，正しい中身で書き直す", () => {
    const storage = memoryStorage({ initial: { [ROOM_STORAGE_KEY]: "{broken" } });
    const resolve = createRoomIdResolver(storage, idFactory().create);
    const id = resolve("fpA");
    expect(parseRoomEntries(storage.data.get(ROOM_STORAGE_KEY) ?? null)).toEqual([
      { fingerprint: "fpA", roomId: id },
    ]);
  });

  it("上限の 20 件を超えると Storage からも最も古い組が消える", () => {
    const storage = memoryStorage();
    const resolve = createRoomIdResolver(storage, idFactory().create);
    for (let i = 0; i <= MAX_ROOM_ENTRIES; i++) resolve(`fp${i}`);
    const stored = parseRoomEntries(storage.data.get(ROOM_STORAGE_KEY) ?? null);
    expect(stored).toHaveLength(MAX_ROOM_ENTRIES);
    expect(stored.some((e) => e.fingerprint === "fp0")).toBe(false);
    expect(stored[0].fingerprint).toBe(`fp${MAX_ROOM_ENTRIES}`);
  });

  it("Storage が null（使えない）でも，ページ内では同じ指紋に同じ ID を返す", () => {
    const ids = idFactory();
    const resolve = createRoomIdResolver(null, ids.create);
    const a = resolve("fpA");
    const b = resolve("fpB");
    expect(resolve("fpA")).toBe(a);
    expect(resolve("fpB")).toBe(b);
    expect(a).not.toBe(b);
    expect(ids.calls()).toBe(2);
  });

  it("getItem が例外を投げても止めず，ページ内では同じ ID を保つ", () => {
    const storage = memoryStorage({ throwOnGet: true });
    const resolve = createRoomIdResolver(storage, idFactory().create);
    const a = resolve("fpA");
    expect(() => resolve("fpA")).not.toThrow();
    expect(resolve("fpA")).toBe(a);
  });

  it("setItem が例外を投げても止めず，ページ内では同じ ID を保つ", () => {
    const storage = memoryStorage({ throwOnSet: true });
    const ids = idFactory();
    const resolve = createRoomIdResolver(storage, ids.create);
    const a = resolve("fpA");
    expect(resolve("fpA")).toBe(a);
    expect(ids.calls()).toBe(1);
  });

  it("書き込みが失敗して Storage に無くても，手元で作った ID を優先する（後で書けたら手元の ID を書く）", () => {
    const storage = memoryStorage({ throwOnSet: true });
    const resolve = createRoomIdResolver(storage, idFactory().create);
    const a = resolve("fpA");
    storage.throwOnSet = false;
    expect(resolve("fpA")).toBe(a);
    expect(parseRoomEntries(storage.data.get(ROOM_STORAGE_KEY) ?? null)).toContainEqual({
      fingerprint: "fpA",
      roomId: a,
    });
  });

  it("読めなくなった後に読めるようになっても，ページ内で使っていた ID を保つ", () => {
    const storage = memoryStorage({ throwOnGet: true });
    const resolve = createRoomIdResolver(storage, idFactory().create);
    const a = resolve("fpA");
    storage.throwOnGet = false;
    expect(resolve("fpA")).toBe(a);
  });

  it("作る ID は createId の値（例外は投げない）", () => {
    const resolve = createRoomIdResolver(memoryStorage(), () => "fixedRoomId00001");
    expect(resolve("fpA")).toBe("fixedRoomId00001");
  });
});
