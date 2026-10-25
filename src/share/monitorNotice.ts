// 見守りで起きた時だけ送る知らせ（段階 1 は hello・phase・door・lobby・track．JSON のテキスト）の型と変換（SPEC_01「見守り」の段階 1「知らせ」）．
// 受け取る側は，読めない JSON・知らない type・足りない項目のものを捨て，知らない項目は無視する（段階 2 で項目や type を足しても壊れないように）
import type { CellRef, DrillMode } from "../core/schoolPlan";
import { isStudentId } from "./monitorIds";

/** hello の形の版 */
export const MONITOR_NOTICE_VERSION = 1;

/** 生徒の画面の段階（phase の知らせで送る） */
export type MonitorPhase = "lobby" | "drill" | "goal" | "result";

/** 中継につながるたびに，その接続の最初に送る */
export interface MonitorHelloNotice {
  readonly type: "hello";
  readonly studentId: number;
  /** 形の版（今は 1） */
  readonly v: typeof MONITOR_NOTICE_VERSION;
  /** 校舎の指紋（createPlanFingerprint の結果） */
  readonly planFingerprint: string;
  readonly mode: DrillMode;
}

/** 画面が移った時と，hello の直後に送る */
export interface MonitorPhaseNotice {
  readonly type: "phase";
  readonly studentId: number;
  readonly phase: MonitorPhase;
}

/** 避難の画面でドアを開け閉めした時に送る */
export interface MonitorDoorNotice {
  readonly type: "door";
  readonly studentId: number;
  /** ドアのマス */
  readonly cell: CellRef;
  /** true で開いた */
  readonly open: boolean;
}

/** ロビーの指示の板に出している内容が変わった時に送る（見守り画面が同じロビーを描き直すため） */
export interface MonitorLobbyNotice {
  readonly type: "lobby";
  readonly studentId: number;
  /** 板の見出し */
  readonly title: string;
  /** 板の本文 */
  readonly body: string;
  /** 板の右上の補足（「手順 1 / 4　残り 5 秒」等．無ければ空の文字列） */
  readonly caption: string;
  /** 開始ボタンを出しているか（開始ボタンを待つ間） */
  readonly startButton: boolean;
  /** 見え方の調整の十字を出しているか */
  readonly alignMarker: boolean;
}

/**
 * 避難の記録（DrillTrack）の一部．避難が終わった時に，monitorTrack.ts の形のバイト列を分けて base64url にして送る
 * （1 回の大きさを中継の上限 4 KiB に収めるため）
 */
export interface MonitorTrackNotice {
  readonly type: "track";
  readonly studentId: number;
  /** 記録の番号（同じ記録の部分は同じ番号．0 以上の整数） */
  readonly trackId: number;
  /** 何番目の部分か（0 から） */
  readonly part: number;
  /** 部分の数（1〜MONITOR_TRACK_MAX_PARTS） */
  readonly parts: number;
  /** その部分のバイト列（base64url） */
  readonly data: string;
}

/** 段階 1 の知らせ */
export type MonitorNotice =
  | MonitorHelloNotice
  | MonitorPhaseNotice
  | MonitorDoorNotice
  | MonitorLobbyNotice
  | MonitorTrackNotice;

/** 記録を分ける数の上限（1 部分 2400 バイトで約 7,600 件．0.2 秒ごとなら約 25 分） */
export const MONITOR_TRACK_MAX_PARTS = 32;

/** ロビーの板の 1 つの文の長さの上限（文字）．3 つとも上限でも UTF-8 で 2,700 バイトほどで，中継の上限 4 KiB に収まる */
export const MONITOR_LOBBY_TEXT_MAX = 300;

const PHASES: readonly MonitorPhase[] = ["lobby", "drill", "goal", "result"];
const MODES: readonly DrillMode[] = ["learn", "test"];

const isPhase = (value: unknown): value is MonitorPhase => PHASES.some((phase) => phase === value);
const isMode = (value: unknown): value is DrillMode => MODES.some((mode) => mode === value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isLobbyText = (value: unknown): value is string =>
  typeof value === "string" && value.length <= MONITOR_LOBBY_TEXT_MAX;

const isCellIndex = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

function isCellRef(value: unknown): value is CellRef {
  return (
    isRecord(value) && isCellIndex(value.floor) && isCellIndex(value.x) && isCellIndex(value.z)
  );
}

/**
 * 知らせを JSON のテキストにする．
 * 型に無い項目が混ざっていても送らないよう，仕様の項目だけを並べ直す
 */
export function stringifyMonitorNotice(notice: MonitorNotice): string {
  switch (notice.type) {
    case "hello":
      return JSON.stringify({
        type: notice.type,
        studentId: notice.studentId,
        v: notice.v,
        planFingerprint: notice.planFingerprint,
        mode: notice.mode,
      });
    case "phase":
      return JSON.stringify({
        type: notice.type,
        studentId: notice.studentId,
        phase: notice.phase,
      });
    case "door":
      return JSON.stringify({
        type: notice.type,
        studentId: notice.studentId,
        cell: { floor: notice.cell.floor, x: notice.cell.x, z: notice.cell.z },
        open: notice.open,
      });
    case "lobby":
      return JSON.stringify({
        type: notice.type,
        studentId: notice.studentId,
        title: notice.title,
        body: notice.body,
        caption: notice.caption,
        startButton: notice.startButton,
        alignMarker: notice.alignMarker,
      });
    case "track":
      return JSON.stringify({
        type: notice.type,
        studentId: notice.studentId,
        trackId: notice.trackId,
        part: notice.part,
        parts: notice.parts,
        data: notice.data,
      });
  }
}

/**
 * 受け取った JSON のテキストを知らせに戻す．
 * 読めない JSON・知らない type・足りない（型の違う）項目・hello の v が 1 でないものは null（例外を投げない）．知らない項目は落とす
 */
export function parseMonitorNotice(text: string): MonitorNotice | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value) || !isStudentId(value.studentId)) return null;
  const studentId = value.studentId;

  switch (value.type) {
    case "hello": {
      const { v, planFingerprint, mode } = value;
      if (v !== MONITOR_NOTICE_VERSION || typeof planFingerprint !== "string") return null;
      if (!isMode(mode)) return null;
      return { type: "hello", studentId, v, planFingerprint, mode };
    }
    case "phase": {
      const { phase } = value;
      if (!isPhase(phase)) return null;
      return { type: "phase", studentId, phase };
    }
    case "door": {
      const { cell, open } = value;
      if (!isCellRef(cell) || typeof open !== "boolean") return null;
      return { type: "door", studentId, cell: { floor: cell.floor, x: cell.x, z: cell.z }, open };
    }
    case "lobby": {
      const { title, body, caption, startButton, alignMarker } = value;
      if (!isLobbyText(title) || !isLobbyText(body) || !isLobbyText(caption)) return null;
      if (typeof startButton !== "boolean" || typeof alignMarker !== "boolean") return null;
      return { type: "lobby", studentId, title, body, caption, startButton, alignMarker };
    }
    case "track": {
      const { trackId, part, parts, data } = value;
      if (!isCellIndex(trackId) || !isCellIndex(part) || !isCellIndex(parts)) return null;
      if (parts < 1 || parts > MONITOR_TRACK_MAX_PARTS || part >= parts) return null;
      if (typeof data !== "string" || !/^[A-Za-z0-9_-]*$/.test(data)) return null;
      return { type: "track", studentId, trackId, part, parts, data };
    }
    default:
      return null;
  }
}
