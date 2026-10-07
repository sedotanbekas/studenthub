"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CheckInResultDto, CheckOutResultDto, PrecheckResultDto, TodayDto } from "@/lib/attendance/student-schemas";
import { ACCURACY_TOLERANCE_CAP_M } from "@/lib/attendance/constants";
import { haversineMeters } from "@/lib/attendance/geo";
import { api, ApiError } from "@/lib/frontend/api";
import { demoCheckOutResult } from "@/lib/frontend/demo";
import { accuracyAdvice, demoWouldBeLate, fixAgeOk, simulateDemoFix, TEST_MODE_NOTE, webDeviceId, type FaceCheck } from "@/lib/frontend/attendance";
import { isOwnDialogCancel } from "@/lib/frontend/dialog-events";
import { useHub } from "../context";
import { Icon } from "../icon";
import { AccessGate } from "./access-gate";
import { AttendanceMap, type SchoolArea } from "./attendance-map";
import { bestPosition, useDeviceAccess, useLivePosition } from "./device-access";
import { FaceCamera } from "./face-camera";
import { IdentityStep } from "./identity-step";
import { DoneLateReason, EMPTY_LATE_DRAFT, LateReasonPicker } from "./late-reason-form";
import type { LateReasonDraft } from "@/lib/attendance/late-reason-rules";

/**
 * Alur absensi layar penuh: (0) izin lokasi + kamera WAJIB -> (1) peta & cek lokasi ke server ->
 * (2) foto wajah langsung -> (3) tinjau & kirim. Server tetap memutuskan (jendela, geofence, anomali).
 * mode "out" = absen pulang (2026-10-07): langkah sama, precheck purpose CHECK_OUT, kirim ke /check-out, tanpa alasan terlambat.
 */
export type FlowMode = "in" | "out";
type FlowResult = { readonly mode: "in"; readonly result: CheckInResultDto } | { readonly mode: "out"; readonly result: CheckOutResultDto };
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

interface FlowProps { today: TodayDto; mode?: FlowMode; identityConfirmed: boolean; onIdentityConfirmed: () => void; onClose: () => void; onDone: (done: { checkOutTimeLocal: string | null }) => void }

function stepTitle(mode: FlowMode, step: Step): string {
  if (step === "done") return mode === "out" ? "Absen pulang tercatat" : "Absensi tercatat";
  if (mode === "out") return "Absen pulang";
  return step === "location" ? "Cek lokasi" : step === "face" ? "Foto wajah" : "Periksa & kirim";
}

export function CheckInFlow({ today, mode = "in", identityConfirmed, onIdentityConfirmed, onClose, onDone }: FlowProps) {
  const { demo, logout } = useHub();
  const access = useDeviceAccess();
  const [step, setStep] = useState<Step>("location");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [result, setResult] = useState<FlowResult | null>(null);
  // Draf alasan terlambat di atas langkah-langkah agar bertahan saat lokasi/foto diulang (A1).
  const [reasonDraft, setReasonDraft] = useState<LateReasonDraft>(EMPTY_LATE_DRAFT);
  const watched = useLivePosition(access.ready, access.fix, access.blockLocation);
  // Mode demo: sekolah disimulasikan di dekat pengguna, akurasi GPS juga disimulasikan (laptop tidak punya GPS).
  const live: Fix | null = watched && demo ? { coords: simulateDemoFix(watched.coords), timestamp: watched.timestamp } : watched;
  const school = useSchoolArea(today, access.fix, demo);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [step, access.ready, identityConfirmed]);
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
  const title = !identityConfirmed ? "Konfirmasi akun" : !access.ready ? "Izinkan perangkat" : stepTitle(mode, step);
  // Konfirmasi akun bukan langkah bernomor; hitungan & bilah langkah baru tampil setelah izin aktif.
  const numbered = identityConfirmed && access.ready && step !== "done";
  return <dialog ref={screen} className="checkin-screen" aria-labelledby="checkin-title" onCancel={e => { if (!isOwnDialogCancel(e)) return; e.preventDefault(); onClose(); }}>
    <header className="checkin-header"><button className="icon-button" aria-label={mode === "out" ? "Tutup absen pulang" : "Tutup absensi"} onClick={onClose}><Icon name="close" /></button><h1 id="checkin-title" ref={heading} tabIndex={-1}>{title}</h1><span className="step-count">{numbered ? `${steps.indexOf(step) + 1}/3` : ""}</span></header>
    {numbered && <ol className="step-bar" aria-hidden="true">{steps.map((s, i) => <li key={s} className={i <= steps.indexOf(step) ? "on" : ""} />)}</ol>}
    <div className="checkin-content">
      {demo && <p className="info-message">Mode demo: area sekolah dan akurasi GPS disimulasikan di sekitarmu; absensi tidak disimpan.</p>}
      {today.testMode && !demo && <p className="warning-message" role="status">{TEST_MODE_NOTE}</p>}
      {!identityConfirmed ? <IdentityStep onConfirm={() => { onIdentityConfirmed(); void access.request(); }} onNotMe={() => { onClose(); void logout("NOT_ME"); }} />
        : !access.ready ? <AccessGate access={access} />
        : step === "location" ? <LocationStep mode={mode} today={today} school={school} live={live} distance={distance} inside={inside} verdict={verdict} onVerdict={setVerdict} onNext={() => setStep("face")} />
        : step === "face" && access.stream ? <section className="checkin-step-body"><div className="step-intro"><h2>Hadapkan wajah ke kamera</h2><p>Lepas masker/kacamata hitam dan pastikan wajahmu terang. Foto tetap bisa diambil walau wajah belum terdeteksi; admin sekolah akan memeriksanya.</p></div><FaceCamera stream={access.stream} onCapture={(blob, faceCheck) => { setPhoto({ blob, url: URL.createObjectURL(blob), faceCheck }); setStep("review"); }} /></section>
        : step === "review" && photo ? <ReviewStep mode={mode} checkInTimeLocal={today.record?.checkInTimeLocal ?? null} maxAccuracyM={today.geofence.maxAccuracyM} photo={photo} distance={distance} verdict={verdict} draft={reasonDraft} onDraft={setReasonDraft} onRetake={() => setStep("face")} onLocationError={message => { setVerdict({ ok: false, message, wouldBeLate: false }); setStep("location"); }} onImageError={() => setStep("face")} onDone={done => { setResult(done); setStep("done"); }} />
        : result ? <DoneStep done={result} draft={reasonDraft} onFinish={() => { onDone({ checkOutTimeLocal: result.mode === "out" ? result.result.attendance.checkOutTimeLocal : null }); onClose(); }} /> : null}
    </div>
  </dialog>;
}

interface LocationProps { mode: FlowMode; today: TodayDto; school: SchoolArea | null; live: Fix | null; distance: number | null; inside: boolean | null; verdict: Verdict | null; onVerdict: (v: Verdict) => void; onNext: () => void }

function LocationStep({ mode, today, school, live, distance, inside, verdict, onVerdict, onNext }: LocationProps) {
  const { demo } = useHub();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const accurate = live !== null && live.coords.accuracy <= today.geofence.maxAccuracyM;
  const autoRan = useRef(false);
  async function check() {
    if (!live) return;
    setBusy(true); setError("");
    try {
      if (demo) { onVerdict({ ok: Boolean(inside), message: inside ? "Lokasi valid (simulasi demo)." : "Di luar area sekolah (simulasi demo).", wouldBeLate: mode === "in" && demoWouldBeLate(today, new Date()) }); return; }
      const response = await api("/student/attendance/precheck", { method: "POST", body: JSON.stringify({ ...fixBody(live), purpose: mode === "out" ? "CHECK_OUT" : "CHECK_IN" }) });
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

interface CapturedPhoto { blob: Blob; url: string; faceCheck: FaceCheck }
interface ReviewProps { mode: FlowMode; checkInTimeLocal: string | null; maxAccuracyM: number; photo: CapturedPhoto; distance: number | null; verdict: Verdict | null; draft: LateReasonDraft; onDraft: (draft: LateReasonDraft) => void; onRetake: () => void; onLocationError: (message: string) => void; onImageError: () => void; onDone: (result: FlowResult) => void }

/** Kirim absen masuk/pulang (multipart sama); hasil diberi penanda mode agar layar "tercatat" tahu bentuknya. */
async function submitAttendance(mode: FlowMode, form: FormData): Promise<FlowResult> {
  if (mode === "out") return { mode, result: (await api("/student/attendance/check-out", { method: "POST", body: form })).data as CheckOutResultDto };
  return { mode, result: (await api("/student/attendance/check-in", { method: "POST", body: form })).data as CheckInResultDto };
}

function ReviewStep({ mode, checkInTimeLocal, maxAccuracyM, photo, distance, verdict, draft, onDraft, onRetake, onLocationError, onImageError, onDone }: ReviewProps) {
  const { demo } = useHub();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function send() {
    setBusy(true); setError("");
    try {
      if (demo && mode === "out") { onDone({ mode, result: demoCheckOutResult(new Date(), checkInTimeLocal) }); return; }
      if (demo) throw new ApiError("Mode demo: absensi tidak disimpan. Masuk dengan akun siswa dari HP untuk absen sungguhan.", "DEMO");
      const position = await bestPosition(maxAccuracyM).catch(() => { throw new ApiError("Lokasi tidak dapat diperbarui. Pastikan GPS tetap menyala.", "INVALID_LOCATION"); });
      if (!fixAgeOk(position.timestamp, Date.now())) throw new ApiError("Data lokasi sudah kedaluwarsa. Periksa ulang lokasi.", "LOCATION_STALE");
      const form = new FormData();
      for (const [key, value] of Object.entries({ ...fixBody(position), deviceId: webDeviceId(localStorage, () => crypto.randomUUID()) })) form.set(key, String(value));
      form.set("faceCheck", photo.faceCheck);
      form.set("selfie", new File([photo.blob], "selfie.jpg", { type: "image/jpeg" }));
      // Konfirmasi absen tidak menunggu alasan terlambat: draf alasan dikirim terpisah dari layar "tercatat".
      onDone(await submitAttendance(mode, form));
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
    <dl className="location-facts"><div><dt>Jarak ke sekolah</dt><dd>{distance === null ? "—" : `${distance} m`}</dd></div><div><dt>{mode === "out" ? "Jenis" : "Status"}</dt><dd>{mode === "out" ? "Absen pulang" : verdict?.wouldBeLate ? "Terlambat" : "Tepat waktu"}</dd></div></dl>
    {mode === "in" && verdict?.wouldBeLate && <section className="late-reason-review" aria-labelledby="late-reason-title"><h3 id="late-reason-title">Kenapa terlambat?</h3><p className="muted">Opsional · bisa diisi nanti, sampai jam sekolah usai.</p><LateReasonPicker draft={draft} onChange={onDraft} beforeCheckIn /></section>}
    {error && <p className="error-message" role="alert">{error}</p>}
    <div className="step-actions"><button className="button secondary block" disabled={busy} onClick={onRetake}><Icon name="camera" size={18} />Foto ulang</button><button className="button primary block large" disabled={busy} onClick={() => void send()}>{busy ? "Mengirim…" : mode === "out" ? "Kirim absen pulang" : "Kirim absensi"}<Icon name="check" size={20} /></button></div>
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

function DoneStep({ done, draft, onFinish }: { done: FlowResult; draft: LateReasonDraft; onFinish: () => void }) {
  if (done.mode === "out") return <CheckOutDone result={done.result} onFinish={onFinish} />;
  const { result } = done;
  const late = result.attendance.status === "TERLAMBAT";
  return <section className="checkin-step-body done-step">
    <span className={`done-icon ${late ? "late" : ""}`}><Icon name="check" size={44} /></span>
    <h2>{late ? `Tercatat terlambat ${result.attendance.lateMinutes ?? 0} menit` : "Kamu hadir tepat waktu"}</h2>
    <p className="done-time">Pukul {result.attendance.checkInTimeLocal}</p>
    <p>{result.message}</p>
    {late && <DoneLateReason attendance={result.attendance} draft={draft} />}
    <button className="button primary block large" onClick={onFinish}>Selesai</button>
  </section>;
}

function CheckOutDone({ result, onFinish }: { result: CheckOutResultDto; onFinish: () => void }) {
  return <section className="checkin-step-body done-step">
    <span className="done-icon"><Icon name="logout" size={44} /></span>
    <h2>Kamu sudah absen pulang</h2>
    <p className="done-time">Pukul {result.attendance.checkOutTimeLocal}</p>
    <p>{result.message}</p>
    <button className="button primary block large" onClick={onFinish}>Selesai</button>
  </section>;
}
