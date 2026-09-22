"use client";
import { useState } from "react";
import { api } from "@/lib/frontend/api";
import { useHub } from "./context";
import { Icon } from "./icon";
export function CheckIn({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const { demo, toast } = useHub();
  const [position, setPosition] = useState<GeolocationPosition | null>(null);
  const [selfie, setSelfie] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function locate() {
    if (!navigator.geolocation) { setError("Perangkat ini tidak mendukung lokasi. Gunakan perangkat yang mendukung GPS."); return; }
    setBusy(true); setError("");
    navigator.geolocation.getCurrentPosition(async pos => {
      try {
        if (demo) throw new Error("Pemeriksaan lokasi tersedia setelah masuk dengan akun siswa.");
        const result = await api("/student/attendance/precheck", { method: "POST", body: JSON.stringify({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy, locationTimestamp: pos.timestamp, clientTime: Date.now() }) });
        const verdict = result.data as { ok: boolean; message: string };
        if (!verdict.ok) throw new Error(verdict.message);
        setPosition(pos);
      } catch (e) { setError(e instanceof Error ? e.message : "Lokasi belum dapat diverifikasi."); }
      finally { setBusy(false); }
    }, () => { setError("Lokasi belum tersedia. Izinkan akses lokasi dan pastikan GPS aktif, lalu coba lagi."); setBusy(false); }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  }
  async function submit() {
    if (!position || !selfie) return;
    setBusy(true); setError("");
    try {
      if (Date.now() - position.timestamp > 180000) throw new Error("Lokasi sudah kedaluwarsa. Periksa kembali lokasi sebelum mengirim.");
      let deviceId = localStorage.getItem("studenthub_device");
      if (!deviceId) { deviceId = crypto.randomUUID(); localStorage.setItem("studenthub_device", deviceId); }
      const form = new FormData();
      const fields = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy, locationTimestamp: position.timestamp, clientTime: Date.now(), deviceId };
      for (const [key, value] of Object.entries(fields)) form.set(key, String(value));
      form.set("selfie", selfie);
      await api("/student/attendance/check-in", { method: "POST", body: form });
      toast("Kehadiran berhasil dicatat. Selamat belajar!"); onDone(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "Kehadiran belum tersimpan."); }
    finally { setBusy(false); }
  }
  return <><div className="dialog-body"><div className="checkin-step"><span>1</span><div><h3>Pastikan kamu berada di sekolah</h3><p>Izinkan akses lokasi agar jarak dari sekolah dapat diperiksa.</p><button className="button secondary" disabled={busy} onClick={locate}><Icon name="location" size={17} />{busy ? "Memeriksa…" : position ? "Periksa ulang lokasi" : "Periksa lokasi saya"}</button>{position && <p className="success-text">Lokasi sesuai · Akurasi {Math.round(position.coords.accuracy)} meter</p>}</div></div><div className="checkin-step"><span>2</span><div><h3>Ambil foto selfie</h3><p>Pastikan wajah terlihat jelas. JPEG, PNG, atau WebP, maksimal 5 MB.</p><input aria-label="Foto selfie" type="file" accept="image/jpeg,image/png,image/webp" capture="user" disabled={!position || busy} onChange={e => setSelfie(e.target.files?.[0] ?? null)} /></div></div>{error && <div className="error-message" role="alert">{error}</div>}</div><div className="dialog-footer"><button className="button secondary" disabled={busy} onClick={onClose}>Batal</button><button className="button primary" disabled={!position || !selfie || busy} onClick={submit}>Catat kehadiran <Icon name="check" size={17} /></button></div></>;
}
