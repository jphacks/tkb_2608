// 校舎のパーツの Group（userData）から，歩行の当たり判定（walk/ の WalkWorld の材料）を取り出す．
// 範囲の計算は schoolLayout.ts・classroomLayout.ts の純粋な関数で行い，ここでは置いた先の座標に変えるだけ．
// パーツの位置・向きは root から見た値として読む（パーツは Y 軸回りにだけ回す前提）

import type * as THREE from "three";
import type { FloorArea } from "../walk/areas";
import type { Obstacle, XZRect } from "../walk/collision";
import type { DoorBlocker } from "../walk/locomotion";
import { type ClassroomUserData, classroomLayout, classroomObstacles } from "./classroomLayout";
import {
  blockObstacle,
  edgeClosableObstacle,
  edgeLayout,
  edgeStaticObstacles,
  exitOutsideRect,
  exitSillRect,
  type FireShutterUserData,
  type FloorSurfaceUserData,
  fireShutterCurtainObstacles,
  floorSurfaceLayout,
  type PartPlacement,
  placeObstacle,
  placeRect,
  postObstacle,
  type SchoolBlockUserData,
  type SchoolDoorUserData,
  type SchoolEdgeUserData,
  type SchoolPostUserData,
} from "./schoolLayout";

/** パーツから取り出した当たり判定の材料（root の座標） */
export interface SchoolCollision {
  /** 動かない障害物（壁の板・柱・マスをふさぐ直方体・シャッターのガイドレール・教室の中身） */
  readonly obstacles: readonly Obstacle[];
  /** 閉じている間だけふさぐ物（ドアの開口部・シャッターの幕） */
  readonly doors: readonly DoorBlocker[];
  /** 体の中心が動ける床の範囲（床の面・出口の外のポーチと敷居） */
  readonly floors: readonly XZRect[];
  /** エリア（床の面の id・出口の外 `${出口の id}-outside`） */
  readonly areas: readonly FloorArea[];
}

type PartUserData =
  | FloorSurfaceUserData
  | ClassroomUserData
  | SchoolEdgeUserData
  | SchoolPostUserData
  | SchoolBlockUserData;

function partUserData(object: THREE.Object3D): PartUserData | null {
  const kind = (object.userData as { kind?: unknown }).kind;
  return kind === "schoolFloor" ||
    kind === "schoolClassroom" ||
    kind === "schoolEdge" ||
    kind === "schoolPost" ||
    kind === "schoolBlock"
    ? (object.userData as PartUserData)
    : null;
}

/** root から見たパーツの置き方（行列の平行移動と，ローカル Z 軸の向きから求めた Y 軸回りの回転） */
function placementInRoot(root: THREE.Object3D, object: THREE.Object3D): PartPlacement {
  // root からの相対の行列を，親をたどって掛け合わせずに求めるため，root が原点にある前提を置かず差を取る
  const e = object.matrixWorld.elements;
  const r = root.matrixWorld.elements;
  const rootYaw = Math.atan2(r[8] ?? 0, r[10] ?? 1);
  const yaw = Math.atan2(e[8] ?? 0, e[10] ?? 1);
  const dx = (e[12] ?? 0) - (r[12] ?? 0);
  const dz = (e[14] ?? 0) - (r[14] ?? 0);
  // root の回転を戻す（root の yaw だけ逆に回す）
  const c = Math.cos(-rootYaw);
  const s = Math.sin(-rootYaw);
  return { x: dx * c + dz * s, z: -dx * s + dz * c, rotationY: yaw - rootYaw };
}

/** 当たり判定の集め方の追加の指定 */
export interface SchoolCollisionOptions {
  /**
   * 閉じた防火シャッターでも，くぐり戸の範囲は人が通れるようにするか（既定 false）．
   * くぐり戸を手で押して開ける動作（S4）が入るまでは，常に通れる扱いにする（SPEC_02「通れる・燃え広がる」）．
   * 範囲は見た目のくぐり戸と同じ寸法（edgeLayout の shutter.wicket）から求める
   */
  readonly shutterWicketPassable?: boolean;
}

/**
 * root の配下の校舎のパーツから当たり判定の材料を集める（作る時の 1 回だけ呼ぶ）．
 * ドア・シャッターは userData の open・closed を毎回読むため，開閉は後から反映される
 */
export function collectSchoolCollision(
  root: THREE.Object3D,
  options: SchoolCollisionOptions = {},
): SchoolCollision {
  const wicketPassable = options.shutterWicketPassable ?? false;
  root.updateMatrixWorld(true);
  const obstacles: Obstacle[] = [];
  const doors: DoorBlocker[] = [];
  const floors: XZRect[] = [];
  const areas: FloorArea[] = [];
  root.traverse((object) => {
    const data = partUserData(object);
    if (!data) return;
    const placement = placementInRoot(root, object);
    const place = (o: Obstacle) => placeObstacle(o, placement);
    switch (data.kind) {
      case "schoolFloor": {
        const rect = placeRect(
          floorSurfaceLayout(data.floorKind, data.width, data.depth, data.ceilingHeight).rect,
          placement,
        );
        floors.push(rect);
        areas.push({ id: data.id, ...rect });
        return;
      }
      case "schoolClassroom": {
        const layout = classroomLayout(data.width, data.depth, data.interior);
        obstacles.push(...classroomObstacles(layout, data.id).map(place));
        return;
      }
      case "schoolPost":
        obstacles.push(place(postObstacle(data.height, data.id)));
        return;
      case "schoolBlock":
        obstacles.push(place(blockObstacle(data.width, data.depth, data.height, data.id)));
        return;
      case "schoolEdge": {
        const layout = edgeLayout(
          data.edgeKind,
          data.length,
          data.height,
          data.edgeKind === "fireShutter" ? { wicketOffset: data.wicketOffset } : {},
        );
        obstacles.push(...edgeStaticObstacles(layout, data.id).map(place));
        const closable = edgeClosableObstacle(layout, data.id);
        if (closable && data.edgeKind === "door") {
          const door = data as SchoolDoorUserData;
          doors.push({ id: data.id, obstacle: place(closable), isOpen: () => door.open });
        }
        if (closable && data.edgeKind === "fireShutter") {
          const shutter = data as FireShutterUserData;
          const isOpen = () => !shutter.closed;
          if (wicketPassable) {
            // 幕をくぐり戸の周りの板に分け，閉じている間は板だけがふさぐ（くぐり戸の下端の板は敷居と同じくまたげる高さ）
            for (const piece of fireShutterCurtainObstacles(layout, data.id, true)) {
              doors.push({ id: piece.id, obstacle: place(piece), isOpen });
            }
          } else {
            doors.push({ id: data.id, obstacle: place(closable), isOpen });
          }
        }
        if (data.edgeKind === "exit") {
          const outside = placeRect(exitOutsideRect(layout), placement);
          floors.push(outside, placeRect(exitSillRect(layout), placement));
          areas.push({ id: `${data.id}-outside`, ...outside });
        }
        return;
      }
    }
  });
  return { obstacles, doors, floors, areas };
}
