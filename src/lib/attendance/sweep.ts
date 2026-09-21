import type { Tx } from "@/lib/db";
import { toDbDate, type LocalDate } from "@/lib/time/zone";
import type { AnomalyCode } from "./anomaly-rules";

/**
 * Sapuan anomali lintas siswa saat hari ditutup (desain 02 §3.4, D12): otoritatif dan aman diulang.
 * Check-in paralel tidak saling melihat baris masing-masing, jadi flag SHARED_DEVICE yang terlewat
 * saat check-in dipasang di sini untuk SEMUA baris yang berbagi deviceId.
 */
export const SHARED_DEVICE_FLAG = "SHARED_DEVICE" satisfies AnomalyCode;

/**
 * Tandai SHARED_DEVICE pada baris check-in (checkInAt terisi) sekolah+tanggal yang deviceId-nya dipakai
 * >= 2 siswa berbeda. anomalyFlags ditambah tanpa duplikat (bukan array -> diganti array baru),
 * hasAnomaly = 1 (SHARED_DEVICE berkeparahan HIGH). Mengembalikan jumlah baris yang berubah; sapuan
 * kedua pada data yang sama mengembalikan 0.
 */
export async function sweepSharedDevice(tx: Tx, schoolId: string, date: LocalDate, now: Date): Promise<number> {
  const day = toDbDate(date);
  const flagJson = JSON.stringify(SHARED_DEVICE_FLAG);
  return tx.$executeRaw`
    UPDATE \`Attendance\` AS a
    JOIN (
      SELECT \`deviceId\` FROM \`Attendance\`
      WHERE \`schoolId\` = ${schoolId} AND \`date\` = ${day} AND \`checkInAt\` IS NOT NULL AND \`deviceId\` IS NOT NULL
      GROUP BY \`deviceId\`
      HAVING COUNT(DISTINCT \`studentId\`) > 1
    ) AS shared ON shared.\`deviceId\` = a.\`deviceId\`
    SET a.\`anomalyFlags\` = CASE
          WHEN a.\`anomalyFlags\` IS NULL OR JSON_TYPE(a.\`anomalyFlags\`) <> 'ARRAY' THEN JSON_ARRAY(${SHARED_DEVICE_FLAG})
          WHEN JSON_CONTAINS(a.\`anomalyFlags\`, ${flagJson}) THEN a.\`anomalyFlags\`
          ELSE JSON_ARRAY_APPEND(a.\`anomalyFlags\`, '$', ${SHARED_DEVICE_FLAG})
        END,
        a.\`hasAnomaly\` = 1,
        a.\`updatedAt\` = ${now}
    WHERE a.\`schoolId\` = ${schoolId} AND a.\`date\` = ${day} AND a.\`checkInAt\` IS NOT NULL
      AND (
        a.\`hasAnomaly\` = 0 OR a.\`anomalyFlags\` IS NULL OR JSON_TYPE(a.\`anomalyFlags\`) <> 'ARRAY'
        OR NOT JSON_CONTAINS(a.\`anomalyFlags\`, ${flagJson})
      )`;
}
