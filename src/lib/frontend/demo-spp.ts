import type { Buckets, ChildLevel, SppAnalytics, SppFilter } from "./spp-analytics-rules";

/**
 * Data contoh Analitik SPP untuk mode demo (tanpa jaringan): angka tetap per lingkup agar tampilan stabil saat
 * pindah lingkup. Bentuk sama dengan respons GET /analytics/spp.
 */
const SPP = 250_000;

function buckets(onTime: number, late: number, overdue: number, notDue: number): Buckets {
  const billed = (onTime + late + overdue + notDue) * SPP;
  const paid = (onTime + late) * SPP + Math.round(overdue * SPP * 0.1);
  return {
    onTime: { count: onTime, amount: onTime * SPP }, late: { count: late, amount: late * SPP },
    overdue: { count: overdue, amount: overdue * SPP - Math.round(overdue * SPP * 0.1) }, notDue: { count: notDue, amount: notDue * SPP },
    billed, paid, outstanding: billed - paid, collectionRate: billed ? Math.round((paid / billed) * 1000) / 10 : null,
  };
}

const CHILDREN: Readonly<Record<ChildLevel, readonly [string, string][]>> = {
  province: [["32", "Jawa Barat"], ["31", "DKI Jakarta"], ["91", "Papua"]],
  city: [["32.73", "Kota Bandung"], ["32.76", "Kota Depok"], ["32.04", "Kabupaten Bandung"]],
  school: [["demo-school-1", "SMP Negeri 1 Harapan Jaya"], ["demo-school-2", "SMP Negeri 2 Harapan Jaya"]],
  class: [["c1", "VII-A"], ["c2", "VII-B"], ["c3", "VIII-A"]],
};
const CHILD_OF: Readonly<Record<SppFilter["scope"], ChildLevel>> = { all: "province", province: "city", city: "school", school: "class" };
const LABELS: Readonly<Record<SppFilter["scope"], string>> = { all: "Seluruh Indonesia", province: "Jawa Barat", city: "Kota Depok, Jawa Barat", school: "SMP Negeri 1 Harapan Jaya (Demo)" };
const STUDENTS = ["Citra Lestari", "Fajar Nugroho", "Gita Maharani", "Hendra Wijaya", "Intan Permata", "Joko Susilo"];

export function demoSppAnalytics(f: SppFilter, months: readonly string[]): SppAnalytics {
  const childLevel = CHILD_OF[f.scope];
  const scale = f.scope === "all" ? 40 : f.scope === "province" ? 18 : f.scope === "city" ? 6 : 1;
  const trend = months.map((period, i) => {
    const last = i === months.length - 1;
    return { period, ...buckets(scale * (9 - (i % 3)), scale * (2 + (i % 2)), scale * (last ? 3 : 1 + (i % 2)), last ? scale * 4 : 0) };
  });
  const sum = (pick: (b: Buckets) => number) => trend.reduce((a, t) => a + pick(t), 0);
  const totals = buckets(sum(b => b.onTime.count), sum(b => b.late.count), sum(b => b.overdue.count), sum(b => b.notDue.count));
  const breakdown = CHILDREN[childLevel].map(([key, label], i) => ({ key, label, ...buckets(scale * (20 - i * 5), scale * (4 + i), scale * (5 - i), scale * 2), students: scale * (15 - i * 3), overdueStudents: scale * (4 - i) }));
  const students = STUDENTS.map((name, i) => ({
    studentId: `demo-st-${i}`, name, nisn: `99000000${10 + i}`, className: CHILDREN.class[i % 3]![1], schoolName: CHILDREN.school[i % 2]![1],
    overdueInvoices: i < 4 ? 3 - (i % 3) : 0, outstanding: i < 4 ? (3 - (i % 3)) * SPP : 0, oldestDueDate: i < 4 ? "2026-08-10" : null, lateInvoices: i % 2,
  }));
  return {
    scope: { level: f.scope, label: LABELS[f.scope], childLevel, provinceCode: f.provinceCode || null, cityCode: f.cityCode || null, schoolId: f.schoolId || null },
    period: { from: months[0] ?? "", to: months.at(-1) ?? "", months: months.length },
    asOf: new Date().toISOString().slice(0, 10),
    totals: { ...totals, invoices: sum(b => b.onTime.count + b.late.count + b.overdue.count + b.notDue.count), students: scale * 30, overdueStudents: scale * 6, lateStudents: scale * 4 },
    trend, breakdown, students,
  };
}

/** Bulan terakhir N bulan (YYYY-MM), bulan berjalan di akhir. */
export function demoMonths(now: Date, count: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (count - 1 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}
