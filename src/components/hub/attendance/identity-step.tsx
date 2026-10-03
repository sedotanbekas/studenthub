"use client";
import { useEffect, useId, useState } from "react";
import { api } from "@/lib/frontend/api";
import { demoRows } from "@/lib/frontend/demo";
import { demoPersonaForUser } from "@/lib/frontend/demo-personas";
import { initials } from "@/lib/frontend/format";
import { EMPTY_FACTS, identityCard, identityFacts, type IdentityFacts } from "@/lib/frontend/identity-confirm-rules";
import { useHub } from "../context";
import { Icon } from "../icon";

/**
 * Langkah pertama alur absen (A2): "Absen sebagai <nama> · <kelas> · NISN ••••1234". "Ya, ini saya" langsung
 * meminta izin lokasi & kamera (ketukan yang sama dengan tombol izin); "Bukan saya" mengeluarkan akun dari HP ini.
 */
const PROFILE_TIMEOUT_MS = 5_000;

/** Kelas & NISN tersamar milik akun ini; undefined = memuat. Gagal/lambat -> EMPTY_FACTS (kartu tetap bisa dipakai). */
function useIdentityFacts(): IdentityFacts | undefined {
  const { demo, me } = useHub();
  const userId = me.user.id;
  const [state, setState] = useState<{ userId: string; value: IdentityFacts } | null>(null);
  useEffect(() => {
    let active = true;
    const load = demo
      ? Promise.resolve(demoRows("/student/profile", demoPersonaForUser(userId)))
      : api("/student/profile", { signal: AbortSignal.timeout(PROFILE_TIMEOUT_MS) }).then(r => r.data);
    load.then(identityFacts, () => EMPTY_FACTS).then(value => { if (active) setState({ userId, value }); });
    return () => { active = false; };
  }, [demo, userId]);
  return state?.userId === userId ? state.value : undefined;
}

export function IdentityStep({ onConfirm, onNotMe }: { onConfirm: () => void; onNotMe: () => void }) {
  const { me } = useHub();
  const facts = useIdentityFacts();
  const card = identityCard(me.user.name, facts ?? EMPTY_FACTS);
  const noteId = useId();
  return <section className="checkin-step-body identity-step" aria-labelledby="identity-name">
    <div className="identity-card">
      <span className="avatar" aria-hidden="true">{initials(me.user.name)}</span>
      <span className="kicker">Absen sebagai</span>
      <h2 id="identity-name">{card.name}</h2>
      <p className={`identity-facts${facts === undefined ? " muted" : ""}`}>{facts === undefined ? "Memuat kelas & NISN…" : <span aria-label={card.spoken || undefined}>{card.facts}</span>}</p>
    </div>
    <p className="identity-note">Kehadiran akan tercatat atas nama ini.</p>
    <div className="step-actions">
      <button type="button" className="button primary block large" onClick={onConfirm}><Icon name="check" size={20} />Ya, ini saya</button>
      <small className="identity-note">Setelah ini HP meminta izin lokasi & kamera untuk absen.</small>
      <button type="button" className="button secondary block" aria-describedby={noteId} onClick={onNotMe}><Icon name="logout" size={18} />Bukan saya</button>
      <small className="identity-note" id={noteId}>Akun ini akan keluar dari perangkat ini.</small>
    </div>
  </section>;
}
