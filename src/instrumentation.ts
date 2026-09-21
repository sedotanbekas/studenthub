/** Hook boot Next.js; logika khusus Node dipisah agar build Edge tidak memuat modul Node. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertBootInvariants } = await import("./instrumentation-node");
    assertBootInvariants();
  }
}
