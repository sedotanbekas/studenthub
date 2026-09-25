import Link from "next/link";
import type { ComponentProps } from "react";

/**
 * Tautan di dalam hub dengan arah transisi halaman: membuka halaman = "nav-forward" (geser dari
 * kanan ke kiri); kembali ke beranda = "nav-back" (kiri ke kanan). Lihat page-transition.tsx.
 */
export function HubLink({ transitionTypes, ...props }: ComponentProps<typeof Link>) {
  const href = typeof props.href === "string" ? props.href : props.href.pathname ?? "";
  return <Link {...props} transitionTypes={transitionTypes ?? [href === "/hub" ? "nav-back" : "nav-forward"]} />;
}
