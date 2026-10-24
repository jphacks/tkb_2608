// 歩行（移動・目の高さ・着座）の 1 フレーム分の計算（three に依存しない純粋な関数）．
// 入力（PlayerInput）と空間の当たり判定の情報（WalkWorld）から，次のプレイヤーの状態を求める

import type { PlayerInput, Quat } from "../../core/types";
import type { FloorArea } from "./areas";
import {
  type BodyShape,
  DEFAULT_BODY,
  headroomAt,
  moveWithCollision,
  type Obstacle,
  rectContains,
  resolveOverlaps,
  type XZRect,
} from "./collision";

/** 空間ごとの目の高さ（床から，m） */
export interface EyeHeights {
  readonly standing: number;
  readonly crouching: number;
}

/** 開閉で通れる・通れないが切り替わるドア．閉じている間だけ obstacle が行く手をふさぐ */
export interface DoorBlocker {
  readonly id: string;
  readonly obstacle: Obstacle;
  /** 今開いているか（ドアの userData.open を読む） */
  isOpen(): boolean;
}

/** 腰を下ろせる場所 1 人分（電車の座席） */
export interface SeatSpot {
  readonly id: string;
  /** 座ったときの目の位置（ワールド座標．eyeHeight は床から） */
  readonly x: number;
  readonly z: number;
  readonly eyeHeight: number;
  /** 座ったときの向き（0 で -Z，正で左へ回る） */
  readonly facingYaw: number;
  /** この範囲に立ってしゃがむと座る（座席の前の床） */
  readonly zone: XZRect;
}

/** 空間の当たり判定・エリア・目の高さの情報 */
export interface WalkWorld {
  /** 体の中心が出られない床の範囲（矩形の和．車外の線路等へ出ないようにする） */
  readonly floors: readonly XZRect[];
  /** 動かない障害物（壁・家具） */
  readonly obstacles: readonly Obstacle[];
  readonly doors: readonly DoorBlocker[];
  readonly areas: readonly FloorArea[];
  readonly eyeHeights: EyeHeights;
  readonly seats: readonly SeatSpot[];
  readonly body?: BodyShape;
}

/** プレイヤーの状態（ワールド座標．eyeHeight は床からの目の高さ） */
export interface WalkState {
  readonly x: number;
  readonly z: number;
  readonly eyeHeight: number;
  /** 前のフレームの姿勢（しゃがみ始めた瞬間を知るため） */
  readonly posture: PlayerInput["posture"];
  /** 座っている座席（座っていなければ null） */
  readonly seat: SeatSpot | null;
  /** 座る前に立っていた位置（立ち上がるとここへ戻る） */
  readonly standX: number;
  readonly standZ: number;
}

/** 1 フレームで進める時間の上限（秒）．タブを戻した直後等に大きく飛ばないように */
export const MAX_STEP_SECONDS = 0.1;
/** 前進の速さの上限（m/s）．入力の誤りで壁を抜けるほど速くならないように */
export const MAX_WALK_SPEED = 2;
/** 目の高さを変える速さ（m/s）．しゃがむ・立つで視点が瞬間的に飛ばないように */
export const EYE_HEIGHT_SPEED = 2.5;
/** 座るときに，座席の向きと体の向きの差がこれ以内であること（rad．座席に向かってしゃがんでも座らない） */
export const SIT_FACING_LIMIT = (60 * Math.PI) / 180;

/** 角度を (-π, π] に収める */
export function wrapAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  const wrapped = angle - twoPi * Math.floor((angle + Math.PI) / twoPi);
  return wrapped === -Math.PI ? Math.PI : wrapped;
}

/** 頭の向き（クォータニオン）の Y 軸回りの角度（rad．0 で -Z，正で左．three の Euler "YXZ" の y） */
export function headYaw(q: Quat): number {
  return Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y));
}

/** current を target へ最大 maxDelta だけ近づける */
export function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
}

/** 今閉じているドアの障害物を加えた障害物の一覧 */
export function activeObstacles(world: WalkWorld): Obstacle[] {
  const list = [...world.obstacles];
  for (const door of world.doors) {
    if (!door.isOpen()) list.push(door.obstacle);
  }
  return list;
}

/** 開始時の状態 */
export function initialWalkState(x: number, z: number, eyeHeight: number): WalkState {
  return { x, z, eyeHeight, posture: "standing", seat: null, standX: x, standZ: z };
}

/** (x, z) でしゃがみ始めた時に座る座席（体の向き yaw が座席の向きに近いものだけ）．無ければ null */
export function seatToSit(
  seats: readonly SeatSpot[],
  x: number,
  z: number,
  yaw: number,
): SeatSpot | null {
  for (const seat of seats) {
    if (!rectContains(seat.zone, x, z)) continue;
    if (Math.abs(wrapAngle(yaw - seat.facingYaw)) <= SIT_FACING_LIMIT) return seat;
  }
  return null;
}

/**
 * 1 フレーム分進める．bodyYaw は体（rig）の向きで，進む向きは体の向き＋頭の向き．
 * - 立っている・しゃがんでいる: 足踏みの間だけ前へ進み，壁・物に当たると滑る．
 *   目の高さは姿勢の高さへ少しずつ近づけ，頭上に物（天板等）があればその下に収まる高さで止める
 * - 座席の前でしゃがみ始めると座り（目の位置は座席の着座位置），立つと座る前の位置へ戻る
 */
export function stepWalk(
  state: WalkState,
  input: PlayerInput,
  dt: number,
  world: WalkWorld,
  bodyYaw: number,
): WalkState {
  const body = world.body ?? DEFAULT_BODY;
  const seconds = Math.min(Math.max(dt, 0), MAX_STEP_SECONDS);
  const eyeStep = EYE_HEIGHT_SPEED * seconds;
  const yaw = bodyYaw + headYaw(input.head);

  if (state.seat !== null) {
    if (input.posture === "standing") {
      return {
        ...state,
        x: state.standX,
        z: state.standZ,
        posture: input.posture,
        seat: null,
      };
    }
    return {
      ...state,
      eyeHeight: approach(state.eyeHeight, state.seat.eyeHeight, eyeStep),
      posture: input.posture,
    };
  }

  if (state.posture === "standing" && input.posture === "crouching") {
    const seat = seatToSit(world.seats, state.x, state.z, yaw);
    if (seat !== null) {
      return {
        x: seat.x,
        z: seat.z,
        eyeHeight: state.eyeHeight,
        posture: input.posture,
        seat,
        standX: state.x,
        standZ: state.z,
      };
    }
  }

  const obstacles = activeObstacles(world);
  const headTop = state.eyeHeight + body.headClearance;
  const speed = input.walking ? Math.min(Math.max(input.walkSpeed, 0), MAX_WALK_SPEED) : 0;
  const distance = speed * seconds;
  // 進まない時も押し出す（閉じたドアに重なった時等）
  const moved =
    distance > 0
      ? moveWithCollision(
          state.x,
          state.z,
          -Math.sin(yaw) * distance,
          -Math.cos(yaw) * distance,
          headTop,
          obstacles,
          world.floors,
          body,
        )
      : resolveOverlaps(state.x, state.z, headTop, obstacles, body);

  const postureEye =
    input.posture === "crouching" ? world.eyeHeights.crouching : world.eyeHeights.standing;
  const ceiling = headroomAt(moved.x, moved.z, headTop, obstacles, body);
  const target = Math.min(postureEye, ceiling - body.headClearance);
  // 上がるのは頭上の空きの分だけ．下がるのはしゃがみの高さまで
  const eyeHeight = approach(
    state.eyeHeight,
    Math.max(target, world.eyeHeights.crouching),
    eyeStep,
  );

  return {
    x: moved.x,
    z: moved.z,
    eyeHeight,
    posture: input.posture,
    seat: null,
    standX: moved.x,
    standZ: moved.z,
  };
}
