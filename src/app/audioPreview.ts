// 避難の音（src/audio/）の dev 用の単独起動（?audio）．効果音の ID ごとの再生・停止，ナレーションの読み上げ，
// 火災訓練のシナリオ（デモの校舎）を進行エンジンで進めて Cue を順に流し，返ってくる signal を表示する．
// 開発サーバーでだけ src/main.ts から動的に読み込む（本番のビルドには含めない）

import { createDrillAudio, unlockSpeech } from "../audio";
import { NARRATION_ID, narrationCue, SOUND_ID, soundCue } from "../core/audioIds";
import type { Cue } from "../core/cue";
import { createEventBus } from "../core/event-bus";
import type { AppEvent, GameEvent } from "../core/events";
import { ASSEMBLY_AREA_ID, buildDrillScenario, fireOriginName } from "../scenario/drill";
import { advance, startScenario } from "../scenario/engine";
import type { ScenarioEffect, ScenarioState } from "../scenario/types";
import { DEMO_SCHOOL } from "../share/samples/demoSchool";

const STYLE = `
body { margin: 0; background: #10141c; color: #f2f4f8; font: 15px/1.5 system-ui, sans-serif; }
.audio-preview { max-width: 760px; margin: 0 auto; padding: 16px; }
.audio-preview h1 { font-size: 1.3rem; margin: 0 0 8px; }
.audio-preview h2 { font-size: 1.05rem; margin: 18px 0 6px; }
.audio-preview .row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 4px 0; }
.audio-preview .row code { min-width: 15em; }
.audio-preview button { font-size: 0.95rem; padding: 6px 12px; border-radius: 6px; border: none; background: #3d6fd6; color: #fff; }
.audio-preview button.secondary { background: #4a5468; }
.audio-preview button.danger { background: #c8443a; }
.audio-preview input { font-size: 0.95rem; padding: 4px 8px; }
.audio-preview pre { background: #1a2333; padding: 8px; border-radius: 6px; max-height: 40vh; overflow-y: auto; font-size: 12px; white-space: pre-wrap; }
.audio-preview .status { color: #ffd27a; }
`;

/** シナリオを進める間隔の上限（s．タブが裏に回った後に大きく飛ばないため） */
const MAX_DT = 0.1;

export function startAudioPreview(): void {
  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.appendChild(style);
  const root = document.createElement("div");
  root.className = "audio-preview";
  document.body.appendChild(root);

  // AudioContext は最初のタップの中で作って再開する（iOS はタップの外では鳴らない）．読み上げも同じタップで解く
  let context: AudioContext | null = null;
  const ensureAudio = (): void => {
    if (context === null) {
      context = new AudioContext();
      unlockSpeech();
    }
    if (context.state !== "running") context.resume().catch(() => undefined);
  };

  const bus = createEventBus<AppEvent>();
  const audio = createDrillAudio({ bus, audioContext: () => context });

  const pageStarted = performance.now();
  const logLines: string[] = [];
  const log = document.createElement("pre");
  const addLog = (text: string): void => {
    const seconds = ((performance.now() - pageStarted) / 1000).toFixed(1).padStart(6);
    logLines.push(`${seconds} s  ${text}`);
    if (logLines.length > 200) logLines.shift();
    log.textContent = logLines.join("\n");
    log.scrollTop = log.scrollHeight;
  };
  bus.onAny((event) => {
    if (event.type === "cue") addLog(`cue ${JSON.stringify(event.cue)}`);
    else if (event.type === "signal") addLog(`signal ← ${event.name}`);
    else if (event.type === "stepEntered") addLog(`stepEntered ${event.stepId}`);
  });

  const button = (text: string, onClick: () => void, className?: string): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    if (className !== undefined) b.className = className;
    b.addEventListener("click", () => {
      ensureAudio();
      onClick();
    });
    return b;
  };
  const row = (...children: (HTMLElement | string)[]): HTMLDivElement => {
    const div = document.createElement("div");
    div.className = "row";
    div.append(...children);
    return div;
  };
  const code = (text: string): HTMLElement => {
    const c = document.createElement("code");
    c.textContent = text;
    return c;
  };
  const heading = (level: "h1" | "h2", text: string): HTMLElement => {
    const h = document.createElement(level);
    h.textContent = text;
    return h;
  };
  const emitCue = (cue: Cue): void => bus.emit({ type: "cue", cue });

  root.append(
    heading("h1", "避難の音の確認（?audio）"),
    row(
      "どれかのボタンを押すと音が有効になります．iPhone は消音モードを解除し，本体の音量ボタンで合わせてください",
    ),
  );

  // 効果音
  root.appendChild(heading("h2", "効果音（Cue の sound）"));
  for (const id of Object.values(SOUND_ID)) {
    root.appendChild(
      row(
        code(id),
        button("ループ", () => emitCue(soundCue(id, "play", { loop: true }))),
        button("1 回", () => emitCue(soundCue(id, "play", { loop: false })), "secondary"),
        button("止める", () => emitCue(soundCue(id, "stop")), "secondary"),
      ),
    );
  }

  // ナレーション
  root.appendChild(heading("h2", "ナレーション（Cue の narration）"));
  const roomName = document.createElement("input");
  roomName.value = fireOriginName(DEMO_SCHOOL);
  roomName.placeholder = "空なら場所を省いた文";
  root.appendChild(row("roomName:", roomName));
  for (const id of Object.values(NARRATION_ID)) {
    root.appendChild(
      row(
        code(id),
        button("読む", () => {
          const name = roomName.value.trim();
          emitCue(narrationCue(id, name === "" ? undefined : { roomName: name }));
        }),
      ),
    );
  }
  root.appendChild(
    row(
      code("unknown-narration"),
      button(
        "未知の ID を読む",
        () => emitCue({ type: "narration", id: "unknown-narration" }),
        "secondary",
      ),
    ),
  );

  // シナリオの Cue を順に流す（進行エンジンで進める．集合場所はボタンで入る）
  root.appendChild(heading("h2", "シナリオ（デモの校舎）の Cue を順に流す"));
  const status = document.createElement("span");
  status.className = "status";
  let run: {
    state: ScenarioState;
    events: GameEvent[];
    atAssembly: boolean;
    frame: number;
    last: number;
  } | null = null;
  const definition = buildDrillScenario(DEMO_SCHOOL);
  bus.on("signal", (event) => run?.events.push(event));

  const applyEffects = (effects: readonly ScenarioEffect[]): void => {
    for (const effect of effects) {
      if (effect.type === "cue") bus.emit({ type: "cue", cue: effect.cue });
      else if (effect.type === "stepEntered")
        bus.emit({ type: "stepEntered", stepId: effect.stepId });
      else if (effect.type === "stepFinished")
        addLog(`stepFinished ${effect.record.stepId} (${effect.record.outcome})`);
      else if (effect.type === "finished") addLog("シナリオが終わりました");
    }
  };
  const stopRun = (): void => {
    if (run !== null) cancelAnimationFrame(run.frame);
    run = null;
    status.textContent = "止まっています";
  };
  const tick = (now: number): void => {
    if (run === null) return;
    const dt = Math.min(MAX_DT, Math.max(0, (now - run.last) / 1000));
    run.last = now;
    const events = run.events;
    run.events = [];
    const result = advance(
      definition,
      run.state,
      {
        posture: "standing",
        walking: false,
        areaIds: run.atAssembly ? [ASSEMBLY_AREA_ID] : [],
      },
      events,
      dt,
    );
    run.state = result.state;
    applyEffects(result.effects);
    if (run === null) return;
    if (result.state.status === "finished") {
      stopRun();
      return;
    }
    status.textContent = `場面: ${result.state.stepId ?? "-"}（${result.state.stepElapsed.toFixed(1)} s）`;
    run.frame = requestAnimationFrame(tick);
  };
  const assembly = button(
    "集合場所に着いた",
    () => {
      if (run !== null) run.atAssembly = true;
    },
    "secondary",
  );
  root.appendChild(
    row(
      button("最初から流す", () => {
        stopRun();
        audio.stopAll();
        const started = startScenario(definition);
        run = {
          state: started.state,
          events: [],
          atAssembly: false,
          frame: 0,
          last: performance.now(),
        };
        applyEffects(started.effects);
        run.frame = requestAnimationFrame(tick);
      }),
      assembly,
      status,
    ),
  );
  status.textContent = "止まっています";

  // 全停止
  root.appendChild(
    row(
      button(
        "全停止",
        () => {
          stopRun();
          audio.stopAll();
          addLog("全停止");
        },
        "danger",
      ),
      button(
        "記録を消す",
        () => {
          logLines.length = 0;
          log.textContent = "";
        },
        "secondary",
      ),
    ),
  );

  root.append(heading("h2", "流れた cue と signal"), log);
}
