import type { ReactNode } from "react";
import { Icon } from "./icon";

/** Kartu tugas/pengaturan akun (Keamanan akun, pilihan notifikasi N2): ikon + judul + pesan, isi tepat di bawahnya. */
export const DEMO_MESSAGE = "Mode demo digunakan untuk menjelajahi formulir. Keluar dari demo dan masuk dengan akun untuk menyimpan data.";

interface CardProps { icon: string; title: string; text: ReactNode; task?: boolean; action?: ReactNode; children?: ReactNode }

export function SecurityCard({ icon, title, text, task = false, action, children }: CardProps) {
  return <section className={`security-card${task ? " is-task" : ""}`}><div className="security-card-head"><span className="quick-icon tone-0"><Icon name={icon} size={24} /></span><div><h2>{title}</h2><p>{text}</p></div></div>{action}{children}</section>;
}
