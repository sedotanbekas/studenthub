"use client";
import { useState } from "react";
import { operation } from "@/lib/frontend/catalog";
import { ActionDialog } from "../action-dialog";
import { RecordDetailDialog, type DetailTarget } from "./record-detail-dialog";

/**
 * Dialog satu catatan kehadiran: detail (+ tinjau anomali) yang bisa berpindah ke Koreksi absensi. Siswa & tanggal
 * koreksi diambil dari detail yang dimuat (bukan filter halaman), jadi koreksi selalu untuk catatan yang dilihat.
 */
interface RecordHostProps {
  readonly target: DetailTarget;
  readonly date: string;
  readonly onClose: () => void;
  /** Data berubah (tinjauan/koreksi tersimpan): muat ulang peta/daftar/tabel. */
  readonly onChanged: () => void;
}

export function RecordHost({ target, date, onClose, onChanged }: RecordHostProps) {
  const [correct, setCorrect] = useState<{ studentId: string; date: string } | null>(null);
  if (correct) return <ActionDialog key="koreksi" op={operation("correctStudentAttendanceDay")} initial={correct} onClose={onClose} onDone={onChanged} />;
  return <RecordDetailDialog key={target.id} target={target} date={date} onClose={onClose} onReviewed={onChanged} onCorrect={detail => setCorrect({ studentId: detail.student.id, date: detail.date })} />;
}
