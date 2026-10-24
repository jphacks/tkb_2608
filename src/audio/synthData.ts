// 効果音の合成に使う波形の中身（雑音・ベルの打つ強さ・話し声の抑揚・物音・炎のパチパチ）を作る純粋な関数．
// Web Audio に依存せず，サンプルの並び（Float32Array）だけを返す．乱数は種付き（同じ種なら同じ音）

/** 0 以上 1 未満の乱数を返す関数 */
export type Random = () => number;

/** 種付きの乱数（mulberry32）．audio/ は scenes/ の乱数を import できないため同じ方式を持つ */
export function createRandom(seed: number): Random {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** サンプル数（1 以上の整数）．秒数・サンプリング周波数が正しくなければ 1 */
export function sampleCount(sampleRate: number, seconds: number): number {
  const n = Math.round(sampleRate * seconds);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** 白色雑音（-1〜1） */
export function whiteNoise(
  sampleRate: number,
  seconds: number,
  random: Random,
): Float32Array<ArrayBuffer> {
  const data = new Float32Array(sampleCount(sampleRate, seconds));
  for (let i = 0; i < data.length; i++) data[i] = random() * 2 - 1;
  return data;
}

/**
 * 電気ベルの打つ強さ（0〜1）の 1 打ち分．ループさせて音の大きさに掛けると「ジリリリ」になる．
 * 打った瞬間に立ち上がり，decaySeconds（s）で 1/e に減る
 */
export function bellStrikeEnvelope(
  sampleRate: number,
  strikeHz: number,
  decaySeconds: number,
): Float32Array<ArrayBuffer> {
  const data = new Float32Array(sampleCount(sampleRate, 1 / strikeHz));
  const attack = Math.max(1, Math.round(sampleRate * 0.002));
  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate;
    const rise = i < attack ? i / attack : 1;
    data[i] = rise * Math.exp(-t / decaySeconds);
  }
  return data;
}

/**
 * 話し声のざわめきの抑揚（0〜1）．何人かが 1 秒に約 4 音節で話し，時々黙る様子を重ねる
 * （雑音や低い音に掛けると，言葉に聞こえない話し声のようになる）
 */
export function babbleEnvelope(
  sampleRate: number,
  seconds: number,
  random: Random,
  speakers = 4,
): Float32Array<ArrayBuffer> {
  const data = new Float32Array(sampleCount(sampleRate, seconds));
  for (let s = 0; s < speakers; s++) {
    let t = random() * 0.5;
    while (t < seconds) {
      // 一続きの話（1〜3 秒）の後に黙る（0.3〜1.5 秒）
      const phraseEnd = t + 1 + random() * 2;
      while (t < phraseEnd && t < seconds) {
        const syllable = 0.14 + random() * 0.12;
        const loud = 0.4 + random() * 0.6;
        const start = Math.floor(t * sampleRate);
        const length = Math.floor(syllable * sampleRate);
        for (let i = 0; i < length && start + i < data.length; i++) {
          // 音節ごとに山なりにする（sin の半周期）
          data[start + i] += (loud * Math.sin((Math.PI * i) / length)) / speakers;
        }
        t += syllable + random() * 0.05;
      }
      t += 0.3 + random() * 1.2;
    }
  }
  for (let i = 0; i < data.length; i++) data[i] = Math.min(1, data[i]);
  return data;
}

/**
 * 教室の物音（鉛筆で机をたたく・椅子がきしむ・ページをめくる）を数回だけ入れた波形（-1〜1）．
 * 残りは無音．ループさせて環境音に重ねる
 */
export function classroomKnocks(
  sampleRate: number,
  seconds: number,
  random: Random,
): Float32Array<ArrayBuffer> {
  const data = new Float32Array(sampleCount(sampleRate, seconds));
  const count = 2 + Math.floor(random() * 3);
  for (let k = 0; k < count; k++) {
    const start = Math.floor(random() * Math.max(1, data.length - sampleRate));
    const kind = random();
    // 短く鋭い音（コツ）か，少し長いこすれる音（ズッ）
    const length = Math.floor(sampleRate * (kind < 0.6 ? 0.03 : 0.18));
    const decay = kind < 0.6 ? 0.006 : 0.06;
    const gain = 0.3 + random() * 0.4;
    for (let i = 0; i < length && start + i < data.length; i++) {
      const t = i / sampleRate;
      data[start + i] += gain * (random() * 2 - 1) * Math.exp(-t / decay);
    }
  }
  return data;
}

/** 炎のパチパチ（短い破裂を不規則に入れた波形．-1〜1）．perSecond は 1 秒あたりの平均の数 */
export function fireCrackles(
  sampleRate: number,
  seconds: number,
  random: Random,
  perSecond = 9,
): Float32Array<ArrayBuffer> {
  const data = new Float32Array(sampleCount(sampleRate, seconds));
  const count = Math.max(1, Math.round(seconds * perSecond));
  for (let k = 0; k < count; k++) {
    const start = Math.floor(random() * data.length);
    const length = Math.floor(sampleRate * (0.003 + random() * 0.012));
    // 大きな破裂は少なく，小さな破裂を多くする
    const gain = 0.15 + random() ** 3 * 0.85;
    for (let i = 0; i < length && start + i < data.length; i++) {
      data[start + i] += gain * (random() * 2 - 1) * (1 - i / length);
    }
  }
  for (let i = 0; i < data.length; i++) data[i] = Math.max(-1, Math.min(1, data[i]));
  return data;
}
