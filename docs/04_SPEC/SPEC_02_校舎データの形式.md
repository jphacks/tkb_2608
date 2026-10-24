# 校舎データの形式 (School Plan Format)

教員がエディタで作り，URL／QR コードで生徒の端末に渡す「校舎と訓練条件」のデータ（`SchoolPlan`）の形を定める．
エディタ（`src/editor/`）・延焼と経路の計算（`src/sim/`）・3D の校舎（`src/scenes/school/`）・結果画面（`src/debrief/`）は，すべてこの型だけを見て並行して実装する．
画面の流れとモジュールの分担は [SPEC_01](SPEC_01_画面遷移とモジュール構成.md)，要件は [PLAN_04](../03_PLAN/PLAN_04_要件定義書.md) を参照する．

## 方針 (Policy)

- **マス目だけで描く**: 教員は 2D のマス目にパーツを塗るだけで校舎を作る（E2）．壁は「隣り合うマスの種類の違い」から自動で置くので，教員は壁を 1 枚ずつ引かなくてよい
- **計算で求められるものは載せない**: 延焼の広がり方は火元と速さの設定から毎回同じ結果になるよう計算する（`src/sim/`．決定的な純粋関数）．URL に載せるのは設定だけにし，データを小さく保つ
- **教員が直したものは載せる**: 正解経路は教員が修正するため（E5），計算結果ではなくマスの列として載せる
- **複数フロアに広げられる形にする**: 段階 1 は 1 フロアだが，最初から `floors` を配列にし，位置は常に「何階のどのマスか」で表す（ES2 で階段のマスを足すだけで広げられる）
- **版を持つ**: 形を変えた時に古い QR を読み違えないよう，`version` を持つ．読めない版は「新しい版のアプリで開いてください」と出す

## 座標 (Coordinates)

| 項目 | 決まり |
| --- | --- |
| マスの位置 | `(x, z)`．`x` は右（東）向き，`z` は下（エディタの画面の下）向きに増える．左上が `(0, 0)` |
| マスの大きさ | `cellSize`（m）．既定は 1 m（廊下 2〜3 マス，教室 8×8 マス程度） |
| 3D への対応 | マス `(x, z)` の中心はワールド座標の `((x + 0.5) * cellSize, (z + 0.5) * cellSize)`．three.js の X・Z をそのまま使う |
| 階の高さ | `level` 階の床は `y = (level - 1) * 3.5`（m）．天井の高さは 3 m |
| 配列の並び | マスの配列は行ごと（添字は `z * width + x`） |

## 型 (Types)

置き場所は `src/core/schoolPlan.ts`（three.js にもブラウザ API にも依存しない）．型の変更は core の専用 PR で行う．

```ts
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
}
```

既定値（エディタの初期値．デモで調整する）は `fireSecondsPerCell: 6`・`smokeSecondsPerCell: 2`・`timeLimitSeconds: 150`・`mode: "learn"`．

## 壁の自動配置 (Wall Rules)

隣り合う 2 つのマスの間（辺）に，薄い壁（厚さ 0.1 m・高さ 3 m）を置くかどうかを次の規則で決める．3D の組み立て（`scenes/school/`）・人の当たり判定・延焼の計算は**すべて同じ規則**を使うため，関数は `src/sim/walls.ts` に 1 つだけ置く．

マスの種類を「空間」に読み替える．

| マスの種類 | 空間 |
| --- | --- |
| `classroom` | 教室ごとに別（`roomOf` の値で区別する） |
| `corridor` | 廊下（すべての廊下のマスで 1 つ） |
| `outdoor` | 屋外 |
| `door`・`exit`・`shutter` | 開口（どの空間ともつながる） |
| `void`・`wall` | 無し |

| 辺の両側 | 壁 |
| --- | --- |
| 同じ空間どうし | 置かない |
| 違う空間どうし（教室と廊下，教室と別の教室，廊下と屋外等） | 置く |
| 開口と，教室・廊下・屋外 | 置かない（ここが通り道になる） |
| 開口と開口 | 置かない |
| 教室・廊下・開口と，`void`・`wall`・マス目の外 | 置く |
| 屋外と，`void`・マス目の外 | 置かない（校庭の端．人はマス目の外へは出られない） |

- `wall` のマスは，マス全体の直方体（高さ 3 m）にする
- 天井は屋外以外の床のあるマスの上に張る
- ドアの開口はマス 1 つ分の幅．見た目は開いたままの引き戸でよい（開け閉めはしない）

## 通れる・燃え広がる (Passability)

| 動くもの | 隣のマスへ移れる条件 |
| --- | --- |
| 人 | 間に壁が無く，移る先が `void`・`wall` でなく，移る先がその時刻に燃えていない（燃えているマスに近づいたら警告する．SPEC_01「VR 避難の規則」） |
| 火・煙 | 間に壁が無く，移る先が `void`・`wall`・`shutter` でない（防火シャッターで止まる．`outdoor` へは広がらない） |

- 防火シャッターは非常ベルの時点で閉じているものとして扱う．人はくぐり戸を通れる（S4 で，手で押して開ける動作を足す）
- 火・煙の広がりは上下左右の 4 方向．火元からの「マスの数 × 秒数」で各マスに着く時刻が決まる（`src/sim/` が `SpreadMap` として計算する．SPEC_01「受け渡すデータ」）
- 煙の濃さは，煙が着いてからの経過時間で増やす．天井近くほど濃く，しゃがむと視界が晴れる（F4．見せ方は `scenes/school/` が決める）

## URL と QR への埋め込み (URL Embedding)

### 形式 (Format)

```text
https://<配信先>/?app#p=<埋め込みデータ>
```

- データはフラグメント（`#` の後ろ）に置く．フラグメントはサーバーに送られないので，配信先のログにも残らない
- 埋め込みデータの作り方（`src/share/` の `encodePlan`・`decodePlan`）

  1. `SchoolPlan` を JSON にする．ただし `cells` は 1 マス 1 文字の文字列に，`roomOf` は値と続く数の組（ランレングス）に置き換える

     | 種類 | 文字 |
     | --- | --- |
     | `void` | `.` |
     | `classroom` | `c` |
     | `corridor` | `h` |
     | `wall` | `#` |
     | `door` | `d` |
     | `exit` | `e` |
     | `shutter` | `s` |
     | `outdoor` | `o` |

  2. `CompressionStream("deflate-raw")` で圧縮する（iPhone の Safari 16.4 以降・Chrome で使える．ライブラリは入れない）
  3. base64url（`+` → `-`，`/` → `_`，末尾の `=` を除く）にする

- 読み込み時は逆の順に戻し，`validatePlan` で中身を確かめる（配列の長さ・添字の範囲・開始地点が教室か・集合場所が屋外か・経路が隣り合うマスの列か）．誤りがあれば結果画面ではなく開始画面に「QR コードを読み直してください」と理由を出す
- `decodePlan` は例外を投げず，`{ ok: true, plan }` か `{ ok: false, kind, reason }` を返す．開始画面は `kind` で案内を選び，`reason` を理由として添える

  | `kind` | 起きたこと | 開始画面の案内 |
  | --- | --- | --- |
  | `corrupted` | 文字・圧縮・JSON・形のどこかが壊れている（展開後 1 MiB 超も含む） | QR コードを読み直してください |
  | `unsupportedVersion` | `version` が今の版より新しい（形の検査より先に判定する） | 新しい版のアプリで開いてください |
  | `invalidPlan` | 形は読めたが `validatePlan` に通らない | QR コードを読み直してください |

- 壁をまたぐ経路（ドアを通らずに教室から廊下へ抜ける等）は `validatePlan` では確かめない（壁の規則は `src/sim/walls.ts` にあり，`share/` からは使わないため）．エディタが経路を確かめる時に `src/sim/` の関数で見る
- `encodePlan` は中身を確かめない．エディタは QR を出す前に `validatePlan` を呼ぶ
- `?app` だけで `#p=` が無い時は，同梱のデモの校舎（`src/share/samples/`）で起動する（デモと開発で QR を使わずに試せるようにする）

### 長さの上限 (Length Limit)

| 項目 | 目安 |
| --- | --- |
| 想定する校舎 | 1 フロア 60×30 マス（1 m のマスで 60 m × 30 m．教室 6 つと廊下） |
| 圧縮前 | 3〜4.5 KB（実測．マス目 1,800 文字に加え，ランレングスの `roomOf` と経路などの位置の JSON） |
| 圧縮後（base64url） | 600〜800 文字（実測．下表） |
| QR の上限 | URL 全体で **1,500 文字まで**を目安にする（PC の画面に出した QR をスマホのカメラで確実に読める密度．QR コードの規格上の上限は約 2,900 バイト） |

実測（`encodePlan` の出力．URL 全体は `https://staging.tkb2608.pages.dev/?app#p=` の 41 文字を含む）:

| 校舎 | 圧縮前の JSON | 圧縮後 | URL 全体 |
| --- | --- | --- | --- |
| デモの校舎（19×13．経路 19 マス） | 1,376 バイト | 575 文字 | 616 文字 |
| 60×30（教室 6 つ．経路 23 マス） | 3,199 バイト | 620 文字 | 661 文字 |
| 60×30（経路 67 マス） | 4,499 バイト | 786 文字 | 827 文字 |

- 長さに最も効くのはマス目ではなく経路のマス数（位置の JSON がほぼ比例して増える）．上限に近づいたら，まず経路の書き方（差分で持つ等）を見直す
- エディタは QR を出す前に長さを測り，上限を超えたら「校舎が大きすぎます．使わない部分を消してください」と出す（マス目の外側の `void` の行・列は自動で切り詰めてから測る）
- 複数フロア（ES2）で上限を超える場合は，階ごとの QR に分けるのではなく，ES4（開始地点ごとの QR）と同じく「使う階だけを載せる」で対応する（その時に本書を見直す）

## 配置の下書き (Floor Draft)

図面の写真から AI でマス目の下書きを作る機能（ES3）を，後から足せるようにするための決まり．段階 1 では実装しない．

### 方針 (Policy)

- AI が作るのは**配置だけ**（マスの種類と教室の区切り・名前）．火元・開始地点・集合場所・正解経路・延焼の速さ等の訓練条件には触れない
- 下書きは「教員がマスを塗った結果」と同じものとして扱う．3D の組み立て・壁の自動配置・延焼の計算はいつもの処理のまま使い，教員はエディタでいつもどおり直せる
- 下書きを作る仕組みは差し替えられるようにする（AI のほか，JSON ファイルの読み込み・手書きのテスト用の下書き等）．エディタは仕組みの中身を知らない

### 型 (Types)

置き場所は `src/core/schoolPlan.ts`（`SchoolPlan` と同じ）．

```ts
/** 配置の下書き（1 フロア分）．Floor から階の番号を除き，教室の名前を足したもの */
export interface FloorDraft {
  readonly width: number;
  readonly depth: number;
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
   * 下書きは width × depth のマス目に収める
   */
  createDraft(request: {
    readonly image: Blob;
    readonly width: number;
    readonly depth: number;
  }): Promise<FloorDraft>;
}
```

### 流れ (Flow)

```text
E1 で写真を下敷きにし，マス目に位置・大きさ・回転を合わせる（教員）
→ 「下書きを作る」: マス目に重なる範囲の画像を切り出し，FloorDraftProvider.createDraft() に渡す
→ 返ってきた FloorDraft を validatePlan と同じ確かめ方で調べる（配列の長さ・添字の範囲・文字の種類）
→ 今の階のマス目を置き換える（置き換える前の状態に「元に戻す」で戻れる）
→ 置き換えで教室・廊下でなくなったマスを指す訓練条件（火元・開始地点等）は外し，置き直すよう知らせる
→ 教員がいつもどおりマスを塗って直す（E2）
```

- **縮尺**: 教員が E1 で写真をマス目に合わせるので，切り出した画像の範囲がそのままマス目に対応する．AI に寸法を推測させない
- **AI への出力の指定**: マス目は「URL と QR への埋め込み」の 1 マス 1 文字の表（`.`・`c`・`h` 等）で，`depth` 行 × `width` 文字の文字列として出させる．教室の区切りと名前は別に JSON で出させる．同じ表を使うので，変換は `share/` の関数を使い回せる
- **サーバー関数が要る**: 画像を読める LLM の API キーはブラウザに置けないため，AI の仕組みはサーバー関数（Cloudflare Pages Functions．`functions/api/floor-draft.ts` 等）を呼ぶ．送るのは切り出した画像とマス目の大きさだけで，校舎のデータは送らない．送る内容と応答の型は `shared/api.ts` に置く
- **生徒の体験は変わらない**: 下書きはエディタの中だけの機能．生徒の端末に渡るのは，教員が直した後のいつもの `SchoolPlan` だけで，体験中は通信しない

## 未決事項 (Open Questions)

- [ ] 既定値（マスの大きさ・延焼の速さ・制限時間）を，デモの校舎を作って歩いてみてから決め直す
- [ ] 階段のマス（ES2）の表し方．案: `CellKind` に `stairs` を足し，`Floor` どうしのつながりを `links: { from: CellRef; to: CellRef }[]` で持つ
- [ ] 圧縮後の実際の長さ（実装後に測る）
- [ ] 配置の下書き（ES3）で使う AI のモデル・サーバー関数の費用と API キーの扱い（取り組む時に決める）
