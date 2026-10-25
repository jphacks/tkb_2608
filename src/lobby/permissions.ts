// センサー・カメラ・音の許可をまとめて取る（ブラウザ API の薄い殻．判断は startPolicy.ts）．
// iOS の Safari では，requestPermission・getUserMedia・AudioContext.resume をタップの処理の中で
// 同期的に呼び始める必要があるため，requestAllPermissions は await の前にすべてを呼び出す

import type { PermissionOutcome, PermissionResults } from "./startPolicy";

/** 許可を取った結果と，取れた機器（app/ が input/・audio/ に渡すために持つ） */
export interface AcquiredDevices {
  readonly results: PermissionResults;
  readonly audioContext: AudioContext | null;
  /** 手の認識用のカメラの映像（背面カメラ．ゴーグルに入れた時に前を向く側） */
  readonly cameraStream: MediaStream | null;
}

type PermissionRequester = { requestPermission?: () => Promise<PermissionState> };

function requestSensorPermission(target: unknown): Promise<PermissionOutcome> {
  if (target === undefined) return Promise.resolve("unavailable");
  const request = (target as PermissionRequester).requestPermission;
  if (typeof request !== "function") return Promise.resolve("notRequired");
  try {
    return request
      .call(target)
      .then((state): PermissionOutcome => (state === "granted" ? "granted" : "denied"))
      .catch((): PermissionOutcome => "error");
  } catch {
    return Promise.resolve("error");
  }
}

/** 動き（devicemotion）と向き（deviceorientation）の許可を取る．どちらかが使えなければその結果を返す */
export function requestMotionPermission(): Promise<PermissionOutcome> {
  const motion = requestSensorPermission(
    typeof DeviceMotionEvent === "undefined" ? undefined : DeviceMotionEvent,
  );
  const orientation = requestSensorPermission(
    typeof DeviceOrientationEvent === "undefined" ? undefined : DeviceOrientationEvent,
  );
  return Promise.all([motion, orientation]).then(([m, o]) => {
    const order: PermissionOutcome[] = ["denied", "error", "unavailable", "notRequired", "granted"];
    // 悪い方を返す
    return order.find((outcome) => m === outcome || o === outcome) ?? m;
  });
}

function requestCamera(): Promise<{ outcome: PermissionOutcome; stream: MediaStream | null }> {
  const media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
  if (media === undefined || typeof media.getUserMedia !== "function") {
    // HTTPS でない時も mediaDevices が無い
    return Promise.resolve({ outcome: "unavailable", stream: null });
  }
  return media
    .getUserMedia({
      video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    })
    .then((stream) => ({ outcome: "granted" as const, stream }))
    .catch((error: unknown) => {
      const name = error instanceof DOMException ? error.name : "";
      const outcome: PermissionOutcome =
        name === "NotAllowedError" || name === "SecurityError"
          ? "denied"
          : name === "NotFoundError" || name === "OverconstrainedError"
            ? "unavailable"
            : "error";
      return { outcome, stream: null };
    });
}

function startAudio(): Promise<{ outcome: PermissionOutcome; context: AudioContext | null }> {
  const Ctor =
    typeof window === "undefined"
      ? undefined
      : (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (Ctor === undefined) return Promise.resolve({ outcome: "unavailable", context: null });
  let context: AudioContext;
  try {
    context = new Ctor();
  } catch {
    return Promise.resolve({ outcome: "error", context: null });
  }
  // 音声ファイルの読み込みは audio/ ができたら，ここで取った context を使って行う
  return context
    .resume()
    .then(() => ({
      outcome: (context.state === "running" ? "granted" : "error") as PermissionOutcome,
      context,
    }))
    .catch(() => ({ outcome: "error" as const, context }));
}

/** センサー・カメラ・音の許可をまとめて取る．タップの処理の中から呼ぶこと */
export async function requestAllPermissions(): Promise<AcquiredDevices> {
  // await の前にすべて呼び始める（iOS のユーザー操作の扱いのため）
  const motionPromise = requestMotionPermission();
  const cameraPromise = requestCamera();
  const audioPromise = startAudio();
  const [motion, camera, audio] = await Promise.all([motionPromise, cameraPromise, audioPromise]);
  return {
    results: { motion, camera: camera.outcome, audio: audio.outcome },
    audioContext: audio.context,
    cameraStream: camera.stream,
  };
}
