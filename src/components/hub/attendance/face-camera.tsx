"use client";
import { useEffect, useRef, useState } from "react";
import type { FaceDetector } from "@mediapipe/tasks-vision";
import { faceVerdict, type FaceBox, type FaceVerdict } from "@/lib/frontend/attendance";
import { Icon } from "../icon";

/**
 * Kamera depan langsung (tanpa unggah galeri) + deteksi wajah di perangkat (MediaPipe BlazeFace, WASM
 * dilayani dari domain sendiri). Tombol jepret aktif hanya bila tepat satu wajah jelas terdeteksi
 * beberapa bingkai berturut-turut. Tidak ada data wajah yang dikirim selain foto hasil jepretan.
 */
const WASM_BASE = "/vendor/mediapipe";
const MODEL = "/models/blaze_face_short_range.tflite";
const DETECT_EVERY_MS = 150;
const STABLE_FRAMES = 3;
const MAX_SIDE = 960;
const JPEG_QUALITY = 0.88;

let detectorPromise: Promise<FaceDetector> | null = null;
function loadDetector(): Promise<FaceDetector> {
  detectorPromise ??= (async () => {
    const { FaceDetector, FilesetResolver } = await import("@mediapipe/tasks-vision");
    const files = await FilesetResolver.forVisionTasks(WASM_BASE);
    const options = (delegate: "GPU" | "CPU") => ({ baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: "VIDEO" as const, minDetectionConfidence: 0.5 });
    try { return await FaceDetector.createFromOptions(files, options("GPU")); }
    catch { return FaceDetector.createFromOptions(files, options("CPU")); }
  })().catch(error => { detectorPromise = null; throw error; });
  return detectorPromise;
}

function detectFaces(detector: FaceDetector, video: HTMLVideoElement): FaceBox[] {
  const { detections } = detector.detectForVideo(video, performance.now());
  return detections.flatMap(d => d.boundingBox ? [{ score: d.categories[0]?.score ?? 0, x: d.boundingBox.originX, y: d.boundingBox.originY, width: d.boundingBox.width, height: d.boundingBox.height }] : []);
}

function capture(video: HTMLVideoElement): Promise<Blob> {
  const scale = Math.min(1, MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Foto belum dapat diambil.")), "image/jpeg", JPEG_QUALITY));
}

type DetectorState = "loading" | "ready" | "failed";

function useFaceDetection(video: React.RefObject<HTMLVideoElement | null>, attempt: number) {
  const [state, setState] = useState<DetectorState>("loading");
  const [verdict, setVerdict] = useState<FaceVerdict>({ ok: false, message: "Menyiapkan pendeteksi wajah…" });
  const [stable, setStable] = useState(false);
  useEffect(() => {
    let frame = 0; let last = 0; let streak = 0; let active = true;
    loadDetector().then(detector => {
      if (!active) return;
      setState("ready");
      const tick = (now: number) => {
        if (!active) return;
        const el = video.current;
        if (el && el.readyState >= 2 && el.videoWidth > 0 && now - last >= DETECT_EVERY_MS) {
          last = now;
          const next = faceVerdict(detectFaces(detector, el), { width: el.videoWidth, height: el.videoHeight });
          streak = next.ok ? streak + 1 : 0;
          setVerdict(next); setStable(streak >= STABLE_FRAMES);
        }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }).catch(() => { if (active) { setState("failed"); setVerdict({ ok: false, message: "Pendeteksi wajah gagal dimuat. Periksa koneksi internet lalu coba lagi." }); } });
    return () => { active = false; cancelAnimationFrame(frame); };
  }, [video, attempt]);
  return { state, verdict, stable };
}

export function FaceCamera({ stream, onCapture }: { stream: MediaStream; onCapture: (photo: Blob) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { state, verdict, stable } = useFaceDetection(video, attempt);
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    el.srcObject = stream;
    // AbortError = play() disela pemasangan ulang stream (mis. StrictMode); bukan kegagalan.
    void el.play().then(() => setError("")).catch((e: DOMException) => { if (e.name !== "AbortError") setError("Video kamera belum dapat diputar. Ketuk layar lalu coba lagi."); });
    return () => { el.srcObject = null; };
  }, [stream]);
  async function shoot() {
    if (!video.current || !stable) return;
    setBusy(true); setError("");
    try { onCapture(await capture(video.current)); }
    catch (e) { setError(e instanceof Error ? e.message : "Foto belum dapat diambil."); }
    finally { setBusy(false); }
  }
  return <div className="face-camera">
    <div className={`camera-frame ${stable ? "ok" : ""}`}><video ref={video} playsInline muted autoPlay aria-label="Pratinjau kamera depan" /><span className="face-guide" aria-hidden="true" /></div>
    <p className={`camera-hint ${stable ? "ok" : ""}`} role="status" aria-live="polite">{error || verdict.message}</p>
    {state === "failed" ? <button className="button secondary block" onClick={() => setAttempt(a => a + 1)}><Icon name="refresh" size={18} />Muat ulang pendeteksi wajah</button>
      : <button className="button primary block large" disabled={!stable || busy} onClick={shoot}><Icon name="camera" size={20} />{busy ? "Mengambil foto…" : "Ambil foto"}</button>}
  </div>;
}
