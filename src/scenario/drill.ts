// 火災訓練のシナリオを校舎データから組み立てる（docs/04_SPEC/SPEC_01「火災訓練のシナリオ」「VR 避難の規則」）．
// ① 授業中の教室 → ② 非常ベルと校内放送 → ③ 避難 → 締め．秒数は既定値で，デモの校舎で歩いて決め直す
import type { CellKind, CellRef, SchoolPlan } from "../core/schoolPlan";
import { cellIndex, isInside } from "../sim";
import type { ScenarioDefinition } from "./types";

/** 場面の ID（結果画面・app/ が StepRecord.stepId で引く） */
export const DRILL_STEP = {
  classroom: "classroom",
  alarm: "alarm",
  evacuate: "evacuate",
  ending: "ending",
} as const;

/**
 * 演出の ID（仮．素材の一覧は SPEC_01「未決事項」．担当C が音と合わせて決め直す）．
 * fireStart・fireAnnouncement は SPEC_01「火災訓練のシナリオ」で決まっている ID
 */
export const DRILL_CUE_ID = {
  /** 効果音: 教室の環境音（ループ） */
  classroomAmbience: "classroom-ambience",
  /** 効果音: 非常ベル（ループ） */
  fireAlarm: "fire-alarm",
  /** ナレーション: 導入（「授業中です．周りを見てみましょう」） */
  classroomIntro: "classroom-intro",
  /** ナレーション: 校内放送（「〇〇で火事です．先生の指示に従って避難してください」） */
  fireAnnouncement: "fire-announcement",
  /** ナレーション: 「火と煙を避けて校庭へ」 */
  evacuateStart: "evacuate-start",
  /** ナレーション: 締め */
  ending: "drill-ending",
  /** 出来事: 出火（この時刻を 0 秒として延焼が始まる） */
  fireStart: "fire-start",
} as const;

/** 校内放送が終わった時に audio/ が送る signal の名前（サンプルの "narration-ended:<ID>" に合わせる） */
export const FIRE_ANNOUNCEMENT_ENDED_SIGNAL = `narration-ended:${DRILL_CUE_ID.fireAnnouncement}`;

/** 集合場所のエリアの ID（SPEC_01「エリアの ID」） */
export const ASSEMBLY_AREA_ID = "assembly";

/** ① 授業中の教室の長さ（s） */
export const CLASSROOM_SECONDS = 10;
/** ② 放送が終わらない時に次へ進むまでの秒数（s）．③ の制限時間はこの分を引く */
export const ALARM_SECONDS = 8;
/** 集合場所にいたら避難完了とする秒数（s） */
export const ASSEMBLY_HOLD_SECONDS = 1;
/** 締めの長さ（s） */
export const ENDING_SECONDS = 3;
/**
 * ③ の制限時間の下限（s）．timeLimitSeconds が ② の秒数以下でも，場面の制限時間を正の数に保つ
 * （validateScenario が 0 以下を誤りとするため）
 */
export const MIN_EVACUATE_SECONDS = 1;

/** 火元が教室でない時に校内放送で伝える場所の名前（仮の文面） */
const PLACE_NAME_BY_KIND: Partial<Record<CellKind, string>> = {
  corridor: "廊下",
  door: "廊下",
  shutter: "廊下",
  exit: "昇降口",
  outdoor: "校庭",
};
/** 場所が分からない時の名前（仮の文面） */
const UNKNOWN_PLACE_NAME = "校舎の中";

/**
 * 校舎データから火災訓練のシナリオを組み立てる．
 * 逃げ遅れ（③ の時間切れ）は，evacuate の StepRecord の outcome が "timedOut" になることで表す
 * （そのまま終了し，締めの場面には進まない）
 */
export function buildDrillScenario(plan: SchoolPlan): ScenarioDefinition {
  const fireRoomName = fireOriginName(plan);
  const evacuateSeconds = Math.max(
    plan.drill.timeLimitSeconds - ALARM_SECONDS,
    MIN_EVACUATE_SECONDS,
  );
  return {
    id: "fire-drill",
    title: plan.name === "" ? "火災避難訓練" : `火災避難訓練（${plan.name}）`,
    steps: [
      {
        id: DRILL_STEP.classroom,
        onEnter: [
          { type: "sound", id: DRILL_CUE_ID.classroomAmbience, action: "play", loop: true },
          { type: "narration", id: DRILL_CUE_ID.classroomIntro },
        ],
        goal: { type: "elapsed", seconds: CLASSROOM_SECONDS },
      },
      {
        id: DRILL_STEP.alarm,
        onEnter: [
          // ベルが鳴ったら授業の音は止める
          { type: "sound", id: DRILL_CUE_ID.classroomAmbience, action: "stop" },
          { type: "sound", id: DRILL_CUE_ID.fireAlarm, action: "play", loop: true },
          { type: "happening", id: DRILL_CUE_ID.fireStart },
          // 校内放送の文面に火元の名前を差し込む（audio/ が params.roomName を読む）
          {
            type: "narration",
            id: DRILL_CUE_ID.fireAnnouncement,
            params: { roomName: fireRoomName },
          },
        ],
        goal: {
          type: "any",
          conditions: [
            { type: "signal", name: FIRE_ANNOUNCEMENT_ENDED_SIGNAL },
            { type: "elapsed", seconds: ALARM_SECONDS },
          ],
        },
      },
      {
        id: DRILL_STEP.evacuate,
        onEnter: [{ type: "narration", id: DRILL_CUE_ID.evacuateStart }],
        goal: { type: "inArea", areaId: ASSEMBLY_AREA_ID, holdSeconds: ASSEMBLY_HOLD_SECONDS },
        // 逃げ遅れ: 締めに進まず打ち切る．ベルは結果画面へ持ち越さないよう止める
        timeout: {
          seconds: evacuateSeconds,
          cues: [{ type: "sound", id: DRILL_CUE_ID.fireAlarm, action: "stop" }],
          next: null,
        },
        report: {
          label: "火と煙を避けて集合場所まで避難する",
          advice: "火元から離れる道を選び，煙の中では低い姿勢で進みましょう",
        },
      },
      {
        id: DRILL_STEP.ending,
        onEnter: [
          { type: "sound", id: DRILL_CUE_ID.fireAlarm, action: "stop" },
          { type: "narration", id: DRILL_CUE_ID.ending },
        ],
        goal: { type: "elapsed", seconds: ENDING_SECONDS },
        next: null,
      },
    ],
  };
}

/**
 * 校内放送で伝える火元の名前．教室の火元は教室名（重なりを除き，火元の順に「と」でつなぐ），
 * 教室の火元が無ければ最初の火元のマスの種類から場所の名前を決める
 */
export function fireOriginName(plan: SchoolPlan): string {
  const roomNames: string[] = [];
  for (const origin of plan.drill.fireOrigins) {
    const room = roomAt(plan, origin);
    if (room !== null && !roomNames.includes(room)) roomNames.push(room);
  }
  if (roomNames.length > 0) return roomNames.join("と");
  const first = plan.drill.fireOrigins[0];
  const kind = first === undefined ? null : cellKindAt(plan, first);
  return (kind !== null ? PLACE_NAME_BY_KIND[kind] : undefined) ?? UNKNOWN_PLACE_NAME;
}

/** そのマスが教室なら教室の表示名，教室でない・範囲の外なら null */
function roomAt(plan: SchoolPlan, ref: CellRef): string | null {
  const floor = plan.floors[ref.floor];
  if (floor === undefined || !isInside(floor, ref.x, ref.z)) return null;
  const index = cellIndex(floor, ref.x, ref.z);
  if (floor.cells[index] !== "classroom") return null;
  const name = plan.rooms[floor.roomOf[index]]?.name;
  return name === undefined || name === "" ? null : name;
}

function cellKindAt(plan: SchoolPlan, ref: CellRef): CellKind | null {
  const floor = plan.floors[ref.floor];
  if (floor === undefined || !isInside(floor, ref.x, ref.z)) return null;
  return floor.cells[cellIndex(floor, ref.x, ref.z)] ?? null;
}
