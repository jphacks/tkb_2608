// 開始画面で取った許可の結果から，先へ進むかを決める（DOM に依存しない純粋な関数）
//
// 方針（docs/04_SPEC/SPEC_01「未決事項」のカメラ拒否時の扱いを担当C として決めたもの）
// - センサー（動き・向き）: 足踏み・しゃがみ・頭の向きのすべてに要るため，拒否されたら先へ進まず，
//   案内を出して再試行させる．開発・PC 用に「センサーなしで進む」も選べる
//   （センサーが無い端末（PC 等）は許可が要らないので，そのまま進む．ロビーは時間切れで既定値になる）
// - カメラ: ロビーの開始ボタンを手で触れて始めるため（startGate.ts の startMode: "hand"），
//   拒否された・無い・HTTPS でない時は先へ進まず，再読み込みしてカメラを許可するよう案内する（Issue #110 の人間の決定）．
//   iOS の Safari は一度拒否するとページを再読み込みするまで再び尋ねないため，その場での再試行は出さず，
//   再読み込みを案内する．手を input/ の mock（マウス）等で作る時は requireCamera を false にし，手を使わずに進む
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
      /** カメラが使えるか（requireCamera が false の時は使えないまま進むことがある） */
      readonly handsAvailable: boolean;
      /** 進む前に見せる案内（無ければ空） */
      readonly notices: readonly string[];
    }
  | {
      readonly kind: "needsMotion";
      readonly message: string;
    }
  | {
      /** カメラが使えないため進めない（再読み込みしてカメラを許可するよう案内する） */
      readonly kind: "needsCamera";
      readonly message: string;
    };

export interface StartDecisionOptions {
  /** センサーが使えなくても進む（「センサーなしで進む」を選んだ時） */
  readonly allowWithoutMotion: boolean;
  /**
   * カメラが使えなければ進まない（既定 true）．手をカメラ以外から作る入力（PC の mock・記録の再生）では
   * app/ が false にし，カメラが使えなくても案内付きで進む
   */
  readonly requireCamera?: boolean;
}

/** カメラが使えない時の案内（結果ごと）．どれも再読み込みを促す */
function cameraHelpMessage(outcome: PermissionOutcome): string {
  const lead = "カメラを使います（手で開始ボタンに触れて始めるため）．";
  switch (outcome) {
    case "denied":
      return (
        `${lead}ページを再読み込みして，カメラを許可してください．` +
        "許可の確認が出ない時は，Safari を閉じて開き直してから QR コードを読み直してください"
      );
    case "unavailable":
      return (
        `${lead}カメラが見つかりませんでした．ページを再読み込みしてください．` +
        "それでも使えない時は，カメラのあるスマホで QR コードから開き直してください"
      );
    default:
      return (
        `${lead}カメラを起動できませんでした．カメラを使っている他のアプリを閉じてから，` +
        "ページを再読み込みしてください"
      );
  }
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

  const handsAvailable = isUsable(results.camera);
  const requireCamera = options.requireCamera ?? true;
  if (!handsAvailable && requireCamera) {
    return { kind: "needsCamera", message: cameraHelpMessage(results.camera) };
  }

  const notices: string[] = [];
  if (motionBlocked) {
    notices.push("センサーが使えないため，体の動きは反映されません");
  }
  // カメラが使えずにここへ来るのは requireCamera が false（手をカメラ以外から作る入力）の時だけなので，カメラの案内は出さない
  if (!isUsable(results.audio)) {
    notices.push("音が出ない時は，消音モード（マナーモード）を解除してください");
  }
  return { kind: "proceed", handsAvailable, notices };
}
