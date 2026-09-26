import { test } from "node:test";
import assert from "node:assert/strict";
import type { AdDto } from "./ad-types";
import { rupiah } from "./format";
import {
  INVALID_DATE, SCHEDULE_DATE_MAX, SCHEDULE_DATE_MIN, STALE_RELOAD_FAILED, appendById, isScheduleDate, isStaleCampaign, quickEndDate, rebaseDraft,
  scheduleDateProblem, scheduleDays, scheduleHint,
  amountDigits, applyDemoAction, bannerFileProblem, bannerSizeProblem, campaignActions, campaignFailure, createBody, daysInclusive,
  demoCreateAd, demoNotice, demoPatchAd, demoTopUp, draftFromAd, integerAxisMax, emptyDraft, filterCounts, formatAmountInput, groupByDay, isHeic, lastDayOf, linkProblem,
  matchesFilter, normalizeLinkInput, patchBody, regionsFromSchools, remainingShare, runwayDays, scheduleRange, signedRupiah, statusTone,
  targetSummary, toEndIso, toStartIso, topUpBlockReason, topUpFailure, topUpTextFields, transferDateRange, validateDraft, validateTopUp, wibTime,
  type CampaignDraft, type TopUpForm,
} from "./campaign-rules";

const TODAY = "2026-09-26";
const NOW = "2026-09-26T03:00:00.000Z";

function ad(overrides: Partial<AdDto> = {}): AdDto {
  return {
    id: "ad1", sponsorId: "sp1", title: "Belajar 20 menit sehari", imageFileId: "file1", imageUrl: null, linkType: "EXTERNAL_URL",
    targetUrl: "https://cahayailmu.id/belajar", startAt: "2026-09-30T17:00:00.000Z", endAt: "2026-10-30T17:00:00.000Z",
    status: "DRAFT", displayStatus: "DRAFT", isActive: false, targetScope: "ALL", targets: [], cpcAmount: 500,
    submittedAt: null, reviewNote: null, reviewedAt: null, createdAt: "2026-09-20T03:00:00.000Z", updatedAt: "2026-09-21T03:00:00.000Z",
    ...overrides,
  };
}

function draft(overrides: Partial<CampaignDraft> = {}): CampaignDraft {
  return {
    title: "Belajar 20 menit sehari", imageFileId: "file1", linkType: "EXTERNAL_URL", targetUrl: "https://cahayailmu.id/belajar",
    scope: "ALL", targets: [], startDate: "2026-10-01", endDate: "2026-10-30", ...overrides,
  };
}

// ----------------------------------------------------------------------------- daftar & status

test("filter chip: Tayang = LIVE, Selesai = berakhir/diarsipkan, sisanya per status tampilan", () => {
  const list = (["LIVE", "SCHEDULED", "PENDING_REVIEW", "DRAFT", "REJECTED", "PAUSED", "ENDED", "ARCHIVED"] as const).map(displayStatus => ({ displayStatus }));
  assert.deepEqual(filterCounts(list), { ALL: 8, LIVE: 1, PENDING_REVIEW: 1, DRAFT: 1, REJECTED: 1, PAUSED: 1, DONE: 2 });
  assert.equal(matchesFilter({ displayStatus: "SCHEDULED" }, "LIVE"), false, "terjadwal belum tayang");
  assert.equal(matchesFilter({ displayStatus: "ENDED" }, "DONE"), true);
  assert.equal(matchesFilter({ displayStatus: "NO_BALANCE" }, "ALL"), true);
});

test("statusTone: tayang hijau, butuh perhatian kuning/merah, sisanya netral", () => {
  assert.equal(statusTone("LIVE"), "green");
  assert.equal(statusTone("SCHEDULED"), "blue");
  assert.equal(statusTone("PENDING_REVIEW"), "amber");
  assert.equal(statusTone("PAUSED"), "amber");
  assert.equal(statusTone("REJECTED"), "red");
  assert.equal(statusTone("NO_BALANCE"), "red");
  assert.equal(statusTone("SPONSOR_INACTIVE"), "red");
  assert.equal(statusTone("DRAFT"), "neutral");
  assert.equal(statusTone("ARCHIVED"), "neutral");
});

// ----------------------------------------------------------------------------- tanggal & jadwal

test("tanggal lokal -> ISO +07:00; tanggal selesai inklusif = hari berikutnya pukul 00.00 WIB", () => {
  assert.equal(toStartIso("2026-10-01"), "2026-10-01T00:00:00+07:00");
  assert.equal(toEndIso("2026-10-31"), "2026-11-01T00:00:00+07:00");
  assert.equal(toEndIso("2026-12-31"), "2027-01-01T00:00:00+07:00");
  assert.equal(lastDayOf("2026-10-31T17:00:00.000Z"), "2026-10-31", "00.00 WIB 1 Nov = hari terakhir 31 Okt");
  assert.equal(lastDayOf("2026-10-31T08:00:00.000Z"), "2026-10-31", "15.00 WIB tetap hari itu");
  assert.equal(daysInclusive("2026-10-01", "2026-10-30"), 30);
});

test("scheduleRange ringkas: tahun hanya bila bukan tahun ini atau lintas tahun", () => {
  assert.equal(scheduleRange("2026-09-11T17:00:00.000Z", "2026-11-05T17:00:00.000Z", TODAY), "12 Sep – 5 Nov");
  assert.equal(scheduleRange("2026-12-19T17:00:00.000Z", "2027-01-10T17:00:00.000Z", TODAY), "20 Des 2026 – 10 Jan 2027");
  assert.equal(scheduleRange("2027-01-31T17:00:00.000Z", "2027-02-28T17:00:00.000Z", TODAY), "1 Feb – 28 Feb 2027");
  assert.equal(scheduleRange("2026-09-11T17:00:00.000Z", "2026-09-12T17:00:00.000Z", TODAY), "12 Sep");
});

test("targetSummary menyebut cakupan dengan bahasa manusia", () => {
  assert.equal(targetSummary("ALL", []), "Semua sekolah");
  assert.equal(targetSummary("PROVINCE", [{ label: "DKI Jakarta" }]), "DKI Jakarta");
  assert.equal(targetSummary("PROVINCE", [{ label: "DKI Jakarta" }, { label: "Jawa Barat" }]), "DKI Jakarta, Jawa Barat");
  assert.equal(targetSummary("CITY", [{ label: "Kota Bandung" }, { label: "Kota Bogor" }, { label: "Kota Depok" }]), "Kota Bandung dan 2 kota lain");
  assert.equal(targetSummary("SCHOOL", [{ label: "SMA A" }, { label: "SMA B" }, { label: "SMA C" }]), "SMA A dan 2 sekolah lain");
});

// ----------------------------------------------------------------------------- draf editor

test("emptyDraft: jadwal default 30 hari mulai hari ini, semua sekolah", () => {
  assert.deepEqual(emptyDraft(TODAY), { title: "", imageFileId: null, linkType: "EXTERNAL_URL", targetUrl: "", scope: "ALL", targets: [], startDate: TODAY, endDate: "2026-10-25" });
});

test("draftFromAd mengubah jadwal ISO ke tanggal WIB dan target ke chip", () => {
  const source = ad({ targetScope: "PROVINCE", targets: [{ provinceCode: "31", cityCode: null, schoolId: null, label: "DKI Jakarta" }] });
  assert.deepEqual(draftFromAd(source), draft({ scope: "PROVINCE", targets: [{ code: "31", label: "DKI Jakarta" }] }));
});

test("linkProblem meniru aturan server: https, host bernama, tanpa userinfo/spasi; tautan aplikasi tanpa skema web", () => {
  assert.equal(linkProblem("EXTERNAL_URL", "https://cahayailmu.id/promo"), null);
  assert.match(linkProblem("EXTERNAL_URL", "") ?? "", /Isi tautan/);
  assert.match(linkProblem("EXTERNAL_URL", "http://cahayailmu.id") ?? "", /https:\/\//);
  assert.match(linkProblem("EXTERNAL_URL", "https://localhost/x") ?? "", /alamat situs/);
  assert.match(linkProblem("EXTERNAL_URL", "https://user:pw@cahayailmu.id") ?? "", /nama pengguna/);
  assert.match(linkProblem("EXTERNAL_URL", "https://cahaya ilmu.id") ?? "", /spasi/);
  assert.equal(linkProblem("DEEP_LINK", "cahaya://kelas/1"), null);
  assert.match(linkProblem("DEEP_LINK", "javascript:alert(1)") ?? "", /skema aplikasi/);
  assert.match(linkProblem("DEEP_LINK", "https://cahayailmu.id") ?? "", /skema aplikasi/);
});

test("normalizeLinkInput menambahkan https:// pada domain tanpa skema", () => {
  assert.equal(normalizeLinkInput("EXTERNAL_URL", "  cahayailmu.id/promo "), "https://cahayailmu.id/promo");
  assert.equal(normalizeLinkInput("EXTERNAL_URL", "https://cahayailmu.id"), "https://cahayailmu.id");
  assert.equal(normalizeLinkInput("EXTERNAL_URL", "http://cahayailmu.id"), "http://cahayailmu.id", "http tidak diubah diam-diam");
  assert.equal(normalizeLinkInput("EXTERNAL_URL", ""), "");
  assert.equal(normalizeLinkInput("DEEP_LINK", " cahaya://kelas "), "cahaya://kelas");
});

test("validateDraft: semua field wajib, target sesuai cakupan, jadwal dalam batas", () => {
  assert.deepEqual(validateDraft(draft(), "submit", TODAY), {});
  const bad = validateDraft(draft({ title: " ab ", imageFileId: null, targetUrl: "", scope: "PROVINCE" }), "draft", TODAY);
  assert.deepEqual(Object.keys(bad).sort(), ["banner", "targetUrl", "targets", "title"]);
  assert.match(bad.targets ?? "", /provinsi/);
  assert.match(validateDraft(draft({ title: "x".repeat(101) }), "draft", TODAY).title ?? "", /maksimal 100/);
  assert.match(validateDraft(draft({ endDate: "2026-09-30" }), "draft", TODAY).schedule ?? "", /sebelum tanggal mulai/);
  assert.match(validateDraft(draft({ startDate: "2026-10-01", endDate: "2027-10-02" }), "draft", TODAY).schedule ?? "", /366 hari/);
  assert.equal(validateDraft(draft({ startDate: "2026-10-01", endDate: "2027-10-01" }), "draft", TODAY).schedule, undefined, "tepat 366 hari boleh");
  assert.match(validateDraft(draft({ startDate: "2027-09-27", endDate: "2027-10-01" }), "draft", TODAY).schedule ?? "", /365 hari ke depan/);
  assert.match(validateDraft(draft({ startDate: "", endDate: "" }), "draft", TODAY).schedule ?? "", /Isi tanggal/);
  const past = draft({ startDate: "2026-09-01", endDate: "2026-09-25" });
  assert.equal(validateDraft(past, "draft", TODAY).schedule, undefined, "draf boleh jadwal lampau");
  assert.match(validateDraft(past, "submit", TODAY).schedule ?? "", /sudah lewat/);
  assert.equal(validateDraft(draft({ startDate: "2026-09-01", endDate: TODAY }), "submit", TODAY).schedule, undefined, "berakhir malam ini masih boleh");
});

test("jadwal: tahun 5 digit / tanggal mustahil ditolak dengan pesan, tanpa RangeError", () => {
  for (const bad of ["20261-01-01", "2026-02-30", "2026-9-1", "1999-12-31", "+010000-01-01"]) {
    assert.equal(isScheduleDate(bad), false, bad);
    assert.doesNotThrow(() => validateDraft(draft({ endDate: bad }), "submit", TODAY), bad);
    assert.match(validateDraft(draft({ endDate: bad }), "draft", TODAY).schedule ?? "", /^Tanggal tidak valid/, bad);
    assert.match(validateDraft(draft({ startDate: bad }), "draft", TODAY).schedule ?? "", /^Tanggal tidak valid/, bad);
    assert.equal(scheduleDays("2026-10-01", bad), null, bad);
    assert.equal(quickEndDate(bad, 7), null, bad);
    assert.equal(scheduleHint("2026-10-01", bad), "Tanggal selesai ikut ditayangkan sampai pukul 23.59 WIB.", bad);
    assert.equal(scheduleDateProblem(bad, "2026-10-30"), INVALID_DATE, bad);
  }
  assert.equal(isScheduleDate("2026-10-01"), true);
  assert.equal(isScheduleDate(SCHEDULE_DATE_MIN) && isScheduleDate(SCHEDULE_DATE_MAX), true, "batas atribut min/max sendiri sah");
  assert.equal(scheduleDateProblem("", ""), null, "kosong ditangani 'Isi tanggal'");
  assert.equal(scheduleDays("2026-10-01", "2026-10-30"), 30);
  assert.equal(scheduleDays("2026-10-30", "2026-10-01"), null, "selesai sebelum mulai");
  assert.equal(quickEndDate("2026-10-01", 7), "2026-10-07");
  assert.equal(quickEndDate("9999-12-30", 7), null, "melewati tahun 9999 tidak ditawarkan");
  assert.equal(scheduleHint("2026-10-01", "2026-10-07"), "7 hari tayang: 1 Okt pukul 00.00 sampai 7 Okt pukul 23.59 WIB.");
  assert.equal(scheduleHint("", "2026-10-07"), "Tanggal selesai ikut ditayangkan sampai pukul 23.59 WIB.");
});

test("createBody: kontrak strict — ALL tanpa targets, judul dirapikan, tanggal ke ISO +07:00", () => {
  assert.deepEqual(createBody(draft({ title: "  Belajar   20 menit sehari " })), {
    title: "Belajar 20 menit sehari", imageFileId: "file1", linkType: "EXTERNAL_URL", targetUrl: "https://cahayailmu.id/belajar",
    startAt: "2026-10-01T00:00:00+07:00", endAt: "2026-10-31T00:00:00+07:00", targetScope: "ALL",
  });
  const scoped = createBody(draft({ scope: "CITY", targets: [{ code: "31.71", label: "Kota Jakarta Pusat" }, { code: "32.73", label: "Kota Bandung" }] }));
  assert.deepEqual(scoped.targets, { cityCodes: ["31.71", "32.73"] });
  assert.equal(scoped.targetScope, "CITY");
});

test("patchBody hanya mengirim yang berubah + expectedUpdatedAt; null bila tidak ada perubahan", () => {
  const source = ad({ targetScope: "PROVINCE", targets: [{ provinceCode: "31", cityCode: null, schoolId: null, label: "DKI Jakarta" }] });
  const base = draftFromAd(source);
  assert.equal(patchBody(base, source), null);
  assert.deepEqual(patchBody({ ...base, title: "Judul baru" }, source), { title: "Judul baru", expectedUpdatedAt: source.updatedAt });
  assert.deepEqual(patchBody({ ...base, scope: "ALL", targets: [] }, source), { targetScope: "ALL", expectedUpdatedAt: source.updatedAt });
  assert.deepEqual(patchBody({ ...base, targets: [...base.targets, { code: "32", label: "Jawa Barat" }] }, source), {
    targetScope: "PROVINCE", targets: { provinceCodes: ["31", "32"] }, expectedUpdatedAt: source.updatedAt,
  });
  assert.deepEqual(patchBody({ ...base, endDate: "2026-11-30" }, source), { endAt: "2026-12-01T00:00:00+07:00", expectedUpdatedAt: source.updatedAt });
});

test("campaignFailure memetakan galat server ke field editor", () => {
  assert.equal(campaignFailure({ code: "AD_LINK_INVALID", message: "x", details: { reason: "HOST" } }).field, "targetUrl");
  assert.deepEqual(campaignFailure({ code: "AD_SCHEDULE_INVALID", message: "Durasi tayang maksimal 366 hari." }), { field: "schedule", message: "Durasi tayang maksimal 366 hari." });
  assert.equal(campaignFailure({ code: "AD_TARGETS_INVALID", message: "Pilih minimal satu target." }).field, "targets");
  assert.deepEqual(campaignFailure({ code: "BANNER_INVALID", message: "x", details: { reason: "ASPECT" } }).field, "banner");
  assert.deepEqual(campaignFailure({ code: "VALIDATION_FAILED", message: "Judul minimal 3 karakter.", details: [{ path: "body.title", message: "Judul minimal 3 karakter." }] }), { field: "title", message: "Judul minimal 3 karakter." });
  assert.equal(campaignFailure({ code: "STATE_CONFLICT", message: "x" }).field, "general");
  assert.equal(campaignFailure({ code: "STATE_CONFLICT", message: "x" }).message, "Data kampanye berubah; kami memuat versi terbaru — periksa lalu simpan lagi.");
  assert.match(campaignFailure({ code: "AD_INVALID_TRANSITION", message: "x" }).message, /kami memuat versi terbaru/);
  assert.deepEqual(campaignFailure({ code: "UNKNOWN", message: "Server sibuk." }), { field: "general", message: "Server sibuk." });
});

test("galat basi (STATE_CONFLICT/AD_INVALID_TRANSITION) memicu muat ulang kampanye", () => {
  assert.equal(isStaleCampaign({ code: "STATE_CONFLICT" }), true);
  assert.equal(isStaleCampaign({ code: "AD_INVALID_TRANSITION" }), true);
  assert.equal(isStaleCampaign({ code: "AD_EDIT_WHILE_PENDING" }), false);
  assert.match(STALE_RELOAD_FAILED, /gagal dimuat/);
});

test("rebaseDraft: isian yang diubah pengguna dipertahankan, sisanya ikut versi terbaru", () => {
  const before = ad({ targetScope: "PROVINCE", targets: [{ provinceCode: "31", cityCode: null, schoolId: null, label: "DKI Jakarta" }] });
  const latest = ad({ title: "Judul dari tab lain", endAt: "2026-11-29T17:00:00.000Z", status: "PAUSED", updatedAt: "2026-09-26T02:00:00.000Z" });
  const mine = { ...draftFromAd(before), targetUrl: "https://cahayailmu.id/baru", startDate: "2026-10-02" };
  const rebased = rebaseDraft(mine, before, latest);
  assert.equal(rebased.title, "Judul dari tab lain", "judul tidak disentuh -> versi terbaru");
  assert.equal(rebased.endDate, "2026-11-29", "tanggal selesai tidak disentuh -> versi terbaru");
  assert.equal(rebased.scope, "ALL", "jangkauan tidak disentuh -> versi terbaru");
  assert.equal(rebased.targetUrl, "https://cahayailmu.id/baru", "tautan diubah pengguna -> dipertahankan");
  assert.equal(rebased.startDate, "2026-10-02", "tanggal mulai diubah pengguna -> dipertahankan");
  assert.deepEqual(patchBody(rebased, latest), { targetUrl: "https://cahayailmu.id/baru", startAt: "2026-10-02T00:00:00+07:00", expectedUpdatedAt: latest.updatedAt });
  assert.deepEqual(rebaseDraft(draftFromAd(before), before, latest), draftFromAd(latest), "tanpa perubahan -> sama dengan versi terbaru");
});

test("appendById: halaman berikutnya tanpa baris ganda (paginasi offset saat data bertambah)", () => {
  const rows = [{ id: "a", n: 1 }, { id: "b", n: 2 }];
  assert.deepEqual(appendById(rows, [{ id: "b", n: 9 }, { id: "c", n: 3 }]), [{ id: "a", n: 1 }, { id: "b", n: 2 }, { id: "c", n: 3 }]);
  assert.deepEqual(appendById([], rows), rows);
  assert.deepEqual(rows.map(r => r.id), ["a", "b"], "masukan tidak diubah");
});

test("pemeriksaan banner di klien sama dengan server: format, ukuran berkas, 2:1 ±2%, minimal 800×400", () => {
  assert.match(bannerFileProblem({ name: "IMG_1.HEIC", type: "image/heic", size: 10 }) ?? "", /HEIC/);
  assert.match(bannerFileProblem({ name: "a.gif", type: "image/gif", size: 10 }) ?? "", /JPEG, PNG, atau WebP/);
  assert.match(bannerFileProblem({ name: "a.png", type: "image/png", size: 6 * 1024 * 1024 }) ?? "", /5 MB/);
  assert.equal(bannerFileProblem({ name: "a.webp", type: "image/webp", size: 1024 }), null);
  assert.equal(bannerSizeProblem(1200, 600), null);
  assert.equal(bannerSizeProblem(1210, 600), null, "masih dalam toleransi 2%");
  assert.match(bannerSizeProblem(1300, 600) ?? "", /2:1/);
  assert.match(bannerSizeProblem(798, 399) ?? "", /800×400/);
});

// ----------------------------------------------------------------------------- aksi & demo

const keys = (list: ReturnType<typeof campaignActions>) => list.map(a => a.key);

test("campaignActions hanya menawarkan transisi yang sah per status", () => {
  assert.deepEqual(keys(campaignActions(ad(), "APPROVED")), ["submit", "edit", "delete", "archive"]);
  assert.deepEqual(keys(campaignActions(ad({ status: "PENDING_REVIEW", displayStatus: "PENDING_REVIEW" }), "APPROVED")), ["withdraw"]);
  assert.deepEqual(keys(campaignActions(ad({ status: "APPROVED", displayStatus: "LIVE" }), "APPROVED")), ["pause", "edit", "archive"]);
  assert.deepEqual(keys(campaignActions(ad({ status: "APPROVED", displayStatus: "ENDED" }), "APPROVED")), ["edit", "archive"]);
  assert.deepEqual(keys(campaignActions(ad({ status: "PAUSED", displayStatus: "PAUSED" }), "APPROVED")), ["resume", "edit", "archive"]);
  assert.deepEqual(keys(campaignActions(ad({ status: "REJECTED", displayStatus: "REJECTED" }), "APPROVED")), ["edit", "submit", "archive"]);
  assert.deepEqual(keys(campaignActions(ad({ status: "ARCHIVED", displayStatus: "ARCHIVED" }), "APPROVED")), []);
  assert.deepEqual(campaignActions(ad(), "SUSPENDED"), [], "akun ditangguhkan hanya baca");
  const pending = campaignActions(ad(), "PENDING").find(a => a.key === "submit");
  assert.match(pending?.disabledReason ?? "", /diverifikasi/);
  assert.ok(campaignActions(ad(), "APPROVED").find(a => a.key === "delete")?.confirm, "hapus perlu konfirmasi");
});

test("applyDemoAction mensimulasikan transisi dan status tampilan", () => {
  const live = { startAt: "2026-09-01T00:00:00.000Z", endAt: "2026-10-30T17:00:00.000Z" };
  const submitted = applyDemoAction(ad(), "submit", NOW);
  assert.equal(submitted.status, "PENDING_REVIEW");
  assert.equal(submitted.displayStatus, "PENDING_REVIEW");
  assert.equal(submitted.submittedAt, NOW);
  const resumed = applyDemoAction(ad({ ...live, status: "PAUSED", displayStatus: "PAUSED" }), "resume", NOW);
  assert.deepEqual([resumed.status, resumed.displayStatus, resumed.isActive], ["APPROVED", "LIVE", true]);
  const paused = applyDemoAction(ad({ ...live, status: "APPROVED", displayStatus: "LIVE", isActive: true }), "pause", NOW);
  assert.deepEqual([paused.status, paused.displayStatus, paused.isActive], ["PAUSED", "PAUSED", false]);
  assert.equal(applyDemoAction(ad({ status: "PENDING_REVIEW" }), "withdraw", NOW).status, "DRAFT");
  assert.equal(applyDemoAction(ad(), "archive", NOW).displayStatus, "ARCHIVED");
});

test("demoCreateAd & demoPatchAd: draf baru, tinjau ulang bila konten iklan aktif berubah", () => {
  const created = demoCreateAd(draft({ scope: "SCHOOL", targets: [{ code: "sc1", label: "SMA Cendekia" }] }), { id: "new1", sponsorId: "sp1", cpc: 500, nowIso: NOW });
  assert.equal(created.status, "DRAFT");
  assert.equal(created.startAt, "2026-09-30T17:00:00.000Z");
  assert.deepEqual(created.targets, [{ provinceCode: null, cityCode: null, schoolId: "sc1", label: "SMA Cendekia" }]);
  const approved = ad({ status: "APPROVED", displayStatus: "SCHEDULED" });
  const renamed = demoPatchAd(approved, { ...draftFromAd(approved), title: "Judul lain" }, NOW);
  assert.deepEqual([renamed.reReviewTriggered, renamed.ad.status, renamed.ad.title], [false, "APPROVED", "Judul lain"]);
  const relinked = demoPatchAd(approved, { ...draftFromAd(approved), targetUrl: "https://cahayailmu.id/baru" }, NOW);
  assert.deepEqual([relinked.reReviewTriggered, relinked.ad.status, relinked.ad.displayStatus], [true, "PENDING_REVIEW", "PENDING_REVIEW"]);
});

test("regionsFromSchools menurunkan provinsi & kota unik (data demo tanpa API wilayah)", () => {
  const schools = [
    { id: "a", name: "A", provinceCode: "32", provinceName: "Jawa Barat", cityCode: "32.73", cityName: "Kota Bandung" },
    { id: "b", name: "B", provinceCode: "31", provinceName: "DKI Jakarta", cityCode: "31.71", cityName: "Kota Jakarta Pusat" },
    { id: "c", name: "C", provinceCode: "32", provinceName: "Jawa Barat", cityCode: "32.73", cityName: "Kota Bandung" },
  ];
  const regions = regionsFromSchools(schools);
  assert.deepEqual(regions.provinces, [{ code: "31", name: "DKI Jakarta" }, { code: "32", name: "Jawa Barat" }]);
  assert.deepEqual(regions.cities, [{ code: "31.71", provinceCode: "31", name: "Kota Jakarta Pusat" }, { code: "32.73", provinceCode: "32", name: "Kota Bandung" }]);
});

// ----------------------------------------------------------------------------- saldo & top-up

test("input nominal: hanya digit, tanpa nol di depan, maks 9 digit; tampil berpemisah ribuan", () => {
  assert.equal(amountDigits("Rp 1.500.000"), "1500000");
  assert.equal(amountDigits("00120"), "120");
  assert.equal(amountDigits("abc"), "");
  assert.equal(amountDigits("1234567890"), "123456789");
  assert.equal(amountDigits("Rp500.000,00"), "500000", "desimal ,00 hasil tempel dibuang (bukan 100×)");
  assert.equal(amountDigits("500.000"), "500000");
  assert.equal(amountDigits("Rp 500.000,- "), "500000");
  assert.equal(amountDigits("500.000,5"), "500000");
  assert.equal(amountDigits("IDR 500,000.00"), "500000", "format Inggris: .00 setelah ribuan berkoma");
  assert.equal(amountDigits("1,000"), "1000", "koma + 3 digit = pemisah ribuan");
  assert.equal(amountDigits("50.00"), "5000", "titik selalu pemisah ribuan (hapus satu digit dari 50.000)");
  assert.equal(formatAmountInput("1500000"), "1.500.000");
  assert.equal(formatAmountInput(""), "");
});

const proof = { name: "bukti.jpg", type: "image/jpeg", size: 200_000 };
function form(overrides: Partial<TopUpForm> = {}): TopUpForm {
  return { amount: "500000", transferDate: TODAY, senderName: "PT Cahaya Ilmu", senderBank: "BCA", note: "", file: proof, ...overrides };
}

test("isHeic mengenali foto iPhone dari tipe maupun ekstensi", () => {
  assert.equal(isHeic({ name: "IMG_1.HEIC", type: "" }), true);
  assert.equal(isHeic({ name: "a.jpg", type: "image/heif" }), true);
  assert.equal(isHeic({ name: "a.jpg", type: "image/jpeg" }), false);
});

test("validateTopUp: nominal minimal, tanggal transfer 30 hari terakhir, pengirim, catatan, bukti", () => {
  const ctx = { min: 100_000, today: TODAY };
  assert.deepEqual(validateTopUp(form(), ctx), {});
  assert.match(validateTopUp(form({ amount: "50000" }), ctx).amount ?? "", /Minimal/);
  assert.match(validateTopUp(form({ amount: "" }), ctx).amount ?? "", /Isi nominal/);
  assert.match(validateTopUp(form({ transferDate: "2026-08-26" }), ctx).transferDate ?? "", /30 hari/);
  assert.equal(validateTopUp(form({ transferDate: "2026-08-27" }), ctx).transferDate, undefined);
  assert.match(validateTopUp(form({ transferDate: "2026-09-27" }), ctx).transferDate ?? "", /30 hari/);
  assert.match(validateTopUp(form({ senderName: " A " }), ctx).senderName ?? "", /minimal 2/);
  assert.match(validateTopUp(form({ senderBank: "" }), ctx).senderBank ?? "", /minimal 2/);
  assert.match(validateTopUp(form({ note: "x".repeat(256) }), ctx).note ?? "", /255/);
  assert.match(validateTopUp(form({ file: null }), ctx).file ?? "", /bukti/);
  assert.match(validateTopUp(form({ file: { name: "IMG.heic", type: "image/heic", size: 10 } }), ctx).file ?? "", /HEIC/);
  assert.match(validateTopUp(form({ file: { ...proof, size: 9 * 1024 * 1024 } }), ctx).file ?? "", /8 MB/);
});

test("topUpTextFields: field teks persis kontrak; catatan hanya bila diisi", () => {
  assert.deepEqual(topUpTextFields(form({ senderName: "  PT  Cahaya " })), [["amount", "500000"], ["transferDate", TODAY], ["senderName", "PT Cahaya"], ["senderBank", "BCA"]]);
  assert.deepEqual(topUpTextFields(form({ note: " Top-up Oktober " })).at(-1), ["note", "Top-up Oktober"]);
});

test("demoTopUp membuat pengajuan PENDING dari formulir; transferDateRange = 30 hari terakhir", () => {
  const row = demoTopUp(form({ note: "  " }), { id: "tu-new", sponsorId: "sp1", proofFileId: "demo:ads/bukti-transfer.svg", nowIso: NOW });
  assert.deepEqual([row.status, row.amount, row.note, row.createdAt], ["PENDING", 500_000, null, NOW]);
  assert.deepEqual(transferDateRange(TODAY), { earliest: "2026-08-27", latest: TODAY });
});

test("topUpFailure memetakan galat server ke pesan ramah per field", () => {
  assert.deepEqual(topUpFailure({ code: "TOPUP_AMOUNT_INVALID", message: "x", details: { min: 100_000, max: 100_000_000 } }), { field: "amount", message: `Nominal harus antara ${rupiah(100_000)} dan ${rupiah(100_000_000)}.` });
  assert.deepEqual(topUpFailure({ code: "TRANSFER_DATE_OUT_OF_RANGE", message: "x", details: { earliest: "2026-08-27", latest: TODAY } }), { field: "transferDate", message: "Tanggal transfer harus antara 27 Agu 2026 dan 26 Sep 2026." });
  assert.equal(topUpFailure({ code: "TOPUP_LIMIT", message: "x" }).field, "general");
  assert.equal(topUpFailure({ code: "HEIC_NOT_SUPPORTED", message: "x" }).field, "file");
  assert.equal(topUpFailure({ code: "VALIDATION_FAILED", message: "Nama pengirim minimal 2 karakter.", details: [{ path: "body.senderName", message: "Nama pengirim minimal 2 karakter." }] }).field, "senderName");
});

test("topUpBlockReason: rekening belum diatur, akun belum disetujui/ditangguhkan, 3 pengajuan menunggu", () => {
  const account = { bankName: "Bank Contoh", accountNumber: "123", accountHolder: "PT" };
  assert.equal(topUpBlockReason({ account, sponsorStatus: "APPROVED", pending: 2 }), null);
  assert.match(topUpBlockReason({ account: null, sponsorStatus: "APPROVED", pending: 0 }) ?? "", /Rekening/);
  assert.match(topUpBlockReason({ account, sponsorStatus: "PENDING", pending: 0 }) ?? "", /disetujui/);
  assert.match(topUpBlockReason({ account, sponsorStatus: "SUSPENDED", pending: 0 }) ?? "", /ditangguhkan/);
  assert.match(topUpBlockReason({ account, sponsorStatus: "APPROVED", pending: 3 }) ?? "", /3 pengajuan/);
});

test("signedRupiah memakai tanda +/− (bukan hanya warna)", () => {
  assert.equal(signedRupiah(2_000_000), `+${rupiah(2_000_000)}`);
  assert.equal(signedRupiah(-500), `−${rupiah(500)}`);
  assert.equal(signedRupiah(0), rupiah(0));
});

test("groupByDay mengelompokkan mutasi per hari WIB: Hari ini, Kemarin, lalu tanggal", () => {
  const rows = [
    { id: "1", createdAt: "2026-09-26T04:50:00.000Z" },
    { id: "2", createdAt: "2026-09-25T18:00:00.000Z" },
    { id: "3", createdAt: "2026-09-25T09:00:00.000Z" },
    { id: "4", createdAt: "2026-09-21T08:00:00.000Z" },
  ];
  const groups = groupByDay(rows, TODAY);
  assert.deepEqual(groups.map(g => [g.label, g.entries.map(e => e.id)]), [["Hari ini", ["1", "2"]], ["Kemarin", ["3"]], ["21 Sep 2026", ["4"]]]);
  assert.equal(wibTime("2026-09-26T04:50:00.000Z"), "11.50");
});

test("integerAxisMax: batas sumbu kelipatan 4 agar garis bantu hitungan selalu bilangan bulat", () => {
  assert.equal(integerAxisMax(14), 16);
  assert.equal(integerAxisMax(1_863), 2_000);
  assert.equal(integerAxisMax(5.5), 8);
  assert.equal(integerAxisMax(2), 4);
  assert.equal(integerAxisMax(0), undefined);
});

test("demoNotice: pesan hasil simulasi demo satu kalimat", () => {
  assert.equal(demoNotice("Kampanye diajukan untuk ditinjau."), "Mode demo: kampanye diajukan untuk ditinjau (simulasi).");
});

test("runwayDays & remainingShare untuk ringkasan saldo", () => {
  assert.equal(runwayDays(100_000, 70_000), 10);
  assert.equal(runwayDays(100_000, 0), null);
  assert.equal(runwayDays(0, 70_000), 0);
  assert.equal(remainingShare(250_000, 1_000_000, 0), 0.25);
  assert.equal(remainingShare(0, 0, 0), 0);
  assert.equal(remainingShare(2_000_000, 1_000_000, 0), 1);
});
