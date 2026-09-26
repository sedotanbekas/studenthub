import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyPatches, approveBlocker, calendarDate, countLabel, hasQuickReason, loadedSum, matchesSearch, mergeById, nextAfter, normalizeSearch, reachSummary, reasonError,
  resolveSelection, reviewFailure, safeHref, scheduleInfo, SEARCH_MAX, shortRef, shownOfTotal, timeAgo, toggleQuickReason, wibDateTime, withQuickReason,
} from "./review-rules";

const NOW = new Date("2026-09-26T07:00:00Z"); // 14.00 WIB

test("reasonError: alasan wajib 5..255 karakter setelah dipangkas", () => {
  assert.equal(reasonError(""), "Tulis alasan agar sponsor tahu apa yang perlu diperbaiki.");
  assert.equal(reasonError("   ab  "), "Alasan minimal 5 karakter.");
  assert.equal(reasonError("Tidak"), null);
  assert.equal(reasonError("x".repeat(255)), null);
  assert.equal(reasonError("x".repeat(256)), "Alasan maksimal 255 karakter (sekarang 256).");
});

test("withQuickReason: chip mengisi kosong, ditambahkan sekali, dan tidak diulang", () => {
  assert.equal(withQuickReason("", "Nominal tidak sesuai"), "Nominal tidak sesuai");
  assert.equal(withQuickReason("  ", "Nominal tidak sesuai"), "Nominal tidak sesuai");
  assert.equal(withQuickReason("Nominal tidak sesuai", "Bukti tidak terbaca"), "Nominal tidak sesuai. Bukti tidak terbaca");
  assert.equal(withQuickReason("Nominal tidak sesuai.", "Bukti tidak terbaca"), "Nominal tidak sesuai. Bukti tidak terbaca");
  assert.equal(withQuickReason("Nominal tidak sesuai. Bukti tidak terbaca", "Bukti tidak terbaca"), "Nominal tidak sesuai. Bukti tidak terbaca");
});

test("toggleQuickReason: chip yang sudah dipilih dilepas lagi, sisanya tetap", () => {
  assert.equal(toggleQuickReason("", "Bukti tidak terbaca"), "Bukti tidak terbaca");
  assert.equal(toggleQuickReason("Bukti tidak terbaca", "Bukti tidak terbaca"), "");
  assert.equal(toggleQuickReason("Nominal tidak sesuai. Bukti tidak terbaca", "Nominal tidak sesuai"), "Bukti tidak terbaca");
  assert.equal(toggleQuickReason("Nominal tidak sesuai. Bukti tidak terbaca.", "Bukti tidak terbaca"), "Nominal tidak sesuai");
  assert.equal(hasQuickReason("Nominal tidak sesuai. Bukti tidak terbaca", "Bukti tidak terbaca"), true);
  assert.equal(hasQuickReason("Bukti tidak terbaca jelas", "Bukti tidak terbaca"), false, "hanya kalimat utuh yang dianggap chip");
});

test("toggleQuickReason: melepas chip tidak merusak angka/domain bertitik di alasan", () => {
  assert.equal(toggleQuickReason("Nominal pada bukti Rp1.000.000. Nominal tidak sesuai", "Nominal tidak sesuai"), "Nominal pada bukti Rp1.000.000");
  assert.equal(toggleQuickReason("Nominal tidak sesuai. Transfer Rp1.000.000 belum masuk", "Nominal tidak sesuai"), "Transfer Rp1.000.000 belum masuk");
  assert.equal(toggleQuickReason("Tautan tujuan tidak sesuai. Domain daftar.cahaya.example meminta NISN.", "Tautan tujuan tidak sesuai"), "Domain daftar.cahaya.example meminta NISN.");
  assert.equal(toggleQuickReason("Situs ayo.example. Tautan tujuan tidak sesuai. Ganti ke https://cahaya.example/a.b", "Tautan tujuan tidak sesuai"), "Situs ayo.example. Ganti ke https://cahaya.example/a.b");
  assert.equal(hasQuickReason("Nominal pada bukti Rp1.000.000. Nominal tidak sesuai", "Nominal tidak sesuai"), true);
});

test("withQuickReason/hasQuickReason: kalimat mirip bukan chip; karakter khusus regex di chip aman", () => {
  const added = withQuickReason("Bukti tidak terbaca jelas", "Bukti tidak terbaca");
  assert.equal(added, "Bukti tidak terbaca jelas. Bukti tidak terbaca");
  assert.equal(hasQuickReason(added, "Bukti tidak terbaca"), true);
  assert.equal(toggleQuickReason(added, "Bukti tidak terbaca"), "Bukti tidak terbaca jelas");
  assert.equal(hasQuickReason("Harga (Rp) tidak jelas?", "Harga (Rp) tidak jelas?"), true);
  assert.equal(hasQuickReason("Harga Rp tidak jelas", "Harga (Rp) tidak jelas?"), false);
});

test("normalizeSearch & matchesSearch: kata kunci 1..100 karakter, cocok tanpa peduli huruf besar", () => {
  assert.equal(normalizeSearch("   "), "");
  assert.equal(normalizeSearch("  Beasiswa  "), "Beasiswa");
  assert.equal(normalizeSearch("x".repeat(150)).length, SEARCH_MAX);
  assert.equal(matchesSearch("Beasiswa Cahaya Prestasi 2027", "cahaya"), true);
  assert.equal(matchesSearch("Beasiswa Cahaya Prestasi 2027", "robotik"), false);
  assert.equal(matchesSearch("Apa saja", ""), true);
});

test("mergeById: halaman berikutnya digabung tanpa duplikat, data asal tidak dimutasi", () => {
  const first = [{ id: "a", n: 1 }, { id: "b", n: 1 }];
  const merged = mergeById(first, [{ id: "b", n: 2 }, { id: "c", n: 2 }]);
  assert.deepEqual(merged, [{ id: "a", n: 1 }, { id: "b", n: 1 }, { id: "c", n: 2 }]);
  assert.equal(first.length, 2);
});

test("shownOfTotal & loadedSum: jumlah hanya utuh bila semua baris termuat", () => {
  assert.equal(shownOfTotal(50, 120), "Menampilkan 50 dari 120");
  assert.equal(shownOfTotal(3, 3), null);
  assert.equal(loadedSum("Rp 1.000", 2, 2), "Rp 1.000");
  assert.equal(loadedSum("Rp 1.000", 50, 120), "Rp 1.000 (dari 50 yang ditampilkan)");
});

test("timeAgo: menit, jam, hari; masa depan/sekarang = baru saja", () => {
  assert.equal(timeAgo("2026-09-26T06:59:40Z", NOW), "baru saja");
  assert.equal(timeAgo("2026-09-26T08:00:00Z", NOW), "baru saja", "jam server sedikit maju");
  assert.equal(timeAgo("2026-09-26T06:45:00Z", NOW), "15 menit lalu");
  assert.equal(timeAgo("2026-09-26T02:30:00Z", NOW), "4 jam lalu");
  assert.equal(timeAgo("2026-09-25T02:30:00Z", NOW), "1 hari lalu");
  assert.equal(timeAgo("2026-09-14T07:00:00Z", NOW), "12 hari lalu");
});

test("scheduleInfo: rentang tanggal WIB inklusif, lama tayang, dan posisi terhadap hari ini", () => {
  // 00.00 WIB 28 Sep s/d 00.00 WIB 26 Nov -> tayang 28 Sep – 25 Nov (59 hari), mulai 2 hari lagi.
  const upcoming = scheduleInfo("2026-09-27T17:00:00Z", "2026-11-25T17:00:00Z", NOW);
  assert.equal(upcoming.range, "28 Sep – 25 Nov 2026");
  assert.equal(upcoming.days, 59);
  assert.equal(upcoming.state, "upcoming");
  assert.equal(upcoming.note, "Mulai tayang dalam 1 hari");
  const running = scheduleInfo("2026-09-01T17:00:00Z", "2026-10-06T17:00:00Z", NOW);
  assert.equal(running.state, "running");
  assert.equal(running.note, "Sedang dalam periode tayang · berakhir dalam 10 hari");
  const ended = scheduleInfo("2026-08-01T17:00:00Z", "2026-09-20T17:00:00Z", NOW);
  assert.equal(ended.state, "ended");
  assert.equal(ended.note, "Jadwal tayang sudah berakhir");
  assert.equal(scheduleInfo("2026-12-27T17:00:00Z", "2027-01-09T17:00:00Z", NOW).range, "28 Des 2026 – 9 Jan 2027");
});

test("reachSummary: semua sekolah, satu, dua, dan banyak target", () => {
  assert.equal(reachSummary("ALL", []), "semua sekolah");
  assert.equal(reachSummary("PROVINCE", ["DKI Jakarta"]), "DKI Jakarta");
  assert.equal(reachSummary("PROVINCE", ["DKI Jakarta", "Jawa Barat"]), "DKI Jakarta dan Jawa Barat");
  assert.equal(reachSummary("SCHOOL", ["A", "B", "C", "D"]), "A, B, dan 2 lainnya");
});

test("applyPatches: tindakan lokal memindahkan item antar-tab tanpa mengubah data asal", () => {
  const items = [{ id: "a", status: "PENDING", note: null as string | null }, { id: "b", status: "PENDING", note: null }, { id: "c", status: "APPROVED", note: null }];
  const patches = { a: { status: "REJECTED", note: "Nominal tidak sesuai" } };
  assert.deepEqual(applyPatches(items, patches, "PENDING").map(i => i.id), ["b"]);
  assert.deepEqual(applyPatches(items, patches, "REJECTED"), [{ id: "a", status: "REJECTED", note: "Nominal tidak sesuai" }]);
  assert.deepEqual(applyPatches(items, {}, "APPROVED").map(i => i.id), ["c"]);
  assert.equal(items[0]?.status, "PENDING", "data asal tidak dimutasi");
});

test("nextAfter: setelah item diputuskan, pilih item berikutnya (atau sebelumnya di ujung)", () => {
  assert.equal(nextAfter(["a", "b", "c"], "a"), "b");
  assert.equal(nextAfter(["a", "b", "c"], "b"), "c");
  assert.equal(nextAfter(["a", "b", "c"], "c"), "b");
  assert.equal(nextAfter(["a"], "a"), null);
  assert.equal(nextAfter(["a", "b"], "x"), "a");
});

test("reviewFailure: data basi dimuat ulang, konflik saldo cukup dicoba lagi", () => {
  assert.equal(reviewFailure("AD_REVIEW_STALE").reload, true);
  assert.equal(reviewFailure("AD_INVALID_TRANSITION").reload, true);
  assert.equal(reviewFailure("TOPUP_ALREADY_REVIEWED").reload, true);
  assert.equal(reviewFailure("CONFLICT_RETRY").reload, false);
  assert.match(reviewFailure("CONFLICT_RETRY").hint ?? "", /Coba lagi/);
  assert.match(reviewFailure("AD_SCHEDULE_INVALID").hint ?? "", /jadwal/);
  assert.deepEqual(reviewFailure("UNKNOWN"), { reload: false, hint: null });
});

test("safeHref: hanya http(s) yang boleh jadi tautan yang bisa diklik peninjau", () => {
  assert.equal(safeHref("https://cahayailmu.example/beasiswa"), "https://cahayailmu.example/beasiswa");
  assert.equal(safeHref("http://contoh.example"), "http://contoh.example/");
  assert.equal(safeHref("javascript:alert(1)"), null);
  assert.equal(safeHref("data:text/html,hai"), null);
  assert.equal(safeHref("studenthub://kelas/1"), null, "deep link aplikasi tidak dibuka di browser admin");
  assert.equal(safeHref("bukan url"), null);
});

test("resolveSelection: pilihan tetap bila masih ada; layar lebar otomatis memilih yang pertama", () => {
  assert.equal(resolveSelection("b", ["a", "b"], true), "b");
  assert.equal(resolveSelection("x", ["a", "b"], true), "a");
  assert.equal(resolveSelection(null, ["a", "b"], true), "a");
  assert.equal(resolveSelection(null, ["a", "b"], false), null);
  assert.equal(resolveSelection("x", ["a"], false), null);
  assert.equal(resolveSelection(null, [], true), null);
});

test("wibDateTime: tanggal & jam WIB", () => {
  assert.equal(wibDateTime("2026-09-25T02:30:00Z"), "25 Sep 2026, 09.30 WIB");
});

test("calendarDate: tanggal kalender (YYYY-MM-DD) tidak bergeser oleh zona waktu browser", () => {
  assert.equal(calendarDate("2026-09-25"), "25 September 2026");
  assert.equal(calendarDate("2026-09-25", "short"), "25 Sep 2026");
  assert.equal(calendarDate("bukan tanggal"), "bukan tanggal");
});

test("approveBlocker: sponsor belum disetujui atau jadwal berakhir = tombol Setujui dinonaktifkan", () => {
  const ok = { sponsorStatus: "APPROVED", endAt: "2026-10-30T17:00:00Z", submittedAt: "2026-09-25T02:30:00Z" };
  assert.equal(approveBlocker(ok, NOW), null);
  assert.match(approveBlocker({ ...ok, sponsorStatus: "SUSPENDED" }, NOW) ?? "", /Sponsor/);
  assert.match(approveBlocker({ ...ok, endAt: "2026-09-26T07:00:00Z" }, NOW) ?? "", /berakhir/);
  assert.match(approveBlocker({ ...ok, submittedAt: null }, NOW) ?? "", /belum diajukan/);
});

test("countLabel & shortRef", () => {
  assert.equal(countLabel("Menunggu", 2), "Menunggu (2)");
  assert.equal(countLabel("Menunggu", null), "Menunggu");
  assert.equal(countLabel("Menunggu", 0), "Menunggu");
  assert.equal(shortRef("tu-cahaya-4"), "#HAYA-4");
  assert.equal(shortRef("cm1x9zq0000ab12cd"), "#AB12CD");
});
