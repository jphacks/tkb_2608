// 見守りで起きた時だけ送る知らせ（段階 1 は hello・phase・door・lobby・track と，音の cue・speech・stopAudio．JSON のテキスト）の型と変換
// （SPEC_01「見守り」の段階 1「知らせ」「音」）．
// 受け取る側は，読めない JSON・知らない type・足りない項目のものを捨て，知らない項目は無視する（段階 2 で項目や type を足しても壊れないように）
import type { Cue, CueParams } from "../core/cue";
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
  /** 見え方の調整の丸を出しているか */
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

/** 音を鳴らす Cue（narration と sound だけ．happening は音にならないので送らない） */
export type MonitorAudioCue = Exclude<Cue, { readonly type: "happening" }>;

/** 生徒の端末のイベントバスに音の Cue が流れた時に送る（見守り画面が同じ audio/ で鳴らし直す） */
export interface MonitorCueNotice {
  readonly type: "cue";
  readonly studentId: number;
  readonly cue: MonitorAudioCue;
}

/** 生徒のロビーが文を読み上げた時に送る（見守り画面が PC の読み上げで読み直す） */
export interface MonitorSpeechNotice {
  readonly type: "speech";
  readonly studentId: number;
  /** 読み上げた文（1〜MONITOR_SPEECH_TEXT_MAX 文字） */
  readonly text: string;
  /** 読み上げの速さ（SpeechSynthesisUtterance.rate．0.1〜10） */
  readonly rate: number;
}

/** 生徒の端末が画面を切り替える時（鳴っている音と読み上げを止める時）に送る */
export interface MonitorStopAudioNotice {
  readonly type: "stopAudio";
  readonly studentId: number;
}

/** 段階 1 の知らせ */
export type MonitorNotice =
  | MonitorHelloNotice
  | MonitorPhaseNotice
  | MonitorDoorNotice
  | MonitorLobbyNotice
  | MonitorTrackNotice
  | MonitorCueNotice
  | MonitorSpeechNotice
  | MonitorStopAudioNotice;

/** 中継が 1 回に通す大きさの上限（バイト．UTF-8．relay/ の MAX_MESSAGE_BYTES と同じ） */
export const MONITOR_NOTICE_MAX_BYTES = 4096;

/** 記録を分ける数の上限（1 部分 2400 バイトで約 7,600 件．0.2 秒ごとなら約 25 分） */
export const MONITOR_TRACK_MAX_PARTS = 32;

/** ロビーの板の 1 つの文の長さの上限（文字）．3 つとも上限でも UTF-8 で 2,700 バイトほどで，中継の上限 4 KiB に収まる */
export const MONITOR_LOBBY_TEXT_MAX = 300;

/** 音の Cue の ID（id・anchorId）の長さの上限（文字） */
export const MONITOR_CUE_ID_MAX = 64;

/** 音の Cue の params の数の上限 */
export const MONITOR_CUE_PARAMS_MAX = 8;

/** 音の Cue の params のかぎの長さの上限（文字） */
export const MONITOR_CUE_PARAM_KEY_MAX = 32;

/** 音の Cue の params の文字の値の長さの上限（文字．教室の名前等） */
export const MONITOR_CUE_PARAM_TEXT_MAX = 100;

/** 読み上げの文の長さの上限（文字）．上限でも日本語の UTF-8 で 1,500 バイトほどで，中継の上限 4 KiB に収まる */
export const MONITOR_SPEECH_TEXT_MAX = 500;

/** 読み上げの速さの範囲（SpeechSynthesisUtterance.rate が受け付ける範囲） */
export const MONITOR_SPEECH_RATE_MIN = 0.1;
export const MONITOR_SPEECH_RATE_MAX = 10;

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

const isCueIdText = (value: unknown): value is string =>
  typeof value === "string" && value.length >= 1 && value.length <= MONITOR_CUE_ID_MAX;

const isCueParamValue = (value: unknown): value is string | number | boolean =>
  (typeof value === "string" && value.length <= MONITOR_CUE_PARAM_TEXT_MAX) ||
  (typeof value === "number" && Number.isFinite(value)) ||
  typeof value === "boolean";

/** Cue の params を確かめて，仕様の形に並べ直す（形に合わなければ null） */
function readCueParams(value: unknown): CueParams | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.length > MONITOR_CUE_PARAMS_MAX) return null;
  const params: Record<string, string | number | boolean> = {};
  for (const key of keys) {
    if (key.length < 1 || key.length > MONITOR_CUE_PARAM_KEY_MAX) return null;
    const item = value[key];
    if (!isCueParamValue(item)) return null;
    params[key] = item;
  }
  return params;
}

/**
 * 音の Cue（narration・sound）として送れる形かを確かめ，仕様の項目だけを並べ直して返す（形に合わなければ null）．
 * happening・ID が長すぎる・params が多すぎる（長すぎる）ものは null
 */
export function readMonitorAudioCue(value: unknown): MonitorAudioCue | null {
  if (!isRecord(value)) return null;
  switch (value.type) {
    case "narration": {
      if (!isCueIdText(value.id)) return null;
      if (value.params === undefined) return { type: "narration", id: value.id };
      const params = readCueParams(value.params);
      if (params === null) return null;
      return { type: "narration", id: value.id, params };
    }
    case "sound": {
      const { id, action, loop, anchorId } = value;
      if (!isCueIdText(id) || (action !== "play" && action !== "stop")) return null;
      if (loop !== undefined && typeof loop !== "boolean") return null;
      if (anchorId !== undefined && !isCueIdText(anchorId)) return null;
      return {
        type: "sound",
        id,
        action,
        ...(loop === undefined ? {} : { loop }),
        ...(anchorId === undefined ? {} : { anchorId }),
      };
    }
    default:
      return null;
  }
}

/** 読み上げの文として送れるか（1〜MONITOR_SPEECH_TEXT_MAX 文字） */
export function isMonitorSpeechText(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= MONITOR_SPEECH_TEXT_MAX;
}

/** 読み上げの速さとして送れるか（MONITOR_SPEECH_RATE_MIN〜MONITOR_SPEECH_RATE_MAX の有限の数） */
export function isMonitorSpeechRate(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= MONITOR_SPEECH_RATE_MIN &&
    value <= MONITOR_SPEECH_RATE_MAX
  );
}

/** JSON のテキストが中継の上限（MONITOR_NOTICE_MAX_BYTES．UTF-8）に収まるか */
export function fitsMonitorNotice(text: string): boolean {
  // UTF-8 は 1 文字（UTF-16 の 1 単位）が 3 バイトまでなので，明らかに収まる時は数えない
  if (text.length * 3 <= MONITOR_NOTICE_MAX_BYTES) return true;
  return new TextEncoder().encode(text).length <= MONITOR_NOTICE_MAX_BYTES;
}

/** 音の Cue の仕様の項目だけを並べ直す（任意の項目は値がある時だけ） */
function audioCueForJson(cue: MonitorAudioCue): MonitorAudioCue {
  if (cue.type === "narration") {
    return cue.params === undefined
      ? { type: cue.type, id: cue.id }
      : { type: cue.type, id: cue.id, params: { ...cue.params } };
  }
  return {
    type: cue.type,
    id: cue.id,
    action: cue.action,
    ...(cue.loop === undefined ? {} : { loop: cue.loop }),
    ...(cue.anchorId === undefined ? {} : { anchorId: cue.anchorId }),
  };
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
    case "cue":
      return JSON.stringify({
        type: notice.type,
        studentId: notice.studentId,
        cue: audioCueForJson(notice.cue),
      });
    case "speech":
      return JSON.stringify({
        type: notice.type,
        studentId: notice.studentId,
        text: notice.text,
        rate: notice.rate,
      });
    case "stopAudio":
      return JSON.stringify({ type: notice.type, studentId: notice.studentId });
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
    case "cue": {
      const cue = readMonitorAudioCue(value.cue);
      if (cue === null) return null;
      return { type: "cue", studentId, cue };
    }
    case "speech": {
      const { text: speechText, rate } = value;
      if (!isMonitorSpeechText(speechText) || !isMonitorSpeechRate(rate)) return null;
      return { type: "speech", studentId, text: speechText, rate };
    }
    case "stopAudio":
      return { type: "stopAudio", studentId };
    default:
      return null;
  }
}
