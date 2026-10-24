// 手の認識用のカメラ（背面カメラ）を取る殻．?app では lobby/ の開始画面が取ったカメラを app/ から渡すため使わず，
// ビューア（?input=device）と dev ページで使う．条件は lobby/permissions.ts の requestCamera と同じ

/** 背面カメラを 320x240 で取る．使えない・拒否された時は null（例外を投げない） */
export async function requestHandCameraStream(): Promise<MediaStream | null> {
  const media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
  if (media === undefined || typeof media.getUserMedia !== "function") return null;
  try {
    return await media.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 320 }, height: { ideal: 240 } },
      audio: false,
    });
  } catch {
    return null;
  }
}
