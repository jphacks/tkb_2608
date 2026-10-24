// 同梱のデモの校舎（1 フロア・教室 3 つ・廊下・昇降口 2 つ・校庭）．`?app` で `#p=` が無い時の校舎で，
// エディタができる前に 3D の校舎（scenes/school/）・延焼と経路（sim/）・結果画面（debrief/）を試すために使う
import type { CellRef, SchoolPlan } from "../../core/schoolPlan";
import { createFloorFromRows } from "./floorFromRows";

/**
 * デモの校舎のマス目（1 文字 1 マス．1 m／マス．幅 19 × 奥行き 13）．
 * 数字は教室（DEMO_SCHOOL.rooms の添字），`h` 廊下，`d` ドア，`e` 昇降口，`s` 防火シャッター，`#` 柱・厚い壁，`o` 校庭．
 * 理科室（2）が火元で，廊下の x = 12 の防火シャッターで火と煙が西へ広がるのを止める．
 * シャッターの上下は `#` にして，シャッターのマスが理科室・校庭への抜け道にならないようにしている（開口は隣の床と壁なしでつながるため）
 */
export const DEMO_SCHOOL_ROWS: readonly string[] = [
  //           111111111
  // 0123456789012345678 ← x（0 から 18）
  "000000111111#222222", // z = 0（各教室の黒板の側）
  "000000111111#222222", // z = 1
  "000000111111#222222", // z = 2
  "000000111111#222222", // z = 3
  "000000111111#222222", // z = 4
  "0000d01d1111#2d2222", // z = 5（教室のドア）
  "hhhhhhhhhhhhshhhhhh", // z = 6（廊下）
  "hhehhhhhhhhhshhhehh", // z = 7（廊下．西と東の昇降口）
  "oooooooooooo#oooooo", // z = 8（校庭．シャッターの下は柱）
  "ooooooooooooooooooo", // z = 9
  "ooooooooooooooooooo", // z = 10
  "ooooooooooooooooooo", // z = 11
  "ooooooooooooooooooo", // z = 12
];

const at = (x: number, z: number): CellRef => ({ floor: 0, x, z });

/** デモの校舎と訓練条件（既定値は SPEC_02「型」の既定値のまま） */
export const DEMO_SCHOOL: SchoolPlan = {
  version: 1,
  name: "デモ小学校 北校舎",
  cellSize: 1,
  floors: [createFloorFromRows(1, DEMO_SCHOOL_ROWS)],
  rooms: [{ name: "1年1組" }, { name: "1年2組" }, { name: "理科室" }],
  drill: {
    mode: "learn",
    // 理科室の奥（開始地点の 1年1組とは別の教室．シャッターより東）
    fireOrigins: [at(16, 2)],
    // 1年1組の中ほど．0 rad（-Z）は黒板の側を向く
    start: at(2, 2),
    startYaw: 0,
    // 校庭の中ほど（2 × 2 マス）
    assembly: [at(8, 10), at(9, 10), at(8, 11), at(9, 11)],
    // 1年1組のドア → 廊下を西へ → 西の昇降口 → 校庭の集合場所．火元の側（東の昇降口）は通らない
    route: [
      at(2, 2),
      at(2, 3),
      at(2, 4),
      at(3, 4),
      at(4, 4),
      at(4, 5), // 1年1組のドア
      at(4, 6),
      at(3, 6),
      at(2, 6),
      at(2, 7), // 西の昇降口
      at(2, 8),
      at(2, 9),
      at(2, 10),
      at(3, 10),
      at(4, 10),
      at(5, 10),
      at(6, 10),
      at(7, 10),
      at(8, 10), // 集合場所
    ],
    spread: {
      fireSecondsPerCell: 6,
      smokeSecondsPerCell: 2,
      extraFires: [],
    },
    timeLimitSeconds: 150,
  },
};
