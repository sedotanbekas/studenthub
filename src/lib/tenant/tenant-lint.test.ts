import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Guard isolasi tenant: model ber-schoolId tidak boleh dicari dengan findUnique({ where: { id } })
 * (lewati SchoolScope). Pakai findFirst({ where: { id, schoolId } }). Pengecualian diberi komentar
 * "tenant-lint-ignore" pada baris yang sama.
 */
const SCHOOL_SCOPED = [
  "student", "schoolClass", "subject", "academicYear", "term", "holiday", "attendance", "checkInRejection",
  "leaveRequest", "reportCard", "invoice", "paymentSubmission", "payment", "announcement",
];
const PATTERN = new RegExp(String.raw`\.(${SCHOOL_SCOPED.join("|")})\.findUnique\(\s*\{\s*where:\s*\{\s*id\b`);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [full] : [];
  });
}

test("tidak ada findUnique by id pada model ber-schoolId", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(path.join(process.cwd(), "src"))) {
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      if (PATTERN.test(line) && !line.includes("tenant-lint-ignore")) offenders.push(`${file}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});
