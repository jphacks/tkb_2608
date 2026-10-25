// 発表のデモ用の校舎（`?app&demo`・`?monitor&demo` で `#p=` が無い時．Issue #189）．
// 同梱のデモの校舎（demoSchool.ts）をもとに，火元をシャッターより西の 1年2組へ移し，西の昇降口をふさいで，
// 煙の中を廊下へ出る → 燃えている 1年2組の前（火の前の警告）→ x = 12 の防火シャッターのくぐり戸 → 東の昇降口 → 東側の校庭，
// を 1 本の経路で見せる．実機で調整する値はこのファイル冒頭の定数にまとめる
import type { CellRef, SchoolPlan } from "../../core/schoolPlan";
import { createFloorFromRows } from "./floorFromRows";

const at = (x: number, z: number): CellRef => ({ floor: 0, x, z });

/** 火元（1年2組の奥の隅．ドア (7,5) から 9 マス．火 1 マス 3 秒でドア前の廊下 (7,6) に約 30 秒で着く） */
const FIRE_ORIGIN = at(11, 0);
/** 煙の発生源（1年1組のドアの前の廊下．放送の直後から煙がある） */
const SMOKE_SOURCE = at(5, 6);
/** 煙が出始める時刻（s．非常ベルが 0） */
const SMOKE_START_SECONDS = 0;
/** 火が 1 マス広がるのにかかる秒数 */
const FIRE_SECONDS_PER_CELL = 3;
/** 煙が 1 マス広がるのにかかる秒数 */
const SMOKE_SECONDS_PER_CELL = 1;
/** 制限時間（s） */
const TIME_LIMIT_SECONDS = 60;
/** 開始の向き（0 で -Z，正で左へ回る）．-3π/4 は南東（1年1組のドアと東の廊下の側）を向く */
const START_YAW = (-3 * Math.PI) / 4;

/**
 * デモ用の校舎のマス目（記号は DEMO_SCHOOL_ROWS と同じ）．DEMO_SCHOOL_ROWS との違いは西の昇降口 (2,7) を廊下にしてふさいだことだけ
 */
export const DEMO_PITCH_SCHOOL_ROWS: readonly string[] = [
  //           111111111
  // 0123456789012345678 ← x（0 から 18）
  "000000111111#222222", // z = 0（各教室の黒板の側．1年2組の (11,0) が火元）
  "000000111111#222222", // z = 1
  "000000111111#222222", // z = 2
  "000000111111#222222", // z = 3
  "000000111111#222222", // z = 4
  "0000d01d1111#2d2222", // z = 5（教室のドア）
  "hhhhhhhhhhhhshhhhhh", // z = 6（廊下．(5,6) が煙の発生源）
  "hhhhhhhhhhhhshhhehh", // z = 7（廊下．東の昇降口だけ）
  "oooooooooooo#oooooo", // z = 8（校庭．シャッターの下は柱）
  "ooooooooooooooooooo", // z = 9
  "ooooooooooooooooooo", // z = 10
  "ooooooooooooooooooo", // z = 11
  "ooooooooooooooooooo", // z = 12
];

/** 正解の経路: 1年1組 → ドア (4,5) → 廊下 (4,7) → z = 7 を東へ（1年2組の前）→ シャッター (12,7) → 東の昇降口 (16,7) → 集合場所 */
const ROUTE: readonly CellRef[] = [
  at(2, 2),
  at(2, 3),
  at(2, 4),
  at(3, 4),
  at(4, 4),
  at(4, 5), // 1年1組のドア
  at(4, 6),
  ...Array.from({ length: 13 }, (_, i) => at(4 + i, 7)), // (4,7) から (16,7)．(12,7) がシャッター，(16,7) が東の昇降口
  at(16, 8),
  at(16, 9),
  at(16, 10), // 集合場所
];

/** 発表のデモ用の校舎と訓練条件 */
export const DEMO_PITCH_SCHOOL: SchoolPlan = {
  version: 1,
  name: "デモ小学校 北校舎",
  cellSize: 1,
  floors: [createFloorFromRows(1, DEMO_PITCH_SCHOOL_ROWS)],
  rooms: [{ name: "1年1組" }, { name: "1年2組" }, { name: "理科室" }],
  drill: {
    mode: "learn",
    fireOrigins: [FIRE_ORIGIN],
    start: at(2, 2),
    startYaw: START_YAW,
    // 東側の校庭（2 × 2 マス）
    assembly: [at(15, 10), at(16, 10), at(15, 11), at(16, 11)],
    route: ROUTE,
    spread: {
      fireSecondsPerCell: FIRE_SECONDS_PER_CELL,
      smokeSecondsPerCell: SMOKE_SECONDS_PER_CELL,
      extraFires: [],
      extraSmokes: [{ cell: SMOKE_SOURCE, atSeconds: SMOKE_START_SECONDS }],
    },
    timeLimitSeconds: TIME_LIMIT_SECONDS,
  },
};
