/**
 * Event `cancel` juga dikirim `<input type="file">` saat pemilih berkas ditutup tanpa perubahan (batal, atau berkas
 * yang sama dipilih lagi), dan event itu menggelembung ke `<dialog>`. Hanya `cancel` milik dialog sendiri (Esc) yang
 * boleh menutup dialog; tanpa penjaga ini membatalkan pemilih berkas ikut menutup formulir.
 */
export function isOwnDialogCancel(event: { readonly target: EventTarget | null; readonly currentTarget: EventTarget | null }): boolean {
  return event.target === event.currentTarget;
}
