// VR の中に文字だけを出す仮の表示の板（ロビーの指示板と同じ作り．頭の向きに緩く追いつく）．
// 未実装の画面の代わり（app/ の避難の仮の画面）に使う．文字は枠に収めて描く（lobbyRoom.ts の createLobbyPanel）

import type * as THREE from "three";
import type { Quat } from "../core/types";
import { createLobbyPanel, type PanelContent } from "./lobbyRoom";
import { angleDifference, yawOfQuat } from "./orientation";

/** 板が頭の向きに追いつく速さ（1/秒．ロビーの指示板と同じ） */
const FOLLOW_RATE = 1.2;

export interface NoticeBoard {
  /** world に足す（目の高さの正面 2 m の少し上に出る） */
  readonly object: THREE.Object3D;
  /** 内容が変わった時だけ描き直す */
  show(content: PanelContent): void;
  /** 毎フレーム呼ぶ．頭の向き（PlayerInput.head）に板を緩く合わせる（dt は s） */
  follow(head: Quat, dt: number): void;
  dispose(): void;
}

export function createNoticeBoard(): NoticeBoard {
  const panel = createLobbyPanel();
  panel.setHighlight(0);
  // 最初は正面にすぐ出す（入った瞬間に横から回り込んで見えないため）
  let placed = false;
  return {
    object: panel.object,
    show: (content) => panel.show(content),
    follow(head, dt) {
      const target = yawOfQuat(head);
      const current = panel.object.rotation.y;
      const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
      const rate = placed ? Math.min(1, step * FOLLOW_RATE) : 1;
      placed = true;
      panel.object.rotation.y = current + angleDifference(current, target) * rate;
    },
    dispose: () => panel.dispose(),
  };
}
