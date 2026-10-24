// 開始画面で取った許可の結果から，先へ進むかを決める（DOM に依存しない純粋な関数）
//
// 方針（docs/04_SPEC/SPEC_01「未決事項」のカメラ拒否時の扱いを担当C として決めたもの）
// - センサー（動き・向き）: 足踏み・しゃがみ・頭の向きのすべてに要るため，拒否されたら先へ進まず，
//   案内を出して再試行させる．開発・PC 用に「センサーなしで進む」も選べる
//   （センサーが無い端末（PC 等）は許可が要らないので，そのまま進む．ロビーは時間切れで既定値になる）
// - カメラ: 手を使わずに進める（ゴーグルを外して操作させないため）．手を使う場面は制限時間で先へ進む．
//   iOS の Safari は一度拒否するとページを再読み込みするまで再び尋ねないため，その場での再試行は出さず，
//   再読み込みすれば使えることを案内する
// - 音: 再開できなくても進む（消音モードの解除を案内する）

/**
 * 許可の結果．
 * granted = 許可された，notRequired = 許可の確認が要らない（requestPermission が無いブラウザ），
 * denied = 拒否された，unavailable = 機能や機器が無い（カメラが無い・HTTPS でない等），error = その他の失敗
 */
export type PermissionOutcome = "granted" | "notRequired" | "denied" | "unavailable" | "error";

export interface PermissionResults {
  /** DeviceMotionEvent / DeviceOrientationEvent（iOS では同じ「モーションと画面の向き」の許可） */
  readonly motion: PermissionOutcome;
  readonly camera: PermissionOutcome;
  readonly audio: PermissionOutcome;
}

export type StartDecision =
  | {
      readonly kind: "proceed";
      /** カメラ（手の認識）が使えるか */
      readonly handsAvailable: boolean;
      /** 進む前に見せる案内（無ければ空） */
      readonly notices: readonly string[];
    }
  | {
      readonly kind: "needsMotion";
      readonly message: string;
    };

export interface StartDecisionOptions {
  /** センサーが使えなくても進む（「センサーなしで進む」を選んだ時） */
  readonly allowWithoutMotion: boolean;
}

function isUsable(outcome: PermissionOutcome): boolean {
  return outcome === "granted" || outcome === "notRequired";
}

export function decideStart(
  results: PermissionResults,
  options: StartDecisionOptions = { allowWithoutMotion: false },
): StartDecision {
  const motionBlocked = results.motion === "denied" || results.motion === "error";
  if (motionBlocked && !options.allowWithoutMotion) {
    return {
      kind: "needsMotion",
      message:
        "体の動きを読み取るため，「動作と方向」へのアクセスを許可してください．" +
        "許可の確認が出ない時は，ページを再読み込みしてから「はじめる」を押してください．" +
        "それでも出ない時は，Safari を閉じて開き直してください",
    };
  }

  const notices: string[] = [];
  if (motionBlocked) {
    notices.push("センサーが使えないため，体の動きは反映されません");
  }
  const handsAvailable = isUsable(results.camera);
  if (results.camera === "denied") {
    notices.push(
      "カメラが許可されなかったため，手を使わずに進みます．手を使うには，ページを再読み込みしてカメラを許可してください",
    );
  } else if (!handsAvailable) {
    notices.push("カメラが使えないため，手を使わずに進みます");
  }
  if (!isUsable(results.audio)) {
    notices.push("音が出ない時は，消音モード（マナーモード）を解除してください");
  }
  return { kind: "proceed", handsAvailable, notices };
}
