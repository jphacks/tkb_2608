// 空間の中でプレイヤーを歩かせる（Scene.update で担当B が行う処理．docs/04_SPEC/SPEC_01「毎フレームの処理」）．
// 入力は FrameInfo.input だけから受け取り，計算は locomotion.ts の純粋な関数で行う．
// エリアの出入りは GameEvent（areaEntered／areaExited）として emit に渡し，今いるエリアは observe() で返す

import type { Object3D } from "three";
import type { GameEvent } from "../../core/events";
import type { FrameInfo, ScenarioWorld, WorldObservation } from "../../core/scene";
import { areasAt, diffAreaIds } from "./areas";
import { initialWalkState, stepWalk, type WalkState, type WalkWorld } from "./locomotion";

export interface WalkerStart {
  /** 開始時の目の位置（ワールド座標．y は床からの目の高さ） */
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  /** 体の向き（rig の rotation.y．0 で -Z，正で左へ回る） */
  readonly bodyYaw: number;
}

export class SpaceWalker implements ScenarioWorld {
  private walkState: WalkState;
  private areaIds: readonly string[];

  constructor(
    private readonly world: WalkWorld,
    private readonly start: WalkerStart,
    private readonly emit: (event: GameEvent) => void,
  ) {
    const { x, y, z } = start.position;
    this.walkState = initialWalkState(x, z, y);
    // 開始位置のエリアは出入りとして流さない（observe() で返す）
    this.areaIds = areasAt(world.areas, x, z);
  }

  get state(): WalkState {
    return this.walkState;
  }

  /** 1 フレーム分動かし，エリアの出入りを流す */
  update(frame: FrameInfo): void {
    this.walkState = stepWalk(
      this.walkState,
      frame.input,
      frame.dt,
      this.world,
      this.start.bodyYaw,
    );
    const next = areasAt(this.world.areas, this.walkState.x, this.walkState.z);
    const { entered, exited } = diffAreaIds(this.areaIds, next);
    this.areaIds = next;
    for (const areaId of exited) this.emit({ type: "areaExited", areaId });
    for (const areaId of entered) this.emit({ type: "areaEntered", areaId });
  }

  /** プレイヤーの体（rig．カメラの親）を今の位置・体の向きに合わせる */
  applyTo(rig: Object3D): void {
    rig.position.set(this.walkState.x, this.walkState.eyeHeight, this.walkState.z);
    rig.rotation.set(0, this.start.bodyYaw, 0);
  }

  observe(): WorldObservation {
    return { areaIds: this.areaIds };
  }
}
