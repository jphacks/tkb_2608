// 見守り画面（monitor/）の中で使う型．校舎の 3D（scenes/school/）・ロビー（lobby/）・結果画面（debrief/）は app/ が組み立てて渡す
import type { ColorRepresentation, Fog, FogExp2, Object3D, Vector3 } from "three";
import type { DrillEvaluation, DrillTrack } from "../core/drill";
import type { CellRef } from "../core/schoolPlan";
import type { Posture } from "../core/types";

/** 見守り画面で描く校舎の 3D（app/ が scenes/school/ の校舎から作る） */
export interface MonitorWorld {
  /** Scene に足す親（照明も含む） */
  readonly root: Object3D;
  readonly background: ColorRepresentation;
  /** 煙のフォグ（無ければ null）．濃さは update が書き換える */
  readonly fog: Fog | FogExp2 | null;
  /** 開始地点（ワールド座標，m）と開始の向き（rad．0 で -Z を向き，正で左へ回る．Space.startYaw と同じ） */
  readonly start: { readonly x: number; readonly z: number; readonly yaw: number };
  /** 姿勢ごとの目の高さ（m．生徒の画面と同じ値） */
  eyeHeight(posture: Posture): number;
  /**
   * 火と煙を時刻に合わせる．
   * @param seconds 非常ベルからの秒数（s）．火と煙を出さない時は NaN
   * @param eye 目の位置（ワールド座標，m）．目が無い時（描かない時）は null
   */
  update(seconds: number, eye: Vector3 | null): void;
  /** ドアのマスのドアを開ける・閉める（ドアの無いマスは何もしない） */
  setDoorOpen(cell: CellRef, open: boolean): void;
  /** すべてのドアを最初の状態に戻す */
  resetDoors(): void;
  dispose(): void;
}

/** 見守り画面で描くロビーの板の内容（lobby の知らせの中身） */
export interface MonitorLobbyView {
  readonly title: string;
  readonly body: string;
  readonly caption: string;
  readonly startButton: boolean;
  readonly alignMarker: boolean;
}

/** 見守り画面で描くロビーの部屋と板（app/ が lobby/ の部屋・板・開始ボタン・十字から作る） */
export interface MonitorLobbyWorld {
  /** Scene に足す親（部屋と板．照明も含む） */
  readonly root: Object3D;
  /** カメラの子にする物（見え方の調整の十字．視野の中心に固定する） */
  readonly cameraAttachment: Object3D;
  readonly background: ColorRepresentation;
  /** 目の高さ（m．生徒のロビーと同じ値） */
  readonly eyeHeight: number;
  /** 板の内容・開始ボタン・十字の表示を変える（変わった時だけ描き直す） */
  show(view: MonitorLobbyView): void;
  /**
   * 板を頭の向きに緩く追いつかせる（生徒のロビーと同じ速さ）．
   * @param headYaw 頭の水平の向き（rad．0 で -Z を向き，正で左へ回る）
   * @param dt 前のフレームからの時間（s）
   */
  follow(headYaw: number, dt: number): void;
  /** 板を正面（向き 0）に戻す（ロビーに入り直した時．生徒のロビーも正面から始まる） */
  reset(): void;
  dispose(): void;
}

/** 結果画面（app/ が debrief/ の結果画面から作る） */
export interface MonitorResultView {
  /** 記録と評価で結果画面を出す（出していれば作り直す） */
  show(drill: { readonly track: DrillTrack; readonly evaluation: DrillEvaluation }): void;
  /** 出していれば消す */
  hide(): void;
}
