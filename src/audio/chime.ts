// 校内放送のチャイム（ピンポンパンポン）の音の並びと長さ（Web Audio に依存しない定義と計算）

/** チャイムの 1 音 */
export interface ChimeNote {
  /** 鳴らし始めからの時刻（s） */
  readonly at: number;
  /** 高さ（Hz） */
  readonly hz: number;
}

/** 音の間隔（s） */
const NOTE_INTERVAL_SECONDS = 0.34;
/** ド・ミ・ソ・ド（C5・E5・G5・C6．Hz）．スマホのスピーカーでも聞こえる高さにする */
const SCALE_HZ = [523.25, 659.25, 783.99, 1046.5] as const;

/** 放送の前（上がる 4 音）と後（下がる 4 音） */
export const ANNOUNCEMENT_CHIME: Readonly<Record<"start" | "end", readonly ChimeNote[]>> = {
  start: SCALE_HZ.map((hz, i) => ({ at: i * NOTE_INTERVAL_SECONDS, hz })),
  end: [...SCALE_HZ].reverse().map((hz, i) => ({ at: i * NOTE_INTERVAL_SECONDS, hz })),
};

/** 1 音が消えるまでの長さ（s．指数で減衰させ，ここで止める） */
export const CHIME_DECAY_SECONDS = 1.6;

/**
 * 最後の音を鳴らしてから，次へ進むまで待つ秒数（s）．
 * 放送の前は余韻の途中で読み始め，後は余韻が消えるのを待ってから終わりの signal を流す
 */
export const CHIME_LAST_NOTE_HOLD_SECONDS: Readonly<Record<"start" | "end", number>> = {
  start: 0.7,
  end: 1.4,
};

/** チャイムを鳴らし始めてから次へ進むまでの秒数（s） */
export function chimeWaitSeconds(kind: "start" | "end"): number {
  const notes = ANNOUNCEMENT_CHIME[kind];
  const last = notes.reduce((max, note) => Math.max(max, note.at), 0);
  return last + CHIME_LAST_NOTE_HOLD_SECONDS[kind];
}
