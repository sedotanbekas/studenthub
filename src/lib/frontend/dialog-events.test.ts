import { test } from "node:test";
import assert from "node:assert/strict";
import { isOwnDialogCancel } from "./dialog-events";

test("hanya `cancel` milik dialog (Esc) yang menutup dialog; `cancel` pemilih berkas yang menggelembung diabaikan", () => {
  const dialog = { id: "dialog" } as unknown as EventTarget;
  const fileInput = { id: "input" } as unknown as EventTarget;
  assert.equal(isOwnDialogCancel({ target: dialog, currentTarget: dialog }), true);
  assert.equal(isOwnDialogCancel({ target: fileInput, currentTarget: dialog }), false);
});
