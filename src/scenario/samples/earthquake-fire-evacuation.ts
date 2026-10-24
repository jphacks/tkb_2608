// サンプルのシナリオ（地震 → 火災 → 避難）．確定したシナリオではない（#9 で決まったら差し替える）．
// 定義の書き方の見本と，進行エンジン・部屋の動作確認に使う．
// ナレーション・効果音・出来事・エリア・触れる物の ID は仮のもの（素材一覧は #9 の後に決める）
import type { ScenarioDefinition } from "../types";

export const earthquakeFireEvacuation: ScenarioDefinition = {
  id: "sample-earthquake-fire-evacuation",
  title: "（サンプル）地震のあとの火災から避難する",
  timeLimitSeconds: 180,
  steps: [
    {
      id: "intro",
      onEnter: [
        { type: "sound", id: "room-ambience", action: "play", loop: true },
        { type: "narration", id: "intro" },
      ],
      // ナレーションの終わり（audio/ が送る signal）か 8 秒で次へ
      goal: {
        type: "any",
        conditions: [
          { type: "signal", name: "narration-ended:intro" },
          { type: "elapsed", seconds: 8 },
        ],
      },
    },
    {
      id: "earthquake",
      onEnter: [
        { type: "happening", id: "earthquake-start", params: { intensity: 1 } },
        { type: "sound", id: "earthquake-rumble", action: "play", loop: true },
        { type: "narration", id: "take-cover" },
      ],
      // 机の下のエリアで，しゃがんだ状態を同時に 3 秒続ける
      goal: {
        type: "together",
        conditions: [
          { type: "inArea", areaId: "under-desk" },
          { type: "posture", posture: "crouching" },
        ],
        holdSeconds: 3,
      },
      onComplete: [{ type: "narration", id: "take-cover-good" }],
      timeout: { seconds: 15, cues: [{ type: "narration", id: "take-cover-timeout" }] },
      hints: [{ afterSeconds: 6, cues: [{ type: "narration", id: "hint-desk" }] }],
      checks: [
        {
          id: "walked-during-shaking",
          label: "揺れている間に歩き回った",
          polarity: "bad",
          when: { type: "walking", holdSeconds: 3 },
          advice: "揺れている間は無理に動かず，その場で頭を守りましょう",
        },
      ],
      report: {
        label: "揺れたら机の下で頭を守る",
        advice: "落ちてくる物から頭を守ることが最優先です",
      },
    },
    {
      id: "fire",
      onEnter: [
        { type: "happening", id: "earthquake-stop" },
        { type: "sound", id: "earthquake-rumble", action: "stop" },
        { type: "happening", id: "fire-start", params: { smoke: true } },
        {
          type: "sound",
          id: "fire-crackle",
          action: "play",
          loop: true,
          anchorId: "kitchen-stove",
        },
        { type: "sound", id: "fire-alarm", action: "play", loop: true },
        { type: "narration", id: "evacuate-low" },
      ],
      goal: { type: "inArea", areaId: "hallway" },
      timeout: { seconds: 30 },
      hints: [{ afterSeconds: 12, cues: [{ type: "narration", id: "hint-hallway" }] }],
      checks: [
        {
          id: "kept-low-in-smoke",
          label: "煙の中で低い姿勢を保った",
          polarity: "good",
          when: { type: "posture", posture: "crouching", holdSeconds: 5 },
        },
        {
          id: "walked-upright-in-smoke",
          label: "煙の中を立ったまま歩いた",
          polarity: "bad",
          // 立ったまま歩いている状態が同時に 3 秒続いた
          when: {
            type: "together",
            conditions: [{ type: "posture", posture: "standing" }, { type: "walking" }],
            holdSeconds: 3,
          },
          advice: "煙は上にたまります．低い姿勢で口と鼻を覆って進みましょう",
        },
      ],
      report: { label: "煙の中を低い姿勢で廊下まで進む" },
    },
    {
      id: "open-door",
      onEnter: [{ type: "narration", id: "open-door" }],
      goal: { type: "touch", objectId: "exit-door" },
      onComplete: [{ type: "happening", id: "door-open" }],
      timeout: { seconds: 20 },
      hints: [{ afterSeconds: 8, cues: [{ type: "narration", id: "hint-door" }] }],
      report: { label: "手でドアを開ける" },
    },
    {
      id: "evacuate",
      onEnter: [{ type: "narration", id: "go-outside" }],
      goal: { type: "inArea", areaId: "assembly-point", holdSeconds: 1 },
      timeout: { seconds: 30 },
      report: { label: "屋外の集合場所まで避難する" },
    },
    {
      id: "ending",
      onEnter: [
        { type: "sound", id: "fire-alarm", action: "stop" },
        { type: "sound", id: "fire-crackle", action: "stop" },
        { type: "narration", id: "ending" },
      ],
      goal: { type: "elapsed", seconds: 5 },
      next: null,
    },
  ],
};
