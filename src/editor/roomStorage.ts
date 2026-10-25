// 見守りの部屋の ID を，校舎の指紋（planFingerprint）との組で localStorage に置き，同じ校舎データの間は同じ ID を引く（SPEC_01「見守り」の「部屋の ID の保ち方」．#129）．
// 組の出し入れ（引く・足す・古い組を消す）は純粋な関数にし，Storage の読み書きと例外の受け止めは createRoomIdResolver の殻に閉じ込める
import { isRoomId } from "../share/monitorIds";
import type { PlanStorageLike } from "./planStorage";

/** 組を置く localStorage のキー（校舎の保存 `tkb2608.editor.plan` と同じ付け方） */
export const ROOM_STORAGE_KEY = "tkb2608.editor.monitorRooms";

/**
 * 置いておく組の数の上限．超えたら最も長く使っていない組から消す．
 * 1 回の訓練で校舎を直して QR を出し直すのは数回なので，その日の間の QR がどれも同じ部屋に残る程度の数にする
 */
export const MAX_ROOM_ENTRIES = 20;

/** 校舎の指紋と部屋の ID の組 */
export interface RoomEntry {
  /** 校舎の指紋（createPlanFingerprint の出力） */
  readonly fingerprint: string;
  /** 部屋の ID（createRoomId の出力） */
  readonly roomId: string;
}

/** 引いた結果．entries は引いた組を先頭に並べ直した（無ければ足した）新しい並び */
export interface RoomAssignment {
  readonly roomId: string;
  readonly entries: readonly RoomEntry[];
  /** 並びが変わったか（変わらなければ書き直さなくてよい） */
  readonly changed: boolean;
}

/**
 * 校舎の指紋の部屋の ID を引く．組があればその ID を使い，無ければ createId で作って足す．
 * 並びは最近使った順（先頭が最新）にし，MAX_ROOM_ENTRIES を超えた古い組を消す
 */
export function assignRoomId(
  entries: readonly RoomEntry[],
  fingerprint: string,
  createId: () => string,
  maxEntries: number = MAX_ROOM_ENTRIES,
): RoomAssignment {
  const index = entries.findIndex((e) => e.fingerprint === fingerprint);
  if (index === 0) return { roomId: entries[0].roomId, entries, changed: false };
  const entry = index > 0 ? entries[index] : { fingerprint, roomId: createId() };
  const rest = entries.filter((_, i) => i !== index);
  // NaN は Math.max でも NaN のまま残り，slice で全部消えてしまうので，0・負の数と同じく 1 件（引いた組）にする
  const floored = Math.floor(maxEntries);
  const limit = Number.isNaN(floored) ? 1 : Math.max(1, floored);
  return { roomId: entry.roomId, entries: [entry, ...rest].slice(0, limit), changed: true };
}

/** 組の並びを localStorage に置く文字（JSON の配列）にする */
export function serializeRoomEntries(entries: readonly RoomEntry[]): string {
  return JSON.stringify(entries.map((e) => ({ fingerprint: e.fingerprint, roomId: e.roomId })));
}

/**
 * localStorage の文字を組の並びに戻す．無い（null）・JSON でない・配列でない時は空．
 * 形に合わない組（部屋の ID の形が違う・指紋が空・同じ指紋の 2 つ目以降）は捨てる
 */
export function parseRoomEntries(text: string | null): RoomEntry[] {
  if (text === null) return [];
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const entries: RoomEntry[] = [];
  const seen = new Set<string>();
  for (const item of value as unknown[]) {
    if (typeof item !== "object" || item === null) continue;
    const { fingerprint, roomId } = item as { fingerprint?: unknown; roomId?: unknown };
    if (typeof fingerprint !== "string" || fingerprint === "" || seen.has(fingerprint)) continue;
    if (typeof roomId !== "string" || !isRoomId(roomId)) continue;
    seen.add(fingerprint);
    entries.push({ fingerprint, roomId });
  }
  return entries;
}

/**
 * 校舎の指紋から部屋の ID を引く関数を作る（例外は投げない）．
 * 引くたびに localStorage を読み直す（別のタブのエディタで足した組も使う）．Storage が使えない・読み書きで例外が出る時は，
 * このページを開いている間だけ手元の組で同じ ID を保つ（開き直すと新しい部屋になる）
 */
export function createRoomIdResolver(
  storage: PlanStorageLike | null,
  createId: () => string,
): (fingerprint: string) => string {
  let memory: readonly RoomEntry[] = [];
  return (fingerprint) => {
    let entries = memory;
    let readable = false;
    let restored = false;
    if (storage !== null) {
      try {
        entries = parseRoomEntries(storage.getItem(ROOM_STORAGE_KEY));
        readable = true;
      } catch {
        // 読めない時は手元の組で続ける
      }
    }
    // 読めた中に無くても，手元で作った組があればそれを使う（書き込みだけが失敗していた時に ID が変わらないように）
    if (readable && !entries.some((e) => e.fingerprint === fingerprint)) {
      const local = memory.find((e) => e.fingerprint === fingerprint);
      if (local !== undefined) {
        entries = [local, ...entries];
        restored = true;
      }
    }
    const result = assignRoomId(entries, fingerprint, createId);
    memory = result.entries;
    if ((result.changed || restored) && storage !== null) {
      try {
        storage.setItem(ROOM_STORAGE_KEY, serializeRoomEntries(result.entries));
      } catch {
        // 容量が足りない等．手元の組で同じ ID を保つ
      }
    }
    return result.roomId;
  };
}
