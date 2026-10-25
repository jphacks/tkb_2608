// 端末の読み上げ（speechSynthesis）で使う声の選び方と，読み上げに渡す文面の変換（純粋な関数）．
// audio/（避難中のナレーション・校内放送）と lobby/（ロビー・ホームの読み上げ）の両方が使うため share/ に置く．
// ブラウザ API には触れず，声の一覧の出どころ（speechSynthesis）は呼ぶ側が VoiceSource として渡す

/** 声を選ぶのに使う項目（SpeechSynthesisVoice の一部） */
export interface VoiceLike {
  readonly name: string;
  readonly lang: string;
  readonly localService: boolean;
  readonly default: boolean;
}

/** 声の一覧の出どころ（speechSynthesis の一部．テストでは差し替える） */
export interface VoiceSource<V extends VoiceLike> {
  getVoices(): readonly V[];
  addEventListener(type: "voiceschanged", listener: () => void): void;
}

/** 名前にあれば質の良い声とみなす語（Apple の拡張・高品質版等） */
const QUALITY_MARKERS = ["premium", "enhanced", "拡張", "高品質", "natural", "neural"];

/** 質の良い既知の日本語の声（Apple の Siri 系・Google・Microsoft のオンラインの声） */
const KNOWN_GOOD = [
  "kyoko",
  "o-ren",
  "otoya",
  "hattori",
  "siri",
  "google",
  "nanami",
  "keita",
  "aoi",
  "daichi",
  "mayu",
  "naoki",
  "shiori",
  "online",
];

/** 避難訓練に合わない Apple のノベルティ系の声（日本語でも一覧に出る端末がある） */
const NOVELTY = [
  "eddy",
  "flo",
  "grandma",
  "grandpa",
  "reed",
  "rocko",
  "sandy",
  "shelley",
  "albert",
  "bad news",
  "bahh",
  "bells",
  "boing",
  "bubbles",
  "cellos",
  "good news",
  "jester",
  "organ",
  "superstar",
  "trinoids",
  "whisper",
  "wobble",
  "zarvox",
];

/** 日本語の声か（ja・ja-JP・ja_JP．大文字小文字は問わない） */
export function isJapaneseVoice(voice: VoiceLike): boolean {
  const lang = voice.lang.trim().toLowerCase().replace("_", "-");
  return lang === "ja" || lang.startsWith("ja-");
}

/** 名前に語が単語として含まれるか（"Flo" が "Flower" に当たらないよう，前後が英字でないことを見る） */
function hasWord(name: string, word: string): boolean {
  let from = 0;
  for (;;) {
    const i = name.indexOf(word, from);
    if (i < 0) return false;
    const before = i === 0 ? "" : name.charAt(i - 1);
    const after = name.charAt(i + word.length);
    if (!/[a-z]/.test(before) && !/[a-z]/.test(after)) return true;
    from = i + 1;
  }
}

/** 声の点数（大きいほど良い）．日本語でない声は呼ぶ前に除く */
export function voiceScore(voice: VoiceLike): number {
  const name = voice.name.toLowerCase();
  if (NOVELTY.some((w) => hasWord(name, w))) return -100;
  let score = 0;
  if (QUALITY_MARKERS.some((w) => name.includes(w))) score += 40;
  if (KNOWN_GOOD.some((w) => hasWord(name, w))) score += 20;
  if (voice.localService) score += 4;
  if (voice.default) score += 1;
  return score;
}

/**
 * 日本語の声のうち，質の良いものを 1 つ選ぶ．日本語の声が無ければ null（呼ぶ側は声を指定せずに読む）．
 * 順は「名前に Premium・Enhanced・拡張・高品質 等」→「既知の良い声（Kyoko・O-Ren・Google・Nanami 等）」
 * →「端末の中の声（localService）」→ その他．ノベルティ系の声は最後．同点なら一覧の先の声
 */
export function pickVoice<V extends VoiceLike>(voices: readonly V[]): V | null {
  let best: V | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const voice of voices) {
    if (!isJapaneseVoice(voice)) continue;
    const score = voiceScore(voice);
    if (score > bestScore) {
      best = voice;
      bestScore = score;
    }
  }
  return best;
}

/**
 * 読み上げに渡す文面にする．このプロジェクトの全角の「．」「，」を「。」「、」に置き換える
 * （読み上げの声によっては「．」を文末として扱わず，間が入らない・記号として読むため）．画面の表示には使わない
 */
export function toSpeechText(text: string): string {
  return text.replace(/．/g, "。").replace(/，/g, "、");
}

/** 声の一覧を覚えておき，選んだ声を返す */
export interface VoicePicker<V extends VoiceLike> {
  /** 今わかっている一覧から選んだ声．まだ一覧が届いていない・日本語の声が無ければ null */
  current(): V | null;
}

/**
 * 声の一覧を覚える．一覧は voiceschanged で遅れて届く端末（Chrome 等）があるため，
 * 届くたびに選び直す．届く前は null を返す（待たずに既定の声で読む）
 */
export function createVoicePicker<V extends VoiceLike>(source: VoiceSource<V>): VoicePicker<V> {
  let chosen: V | null = null;
  const refresh = (): void => {
    try {
      chosen = pickVoice(source.getVoices());
    } catch {
      chosen = null;
    }
  };
  try {
    source.addEventListener("voiceschanged", refresh);
  } catch {
    // 知らせが使えなくても，呼ばれた時に一覧を取り直す
  }
  refresh();
  return {
    current() {
      if (chosen === null) refresh();
      return chosen;
    },
  };
}
