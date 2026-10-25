// 校舎と訓練条件のデータ（SchoolPlan）の型（editor/ が作り，sim/・scenes/school/・debrief/ が読む）．
// 形の決まり（座標・壁の自動配置・URL への埋め込み）は docs/04_SPEC/SPEC_02_校舎データの形式.md を正とする

/** 校舎と訓練条件のすべて．エディタが作り，URL に埋め込んで生徒の端末に渡す */
export interface SchoolPlan {
  /** 形の版．形を変えたら上げる */
  readonly version: 1;
  /** 学校名・校舎名（結果画面の見出し等に使う） */
  readonly name: string;
  /** マス 1 辺の長さ（m） */
  readonly cellSize: number;
  /** 階ごとのマス目．段階 1 は 1 つだけ */
  readonly floors: readonly Floor[];
  /** 教室の一覧．マスからは添字で指す */
  readonly rooms: readonly Room[];
  readonly drill: DrillSetup;
}

export type CellKind =
  | "void" //     何もない（校舎の外の地面でもない．通れない）
  | "classroom" // 教室（どの教室かは Floor.roomOf で指す）
  | "corridor" // 廊下（階段の踊り場等も当面はこれ）
  | "wall" //     柱・厚い壁（マス全体がふさがる）
  | "door" //     ドア（両隣の床をつなぐ開口．人も火も煙も通る）
  | "exit" //     出口（昇降口．屋内と屋外をつなぐドア）
  | "shutter" //  防火シャッター（火と煙を止める．人はくぐり戸を通れる）
  | "outdoor"; // 屋外（校庭．集合場所を含む）

export interface Floor {
  /** 何階か（1 から） */
  readonly level: number;
  /** X 方向のマスの数 */
  readonly width: number;
  /** Z 方向のマスの数 */
  readonly depth: number;
  /** マスの種類（長さ width * depth．添字は z * width + x） */
  readonly cells: readonly CellKind[];
  /** 教室のマスが属する教室（SchoolPlan.rooms の添字）．教室以外のマスは -1 */
  readonly roomOf: readonly number[];
}

export interface Room {
  /** 表示名（「3年1組」「理科室」．校内放送の文面にも使う） */
  readonly name: string;
}

/** 位置（何階のどのマスか） */
export interface CellRef {
  /** SchoolPlan.floors の添字 */
  readonly floor: number;
  readonly x: number;
  readonly z: number;
}

export type DrillMode = "learn" | "test";

/** 訓練条件（E3〜E6） */
export interface DrillSetup {
  /** 学習モード（床に正解経路を出す）／テストモード（出さない） */
  readonly mode: DrillMode;
  /** 火元（1 つ以上） */
  readonly fireOrigins: readonly CellRef[];
  /** 生徒の開始地点（教室のマス） */
  readonly start: CellRef;
  /** 開始時に向いている向き（rad．0 が -Z（エディタの上）向き，右回りに増える） */
  readonly startYaw: number;
  /** 集合場所（屋外のマス．どれかに入ったら避難完了） */
  readonly assembly: readonly CellRef[];
  /** 正解経路（開始地点から集合場所まで，上下左右に隣り合うマスの列）．教員が修正した後のもの */
  readonly route: readonly CellRef[];
  readonly spread: SpreadSettings;
  /** 非常ベルから数えた制限時間（秒）．過ぎたら「逃げ遅れ」で打ち切る */
  readonly timeLimitSeconds: number;
}

/** 延焼の速さ（E4）．非常ベルの時刻を 0 秒とする */
export interface SpreadSettings {
  /** 火が隣のマスへ移るまでの秒数 */
  readonly fireSecondsPerCell: number;
  /** 煙が隣のマスへ移るまでの秒数（火より速い） */
  readonly smokeSecondsPerCell: number;
  /** 教員が手で足した延焼箇所（ES1．無ければ空）．atSeconds にそのマスが燃え始める */
  readonly extraFires: readonly { readonly cell: CellRef; readonly atSeconds: number }[];
  /**
   * 煙だけが出る場所（煙の発生源．無ければ省くか空）．atSeconds にそのマスから煙が出始め，smokeSecondsPerCell で広がる．
   * 発生源のマスは燃えない．省けるのは，この項目が無い古いデータ・テストの校舎をそのまま読めるようにするため
   */
  readonly extraSmokes?: readonly { readonly cell: CellRef; readonly atSeconds: number }[];
}

/** 校舎データ（URL の `#p=`）を読み込めなかった理由の種類．開始画面が出す案内（読み直す／新しい版で開く）を分けるために使う */
export type PlanLoadFailureKind =
  /** base64url・圧縮・JSON・形のどこかが壊れている（QR の読み取りの失敗や URL の欠け） */
  | "corrupted"
  /** このアプリより新しい版のデータ */
  | "unsupportedVersion"
  /** 形は読めたが，中身が validatePlan の検査に通らない */
  | "invalidPlan";

/** 校舎データを読み込めなかった時の理由（share/ の decodePlan が返し，app/ が Session に書く） */
export interface PlanLoadError {
  readonly kind: PlanLoadFailureKind;
  /** 画面に出す理由（日本語の 1 文） */
  readonly reason: string;
}

/** 配置の下書き（1 フロア分．ES3．SPEC_02「配置の下書き」）．Floor から階の番号を除き，教室の名前を足したもの */
export interface FloorDraft {
  /** X 方向のマスの数 */
  readonly width: number;
  /** Z 方向のマスの数 */
  readonly depth: number;
  /** マスの種類（長さ width * depth．添字は z * width + x） */
  readonly cells: readonly CellKind[];
  /** 教室のマスが属する教室（rooms の添字）．教室以外のマスは -1 */
  readonly roomOf: readonly number[];
  /** この下書きの中の教室．名前が読めなければ「教室1」等の仮の名前 */
  readonly rooms: readonly Room[];
}

/** 下書きを作る仕組み（AI・ファイルの読み込み等）．エディタは種類を知らずにこれを呼ぶ */
export interface FloorDraftProvider {
  /** エディタのボタン等に出す名前（「AI で下書きを作る」等） */
  readonly label: string;
  /**
   * image: 下敷きの写真のうち，マス目に重なる範囲だけを切り出した画像（E1 で合わせた位置・大きさ・回転を反映済み）．
   * 下書きは width × depth のマス目に収める．作れなかった時は，画面に出せる理由（日本語の 1 文）を message に持つ Error で失敗する
   */
  createDraft(request: {
    readonly image: Blob;
    readonly width: number;
    readonly depth: number;
  }): Promise<FloorDraft>;
}
