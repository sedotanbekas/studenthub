"use client";
import { Icon } from "../icon";
import type { AccessStatus, DeviceAccess } from "./device-access";

/**
 * Layar penghalang: absensi tidak bisa dilanjutkan sebelum lokasi DAN kamera aktif. Bila browser
 * sudah menolak izin, prompt tidak akan muncul lagi — tampilkan langkah membuka izin secara manual.
 */
const STATUS_TEXT: Record<AccessStatus, string> = { idle: "Belum diizinkan", checking: "Meminta izin…", granted: "Aktif", blocked: "Belum aktif" };

function AccessRow({ icon, title, status, message }: { icon: string; title: string; status: AccessStatus; message: string }) {
  return <li className={`access-row ${status}`}><span className="access-icon"><Icon name={status === "granted" ? "check" : icon} size={22} /></span><span><strong>{title}</strong><small>{message || STATUS_TEXT[status]}</small></span><b>{STATUS_TEXT[status]}</b></li>;
}

export function AccessGate({ access }: { access: DeviceAccess }) {
  const busy = access.location === "checking" || access.camera === "checking";
  const blocked = access.location === "blocked" || access.camera === "blocked";
  return <section className="checkin-step-body" aria-labelledby="access-title">
    <div className="step-intro"><h2 id="access-title">Nyalakan lokasi dan kamera</h2><p>Absensi <strong>wajib</strong> memakai lokasi HP untuk memastikan kamu di sekolah dan kamera depan untuk foto wajah. Keduanya harus aktif sebelum lanjut.</p></div>
    <ul className="access-list"><AccessRow icon="location" title="Lokasi (GPS)" status={access.location} message={access.locationMessage} /><AccessRow icon="camera" title="Kamera depan" status={access.camera} message={access.cameraMessage} /></ul>
    {blocked && <div className="help-box" role="alert"><strong>Izin masih tertutup?</strong><ol><li>Nyalakan <b>Lokasi/GPS</b> dari panel notifikasi HP.</li><li><b>Chrome Android:</b> ketuk ikon di kiri alamat situs → <b>Izin</b> → aktifkan <b>Lokasi</b> dan <b>Kamera</b>.</li><li><b>Safari iPhone:</b> ketuk <b>aA</b> di bilah alamat → <b>Pengaturan Situs Web</b> → izinkan <b>Kamera</b> dan <b>Lokasi</b>. Pastikan juga <b>Pengaturan → Privasi → Layanan Lokasi</b> menyala.</li><li>Kembali ke sini lalu ketuk tombol di bawah.</li></ol></div>}
    <button className="button primary block large" disabled={busy} onClick={() => void access.request()}><Icon name="shield" size={20} />{busy ? "Menunggu izin…" : blocked ? "Coba izinkan lagi" : "Izinkan lokasi & kamera"}</button>
  </section>;
}
