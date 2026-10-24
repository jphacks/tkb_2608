// 教室のパーツ（床の面＋中身）の three.js の Group を作る．並びは classroomLayout.ts の純粋な関数から出す．
// 机と椅子は材質ごとに InstancedMesh 1 つにまとめ（机の数によらず描画 3 回），中身なし（shell）では作らない

import * as THREE from "three";
import { createBox, createInstancedParts, mergeBoxes } from "../common/meshHelpers";
import {
  blackboardBoxes,
  type ClassroomInterior,
  type ClassroomUserData,
  classroomLayout,
  type DeskSetBoxes,
  deskSetBoxes,
  teacherDeskBoxes,
} from "./classroomLayout";
import { createFloorSurface, type SchoolPartContext } from "./schoolParts";

/** 教室の作り方 */
export interface ClassroomOptions {
  /** 幅（黒板の壁に沿うローカル X．m）．机の列数はここから決まる */
  readonly width: number;
  /** 奥行き（黒板から後ろの壁へ向かうローカル Z．m）．机の行数はここから決まる */
  readonly depth: number;
  /** 天井の高さ（m） */
  readonly ceilingHeight: number;
  /** 中身あり（furnished．既定）／外側だけ（shell） */
  readonly interior?: ClassroomInterior;
  readonly id?: string;
}

/**
 * 教室（床・天井・照明と，中身あり（furnished）なら黒板・教卓・机と椅子）．
 * 原点は床の面の中心で，黒板は -Z の端．周りの壁・窓・ドアは辺に置く物として別に置く（中身の有無によらず同じ）
 */
export function createClassroom(
  context: SchoolPartContext,
  options: ClassroomOptions,
): THREE.Group {
  const { width, depth, ceilingHeight } = options;
  const interior = options.interior ?? "furnished";
  const id = options.id ?? "classroom";
  const layout = classroomLayout(width, depth, interior);
  const m = context.materials;
  const group = new THREE.Group();
  group.name = id;
  const userData: ClassroomUserData = {
    kind: "schoolClassroom",
    id,
    width,
    depth,
    ceilingHeight,
    interior,
    furnished: layout.furnished,
    columns: layout.columns,
    rows: layout.rows,
  };
  group.userData = userData;
  group.add(
    createFloorSurface(context, {
      kind: "classroom",
      width,
      depth,
      ceilingHeight,
      id: `${id}-surface`,
      // 外側だけの教室は中が見えないため照明を省く
      lights: interior === "furnished",
    }),
  );
  if (!layout.furnished) return group;

  const sets = layout.desks.map(deskSetBoxes);
  const pick = (key: keyof DeskSetBoxes) => sets.flatMap((s) => s[key]);
  const parts: THREE.Object3D[] = [
    createInstancedParts(context.unitBox, m.wood, pick("wood"), `${id}-desks-wood`),
    createInstancedParts(context.unitBox, m.metal, pick("metal"), `${id}-desks-metal`),
    createInstancedParts(context.unitBox, m.storage, pick("storage"), `${id}-desks-storage`),
  ];
  if (layout.teacherDesk) {
    const desk = teacherDeskBoxes(layout.teacherDesk);
    const top = createBox(context.unitBox, m.wood, desk.top.size, desk.top.position);
    top.name = `${id}-teacher-desk-top`;
    const body = new THREE.Mesh(mergeBoxes(desk.panels), m.teacherDesk);
    body.name = `${id}-teacher-desk`;
    parts.push(top, body);
  }
  if (layout.blackboard) {
    const board = blackboardBoxes(layout.blackboard);
    parts.push(
      createBox(
        context.unitBox,
        m.blackboard,
        board.board.size,
        board.board.position,
        `${id}-blackboard`,
      ),
    );
    const frame = new THREE.Mesh(mergeBoxes(board.frame), m.frame);
    frame.name = `${id}-blackboard-frame`;
    parts.push(frame);
  }
  for (const part of parts) group.add(part);
  return group;
}
