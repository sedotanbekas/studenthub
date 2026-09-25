"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CheckInResultDto, PrecheckResultDto, TodayDto } from "@/lib/attendance/student-schemas";
import { ACCURACY_TOLERANCE_CAP_M } from "@/lib/attendance/constants";
import { haversineMeters } from "@/lib/attendance/geo";
import { api, ApiError } from "@/lib/frontend/api";
import { accuracyAdvice, fixAgeOk, simulateDemoFix, webDeviceId } from "@/lib/frontend/attendance";
import { useHub } from "../context";
import { Icon } from "../icon";
import { AccessGate } from "./access-gate";
import { AttendanceMap, type SchoolArea } from "./attendance-map";
import { bestPosition, useDeviceAccess, useLivePosition } from "./device-access";
import { FaceCamera } from "./face-camera";

/**
 * Alur absensi layar penuh: (0) izin lokasi + kamera WAJIB -> (1) peta & cek lokasi ke server ->
 * (2) foto wajah langsung -> (3) tinjau & kirim. Server tetap memutuskan (jendela, geofence, anomali).
 */
type Step = "location" | "face" | "review" | "done";
type Verdict = Pick<PrecheckResultDto, "ok" | "message" | "wouldBeLate">;
const LOCATION_CODES = new Set(["INVALID_LOCATION", "MOCK_LOCATION", "LOCATION_STALE", "GPS_ACCURACY_TOO_LOW", "OUTSIDE_GEOFENCE"]);
const IMAGE_CODES = new Set(["IMAGE_UNREADABLE", "IMAGE_TOO_SMALL", "IMAGE_TOO_LARGE", "HEIC_NOT_SUPPORTED", "UNSUPPORTED_MEDIA_TYPE", "PAYLOAD_TOO_LARGE"]);
const DEMO_OFFSET_DEG = 0.0003;

/** Bentuk minimal fix yang dipakai alur ini (GeolocationPosition asli atau hasil simulasi demo). */
interface Fix { readonly coords: { readonly latitude: number; readonly longitude: number; readonly accuracy: number }; readonly timestamp: number }
const fixBody = (p: Fix) => ({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy, locationTimestamp: Math.round(p.timestamp), clientTime: Date.now() });

function useSchoolArea(today: TodayDto, demoFix: Fix | null, demo: boolean): SchoolArea | null {
  const { latitude, longitude, radiusM } = today.geofence;
  const demoLat = demoFix?.coords.latitude; const demoLng = demoFix?.coords.longitude;
  return useMemo(() => {
    if (!demo) return { latitude, longitude, radiusM };
    return demoLat === undefined || demoLng === undefined ? null : { latitude: demoLat + DEMO_OFFSET_DEG, longitude: demoLng, radiusM };
  }, [demo, demoLat, demoLng, latitude, longitude, radiusM]);
}

export function CheckInFlow({ today, onClose, onDone }: { today: TodayDto; onClose: () => void; onDone: () => void }) {
  const { demo } = useHub();
  const access = useDeviceAccess();
  const [step, setStep] = useState<Step>("location");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [result, setResult] = useState<CheckInResultDto | null>(null);
  const watched = useLivePosition(access.ready, access.fix, access.blockLocation);
  // Mode demo: sekolah disimulasikan di dekat pengguna, akurasi GPS juga disimulasikan (laptop tidak punya GPS).
  const live: Fix | null = watched && demo ? { coords: simulateDemoFix(watched.coords), timestamp: watched.timestamp } : watched;
  const school = useSchoolArea(today, access.fix, demo);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [step, access.ready]);
  // Layar penuh sebagai <dialog> modal: aplikasi di belakangnya otomatis inert dan Escape menutup alur.
  const screen = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = screen.current; el?.showModal();
    const previous = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; el?.close(); };
  }, []);
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);
  const distance = live && school ? Math.round(haversineMeters(live.coords, school)) : null;
  const inside = live && school && distance !== null ? distance <= school.radiusM + Math.min(live.coords.accuracy, ACCURACY_TOLERANCE_CAP_M) : null;
  const steps: Step[] = ["location", "face", "review"];
  const title = !access.ready ? "Izinkan perangkat" : step === "location" ? "Cek lokasi" : step === "face" ? "Foto wajah" : step === "review" ? "Periksa & kirim" : "Absensi tercatat";
  return <dialog ref={screen} className="checkin-screen" aria-labelledby="checkin-title" onCancel={e => { e.preventDefault(); onClose(); }}>
    <header className="checkin-header"><button className="icon-button" aria-label="Tutup absensi" onClick={onClose}><Icon name="close" /></button><h1 id="checkin-title" ref={heading} tabIndex={-1}>{title}</h1><span className="step-count">{access.ready && step !== "done" ? `${steps.indexOf(step) + 1}/3` : ""}</span></header>
    {access.ready && step !== "done" && <ol className="step-bar" aria-hidden="true">{steps.map((s, i) => <li key={s} className={i <= steps.indexOf(step) ? "on" : ""} />)}</ol>}
    <div className="checkin-content">
      {demo && <p className="info-message">Mode demo: area sekolah dan akurasi GPS disimulasikan di sekitarmu; absensi tidak disimpan.</p>}
      {!access.ready ? <AccessGate access={access} />
        : step === "location" ? <LocationStep today={today} school={school} live={live} distance={distance} inside={inside} verdict={verdict} onVerdict={setVerdict} onNext={() => setStep("face")} />
        : step === "face" && access.stream ? <section className="checkin-step-body"><div className="step-intro"><h2>Hadapkan wajah ke kamera</h2><p>Lepas masker/kacamata hitam dan pastikan wajahmu terang. Tombol foto aktif setelah wajah terdeteksi.</p></div><FaceCamera stream={access.stream} onCapture={blob => { setPhoto({ blob, url: URL.createObjectURL(blob) }); setStep("review"); }} /></section>
        : step === "review" && photo ? <ReviewStep maxAccuracyM={today.geofence.maxAccuracyM} photo={photo} distance={distance} verdict={verdict} onRetake={() => setStep("face")} onLocationError={message => { setVerdict({ ok: false, message, wouldBeLate: false }); setStep("location"); }} onImageError={() => setStep("face")} onDone={done => { setResult(done); setStep("done"); }} />
        : result ? <DoneStep result={result} onFinish={() => { onDone(); onClose(); }} /> : null}
    </div>
  </dialog>;
}

interface LocationProps { today: TodayDto; school: SchoolArea | null; live: Fix | null; distance: number | null; inside: boolean | null; verdict: Verdict | null; onVerdict: (v: Verdict) => void; onNext: () => void }

function LocationStep({ today, school, live, distance, inside, verdict, onVerdict, onNext }: LocationProps) {
  const { demo } = useHub();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const accurate = live !== null && live.coords.accuracy <= today.geofence.maxAccuracyM;
  const autoRan = useRef(false);
  async function check() {
    if (!live) return;
    setBusy(true); setError("");
    try {
      if (demo) { onVerdict({ ok: Boolean(inside), message: inside ? "Lokasi valid (simulasi demo)." : "Di luar area sekolah (simulasi demo).", wouldBeLate: false }); return; }
      const response = await api("/student/attendance/precheck", { method: "POST", body: JSON.stringify(fixBody(live)) });
      onVerdict(response.data as PrecheckResultDto);
    } catch (e) { setError(e instanceof Error ? e.message : "Lokasi belum dapat diperiksa."); }
    finally { setBusy(false); }
  }
  useEffect(() => { if (accurate && !autoRan.current && !verdict) { autoRan.current = true; void check(); } });
  const point = live ? { latitude: live.coords.latitude, longitude: live.coords.longitude, accuracy: live.coords.accuracy } : null;
  return <section className="checkin-step-body">
    {school ? <AttendanceMap school={school} position={point} inside={inside} /> : <div className="map-canvas placeholder">Menyiapkan peta…</div>}
    <dl className="location-facts"><div><dt>Jarak ke sekolah</dt><dd>{distance === null ? "—" : `${distance} m`}</dd></div><div><dt>Batas area</dt><dd>{today.geofence.radiusM} m</dd></div><div><dt>Akurasi GPS</dt><dd className={live && !accurate ? "bad" : ""}>{live ? `±${Math.round(live.coords.accuracy)} m` : "—"}</dd></div></dl>
    <AccuracyHint live={live} maxAccuracyM={today.geofence.maxAccuracyM} />
    {verdict && <p className={verdict.ok ? "success-message" : "error-message"} role="status">{verdict.message}{verdict.ok && verdict.wouldBeLate ? " Kamu akan tercatat terlambat." : ""}</p>}
    {error && <p className="error-message" role="alert">{error}</p>}
    <div className="step-actions"><button className="button secondary block" disabled={!live || busy} onClick={() => void check()}><Icon name="refresh" size={18} />{busy ? "Memeriksa…" : "Periksa ulang lokasi"}</button><button className="button primary block large" disabled={!verdict?.ok || busy} onClick={onNext}>Lanjut ke foto wajah<Icon name="arrow" size={20} /></button></div>
  </section>;
}

interface ReviewProps { maxAccuracyM: number; photo: { blob: Blob; url: string }; distance: number | null; verdict: Verdict | null; onRetake: () => void; onLocationError: (message: string) => void; onImageError: () => void; onDone: (result: CheckInResultDto) => void }

function ReviewStep({ maxAccuracyM, photo, distance, verdict, onRetake, onLocationError, onImageError, onDone }: ReviewProps) {
  const { demo } = useHub();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function send() {
    setBusy(true); setError("");
    try {
      if (demo) throw new ApiError("Mode demo: absensi tidak disimpan. Masuk dengan akun siswa dari HP untuk absen sungguhan.", "DEMO");
      const position = await bestPosition(maxAccuracyM).catch(() => { throw new ApiError("Lokasi tidak dapat diperbarui. Pastikan GPS tetap menyala.", "INVALID_LOCATION"); });
      if (!fixAgeOk(position.timestamp, Date.now())) throw new ApiError("Data lokasi sudah kedaluwarsa. Periksa ulang lokasi.", "LOCATION_STALE");
      const form = new FormData();
      for (const [key, value] of Object.entries({ ...fixBody(position), deviceId: webDeviceId(localStorage, () => crypto.randomUUID()) })) form.set(key, String(value));
      form.set("selfie", new File([photo.blob], "selfie.jpg", { type: "image/jpeg" }));
      const response = await api("/student/attendance/check-in", { method: "POST", body: form });
      onDone(response.data as CheckInResultDto);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "";
      const message = e instanceof Error ? e.message : "Absensi belum tersimpan.";
      if (LOCATION_CODES.has(code)) onLocationError(message);
      else { setError(message); if (IMAGE_CODES.has(code)) onImageError(); }
    } finally { setBusy(false); }
  }
  return <section className="checkin-step-body">
    <div className="step-intro"><h2>Pastikan semuanya benar</h2><p>Foto ini dan lokasimu saat ini akan dikirim ke sekolah.</p></div>
    {/* eslint-disable-next-line @next/next/no-img-element -- pratinjau blob lokal, bukan aset yang dioptimasi */}
    <img className="selfie-preview" src={photo.url} alt="Foto wajah yang akan dikirim" />
    <dl className="location-facts"><div><dt>Jarak ke sekolah</dt><dd>{distance === null ? "—" : `${distance} m`}</dd></div><div><dt>Status</dt><dd>{verdict?.wouldBeLate ? "Terlambat" : "Tepat waktu"}</dd></div></dl>
    {error && <p className="error-message" role="alert">{error}</p>}
    <div className="step-actions"><button className="button secondary block" disabled={busy} onClick={onRetake}><Icon name="camera" size={18} />Foto ulang</button><button className="button primary block large" disabled={busy} onClick={() => void send()}>{busy ? "Mengirim…" : "Kirim absensi"}<Icon name="check" size={20} /></button></div>
  </section>;
}

/** Status akurasi: mencari sinyal (dengan hitungan detik) lalu langkah perbaikan sesuai perangkat. */
function AccuracyHint({ live, maxAccuracyM }: { live: Fix | null; maxAccuracyM: number }) {
  const [seconds, setSeconds] = useState(0);
  const advice = live ? accuracyAdvice(live.coords.accuracy, maxAccuracyM, navigator.userAgent) : null;
  const searching = advice?.level !== "good";
  useEffect(() => { if (!searching) return; const timer = setInterval(() => setSeconds(s => s + 1), 1000); return () => clearInterval(timer); }, [searching]);
  if (!advice || advice.level === "good") return live ? null : <p className="info-message" role="status">Mencari sinyal GPS… {seconds} dtk</p>;
  return <div className={advice.level === "coarse" ? "error-message" : "warning-message"} role="status"><span>{advice.message}</span><small className="gps-wait">Akurasi terus diperbarui otomatis · {seconds} dtk</small></div>;
}

function DoneStep({ result, onFinish }: { result: CheckInResultDto; onFinish: () => void }) {
  const late = result.attendance.status === "TERLAMBAT";
  return <section className="checkin-step-body done-step">
    <span className={`done-icon ${late ? "late" : ""}`}><Icon name="check" size={44} /></span>
    <h2>{late ? `Tercatat terlambat ${result.attendance.lateMinutes ?? 0} menit` : "Kamu hadir tepat waktu"}</h2>
    <p className="done-time">Pukul {result.attendance.checkInTimeLocal}</p>
    <p>{result.message}</p>
    <button className="button primary block large" onClick={onFinish}>Selesai</button>
  </section>;
}
