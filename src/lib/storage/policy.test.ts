import { test } from "node:test";
import assert from "node:assert/strict";
import type { FileKind, UserRole } from "@prisma/client";
import { isAppError } from "@/lib/http/errors";
import { assertCanUpload, checkBannerMeta, MAX_INPUT_PIXELS, UPLOAD_POLICY } from "./policy";

const MIB = 1024 * 1024;
const KINDS: readonly FileKind[] = ["AD_BANNER", "ATTENDANCE_SELFIE", "PAYMENT_PROOF", "TOPUP_PROOF", "LEAVE_ATTACHMENT"];
const ROLES: readonly UserRole[] = ["SUPER_ADMIN", "SCHOOL_ADMIN", "SPONSOR", "STUDENT"];

test("UPLOAD_POLICY: batas ukuran & profil per jenis", () => {
  assert.equal(UPLOAD_POLICY.ATTENDANCE_SELFIE.maxInputBytes, 5 * MIB);
  assert.equal(UPLOAD_POLICY.LEAVE_ATTACHMENT.maxInputBytes, 8 * MIB);
  assert.equal(UPLOAD_POLICY.PAYMENT_PROOF.maxInputBytes, 8 * MIB);
  assert.equal(UPLOAD_POLICY.TOPUP_PROOF.maxInputBytes, 8 * MIB);
  assert.equal(UPLOAD_POLICY.AD_BANNER.maxInputBytes, 5 * MIB);
  assert.deepEqual(UPLOAD_POLICY.ATTENDANCE_SELFIE.profile, { type: "jpeg", quality: 70, maxSide: 640, minShortSide: 240 });
  assert.deepEqual(UPLOAD_POLICY.PAYMENT_PROOF.profile, { type: "jpeg", quality: 85, maxSide: 2000, minShortSide: 0 });
  assert.deepEqual(UPLOAD_POLICY.LEAVE_ATTACHMENT.profile, UPLOAD_POLICY.PAYMENT_PROOF.profile);
  assert.deepEqual(UPLOAD_POLICY.TOPUP_PROOF.profile, UPLOAD_POLICY.PAYMENT_PROOF.profile);
  const banner = UPLOAD_POLICY.AD_BANNER.profile;
  assert.equal(banner.type, "banner");
  if (banner.type === "banner") {
    assert.equal(banner.width, 1200);
    assert.equal(banner.height, 600);
    assert.equal(banner.quality, 82);
  }
  assert.equal(MAX_INPUT_PIXELS, 25_000_000);
  assert.ok(Object.isFrozen(UPLOAD_POLICY));
});

test("assertCanUpload: matriks peran × jenis", () => {
  const allowed: Record<UserRole, readonly FileKind[]> = {
    STUDENT: ["ATTENDANCE_SELFIE", "PAYMENT_PROOF", "LEAVE_ATTACHMENT"],
    SPONSOR: ["AD_BANNER", "TOPUP_PROOF"],
    SCHOOL_ADMIN: [],
    SUPER_ADMIN: [],
  };
  for (const role of ROLES) {
    for (const kind of KINDS) {
      if (allowed[role].includes(kind)) {
        assert.doesNotThrow(() => assertCanUpload(role, kind), `${role} ${kind}`);
      } else {
        assert.throws(
          () => assertCanUpload(role, kind),
          (err: unknown) => isAppError(err) && err.status === 403 && err.code === "FORBIDDEN",
          `${role} ${kind}`,
        );
      }
    }
  }
});

const ok = { format: "jpeg", width: 1200, height: 600, pages: 1 } as const;

test("checkBannerMeta: ukuran sah (1200×600, 800×400, 2000×1000)", () => {
  assert.equal(checkBannerMeta(ok), null);
  assert.equal(checkBannerMeta({ ...ok, width: 800, height: 400 }), null);
  assert.equal(checkBannerMeta({ ...ok, width: 2000, height: 1000, format: "webp" }), null);
  assert.equal(checkBannerMeta({ ...ok, format: "png", pages: undefined }), null);
});

test("checkBannerMeta: batas toleransi rasio ±2% inklusif (aritmetika bulat)", () => {
  assert.equal(checkBannerMeta({ ...ok, width: 1020, height: 500 }), null);
  assert.equal(checkBannerMeta({ ...ok, width: 980, height: 500 }), null);
  assert.equal(checkBannerMeta({ ...ok, width: 1021, height: 500 }), "ASPECT");
  assert.equal(checkBannerMeta({ ...ok, width: 979, height: 500 }), "ASPECT");
  assert.equal(checkBannerMeta({ ...ok, width: 1200, height: 612 }), null);
  assert.equal(checkBannerMeta({ ...ok, width: 1200, height: 613 }), "ASPECT");
  assert.equal(checkBannerMeta({ ...ok, width: 1200, height: 700 }), "ASPECT");
});

test("checkBannerMeta: alasan FORMAT, ANIMATED, TOO_SMALL, PIXELS", () => {
  assert.equal(checkBannerMeta({ ...ok, format: "gif" }), "FORMAT");
  assert.equal(checkBannerMeta({ ...ok, format: "svg" }), "FORMAT");
  assert.equal(checkBannerMeta({ ...ok, format: "heif" }), "FORMAT");
  assert.equal(checkBannerMeta({ ...ok, format: "webp", pages: 2 }), "ANIMATED");
  assert.equal(checkBannerMeta({ ...ok, width: 799, height: 400 }), "TOO_SMALL");
  assert.equal(checkBannerMeta({ ...ok, width: 800, height: 399 }), "TOO_SMALL");
  assert.equal(checkBannerMeta({ ...ok, width: 8000, height: 4000 }), "PIXELS");
});
