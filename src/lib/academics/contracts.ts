import type { AnyContract } from "@/lib/http/contract";
import { classSubjectContracts } from "./contracts-classes";
import { academicYearContracts } from "./contracts-years";

/** Kontrak route domain academics: tahun ajaran, semester, semester aktif, kelas, mapel. */
export const academicsContracts: readonly AnyContract[] = [...academicYearContracts, ...classSubjectContracts];
