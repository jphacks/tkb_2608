// 画面（シーン）の共通インターフェース．app/ が切り替え，各担当が実装する．
// three.js は型だけを import する（実行時には依存しない）．
// input/・scenario/ はこのファイルを import しない（types.ts・events.ts 等だけを使う）
import type { Object3D, Scene as ThreeScene } from "three";
import type { DrillEvaluation, DrillTrack } from "./drill";
import type { EventBus } from "./event-bus";
import type { AppEvent } from "./events";
import type { ScenarioResult } from "./result";
import type { PlanLoadError, SchoolPlan } from "./schoolPlan";
import type { CalibrationProfile, PlayerInput } from "./types";

/** 画面の種類．流れは start → home → lobby → scenario → debrief（docs/04_SPEC/SPEC_01） */
export type SceneId = "start" | "home" | "lobby" | "scenario" | "debrief";

/** 描画先．app/ が用意し，各シーンはここに物を足す */
export interface Stage {
  /** 3D 空間の根 */
  readonly world: ThreeScene;
  /** プレイヤーの体（カメラの親）．位置と体の向きはシーンが動かし，頭の向きは app/ がカメラに反映する */
  readonly rig: Object3D;
  /** VR 以外の HTML の画面（開始画面・結果画面）を置く要素 */
  readonly overlay: HTMLElement;
}

/** 画面をまたいで受け渡すデータ．各項目は書き込む担当が決まっている */
export interface Session {
  /** lobby/ が書く */
  calibration: CalibrationProfile | null;
  /** scenario の進行（app/）が書く */
  result: ScenarioResult | null;
  /** recording/ が書く（体験の録画．端末のメモリ上だけに持つ） */
  recording: Blob | null;
  /** app/ が URL（`#p=`）から読んで書く．読み込む前と読み込めなかった時は null */
  plan: SchoolPlan | null;
  /** app/ が書く（校舎データを読み込めなかった理由．開始画面（lobby/）が読んで案内を出す）．読み込めた時と URL に無い時は null */
  planLoadError: PlanLoadError | null;
  /**
   * app/ が書く（避難の記録と，sim/ の evaluateDrill() の評価．結果画面（debrief/）が読む）．
   * 避難を一度も終えていない時は null
   */
  drill: { readonly track: DrillTrack; readonly evaluation: DrillEvaluation } | null;
}

export interface SceneContext {
  readonly bus: EventBus<AppEvent>;
  readonly stage: Stage;
  readonly session: Session;
  /** 次の画面へ進むよう app/ に頼む（切り替えは次のフレームで行われる） */
  goTo(next: SceneId): void;
}

/** 1 フレーム分の情報 */
export interface FrameInfo {
  /** 前のフレームからの経過秒数 */
  readonly dt: number;
  readonly input: PlayerInput;
}

export interface Scene {
  readonly id: SceneId;
  /** 画面に入る時に 1 回呼ばれる．素材の読み込みを待つ場合は Promise を返す */
  enter(ctx: SceneContext): void | Promise<void>;
  /** 毎フレーム呼ばれる */
  update(frame: FrameInfo): void;
  /** 画面を出る時に 1 回呼ばれる．足した物と購読を片付ける */
  exit(): void;
}

/** シナリオの判定に使う，部屋の中の今の状態（scenes/ の部屋が実装する） */
export interface WorldObservation {
  /** プレイヤーが今いるエリアの ID（重なっていれば複数） */
  readonly areaIds: readonly string[];
}

/** シナリオを進める部屋が持つ機能（scenes/ の部屋のシーンが実装する） */
export interface ScenarioWorld {
  observe(): WorldObservation;
}
