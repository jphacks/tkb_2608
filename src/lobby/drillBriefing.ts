// ロビーの「訓練の説明」の段階（キャリブレーションの後，避難に入る前）の進行と文面
// （DOM・three.js に依存しない純粋な関数）．
// 校舎データ（SchoolPlan）から今日の訓練の内容（学校名・開始地点の教室・モード）を伝え，続けて避難の注意を伝える．
// 判定はしない（口をハンカチで覆う等は促すだけ．PLAN_04「やらないこと」）．各ページは最短の時間と読み上げの終わりを待って進み，上限の時間で必ず進む（詰まらない）

import type { SchoolPlan } from "../core/schoolPlan";
import type { LobbyInstruction } from "./lobbyScript";

/** 説明のページ．overview = 今日の訓練の内容，caution = 避難の注意 */
export type BriefingPageId = "overview" | "caution";

export interface BriefingConfig {
  /** 今日の訓練の内容を出す秒数（s） */
  readonly overviewSeconds: number;
  /** 避難の注意を出す秒数（s） */
  readonly cautionSeconds: number;
}

export const DEFAULT_BRIEFING_CONFIG: BriefingConfig = {
  overviewSeconds: 8,
  cautionSeconds: 7,
};

/** 初回のページの順 */
const FULL_BRIEFING_PAGES: readonly BriefingPageId[] = ["overview", "caution"];
/**
 * 「同じ訓練をもう一度」のページの順．同じ校舎・火元・開始地点で，内容は結果画面の前に聞いているため，
 * 注意だけを繰り返す（避難の前に姿勢を思い出させるため，省かない）
 */
const REUSED_BRIEFING_PAGES: readonly BriefingPageId[] = ["caution"];

export interface BriefingState {
  readonly pages: readonly BriefingPageId[];
  /** 今のページの添字．pages.length 以上なら終わり */
  readonly pageIndex: number;
  /** 今のページに入ってからの秒数 */
  readonly pageElapsed: number;
}

/** 説明を始める．reused は「同じ訓練をもう一度」（キャリブレーションを引き継いだ）時 */
export function startBriefing(reused: boolean): BriefingState {
  return {
    pages: reused ? REUSED_BRIEFING_PAGES : FULL_BRIEFING_PAGES,
    pageIndex: 0,
    pageElapsed: 0,
  };
}

/** 今のページ．終わった後は null */
export function currentBriefingPage(state: BriefingState): BriefingPageId | null {
  return state.pages[state.pageIndex] ?? null;
}

export function isBriefingFinished(state: BriefingState): boolean {
  return currentBriefingPage(state) === null;
}

function pageSeconds(page: BriefingPageId, config: BriefingConfig): number {
  return page === "overview" ? config.overviewSeconds : config.cautionSeconds;
}

/** 説明の全体の秒数（s） */
export function briefingTotalSeconds(
  state: BriefingState,
  config: BriefingConfig = DEFAULT_BRIEFING_CONFIG,
): number {
  let total = 0;
  for (const page of state.pages) total += pageSeconds(page, config);
  return total;
}

/**
 * 1 フレーム進める（dt は s）．ページの時間（最短）が過ぎ，読み上げが済んだら（narrationSettled．
 * narrationPacing.ts の isNarrationSettled）次のページへ．読み上げを待つ間も経過時間は数える
 */
export function advanceBriefing(
  state: BriefingState,
  dt: number,
  config: BriefingConfig = DEFAULT_BRIEFING_CONFIG,
  narrationSettled = true,
): BriefingState {
  const page = currentBriefingPage(state);
  if (page === null) return state;
  const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
  const elapsed = state.pageElapsed + step;
  if (elapsed < pageSeconds(page, config) || !narrationSettled) {
    return { ...state, pageElapsed: elapsed };
  }
  return { ...state, pageIndex: state.pageIndex + 1, pageElapsed: 0 };
}

/** 今のページを飛ばす（デバッグ用の Enter / Space） */
export function skipBriefingPage(state: BriefingState): BriefingState {
  if (isBriefingFinished(state)) return state;
  return { ...state, pageIndex: state.pageIndex + 1, pageElapsed: 0 };
}

/** 今のページを最初からやり直す（縦向きの案内で止めた後．ゴーグルに入っておらず聞けていないため） */
export function restartBriefingPage(state: BriefingState): BriefingState {
  return isBriefingFinished(state) ? state : { ...state, pageElapsed: 0 };
}

/** 今のページの残り秒数（s）．終わった後は null */
export function remainingBriefingSeconds(
  state: BriefingState,
  config: BriefingConfig = DEFAULT_BRIEFING_CONFIG,
): number | null {
  const page = currentBriefingPage(state);
  if (page === null) return null;
  return Math.max(0, pageSeconds(page, config) - state.pageElapsed);
}

/**
 * 開始地点（drill.start）のマスが属する教室の名前．校舎データの範囲の外・教室でないマス・名前が空の時は null
 */
export function startRoomName(plan: SchoolPlan): string | null {
  const { start } = plan.drill;
  const floor = plan.floors[start.floor];
  if (floor === undefined) return null;
  if (!Number.isInteger(start.x) || !Number.isInteger(start.z)) return null;
  if (start.x < 0 || start.x >= floor.width || start.z < 0 || start.z >= floor.depth) return null;
  const roomIndex = floor.roomOf[start.z * floor.width + start.x];
  if (roomIndex === undefined || roomIndex < 0) return null;
  const name = plan.rooms[roomIndex]?.name.trim() ?? "";
  return name === "" ? null : name;
}

/** モードごとの逃げ方の案内．plan が無ければモードに触れない */
function modeSentence(plan: SchoolPlan | null): string {
  if (plan === null) return "非常ベルが鳴ったら，落ち着いて外へ逃げてください";
  return plan.drill.mode === "learn"
    ? "非常ベルが鳴ったら，床の矢印に沿って逃げてください"
    : "非常ベルが鳴ったら逃げます．経路は出ません．自分で考えて逃げてください";
}

/** 今日の訓練の内容の文（表示・読み上げで共通）．plan が null の時は名前を出さない一般の文 */
export function describeBriefingOverview(plan: SchoolPlan | null): string {
  const school = plan?.name.trim() ?? "";
  const room = plan === null ? null : startRoomName(plan);
  const lead =
    school === "" ? "今日は火災の避難訓練です．" : `今日は${school}の火災の避難訓練です．`;
  const where = room === null ? "" : `あなたは${room}にいます．`;
  return `${lead}${where}${modeSentence(plan)}`;
}

/** 避難の注意（表示は 1 行ずつ） */
export const BRIEFING_CAUTION_LINES: readonly string[] = [
  "・煙の中では，しゃがんで低い姿勢で進む",
  "・ハンカチで口と鼻を覆う",
  "・火に近づかない",
  "・走らず，落ち着いて歩いて逃げる",
];

const BRIEFING_CAUTION_NARRATION =
  "煙の中では，しゃがんで低い姿勢で進みます．ハンカチで口と鼻を覆い，火に近づかず，走らずに逃げましょう";

/** 今の段階の指示を作る */
export function describeBriefing(
  state: BriefingState,
  plan: SchoolPlan | null,
  config: BriefingConfig = DEFAULT_BRIEFING_CONFIG,
): LobbyInstruction {
  const page = currentBriefingPage(state);
  const remaining = remainingBriefingSeconds(state, config);
  const progressLabel =
    page === null || state.pages.length <= 1
      ? null
      : `説明 ${state.pageIndex + 1} / ${state.pages.length}`;
  // 最短の時間が過ぎて読み上げを待つ間は残り秒数を出さない（「残り 0 秒」のまま止まって見えないため）
  const remainingSeconds = remaining === null || remaining <= 0 ? null : Math.ceil(remaining);
  switch (page) {
    case "overview": {
      const text = describeBriefingOverview(plan);
      return {
        key: `briefing:${state.pageIndex}:overview`,
        title: "今日の訓練",
        body: text,
        narration: text,
        progressLabel,
        remainingSeconds,
      };
    }
    case "caution":
      return {
        key: `briefing:${state.pageIndex}:caution`,
        title: "避難の注意",
        body: BRIEFING_CAUTION_LINES.join("\n"),
        narration: BRIEFING_CAUTION_NARRATION,
        progressLabel,
        remainingSeconds,
      };
    case null:
      return {
        key: "briefing:done",
        title: "訓練を始めます",
        body: "",
        narration: null,
        progressLabel: null,
        remainingSeconds: null,
      };
  }
}
