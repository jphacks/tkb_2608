// シナリオが発する演出の指示（scenario/ → app/ → scenes/・audio/）．
// 中身（音声ファイル・3D の動き）は ID で指し，ID と素材の対応は受け取る側が持つ

/** 演出に付ける任意のパラメータ（揺れの強さ等） */
export type CueParams = Readonly<Record<string, string | number | boolean>>;

export type Cue =
  /**
   * ナレーションを再生する（ID は音声ファイルと字幕の対応表のキー）．
   * params は文面に差し込む値（校内放送の火元の教室名 roomName 等）
   */
  | { readonly type: "narration"; readonly id: string; readonly params?: CueParams }
  /** 効果音・環境音を鳴らす．anchorId を指定すると 3D 空間のその物の位置から鳴らす（立体音響） */
  | {
      readonly type: "sound";
      readonly id: string;
      readonly action: "play" | "stop";
      readonly loop?: boolean;
      readonly anchorId?: string;
    }
  /** 部屋の中で出来事を起こす（揺れ・出火・煙・ドアが開く等）．解釈は scenes/ が行う */
  | { readonly type: "happening"; readonly id: string; readonly params?: CueParams };
