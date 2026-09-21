/** Hook boot Next.js; logika khusus Node dipisah agar build Edge tidak memuat modul Node. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertBootInvariants } = await import("./instrumentation-node");
    assertBootInvariants();
    // Daftarkan kick push sejak boot (bukan menunggu tick pertama): notify -> ctx.defer -> kirim setelah respons.
    await import("./lib/jobs/push-dispatch");
  }
}
