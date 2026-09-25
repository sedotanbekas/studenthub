"use client";
import Link from "next/link";
import type { ComponentProps } from "react";
import { isPlainClick, linkDirection } from "@/lib/frontend/page-slide-rules";
import { isSamePage } from "@/lib/frontend/scroll-memory-rules";
import { captureTabSwitch, capturePage } from "./page-slide";
import { scrollPageToTop } from "./scroll-memory";

type HubLinkProps = ComponentProps<typeof Link> & {
  /** Navigasi utama (bottom nav / laci Menu): geser bersebelahan searah posisi tab, bukan masuk ala iOS. */
  tab?: boolean;
};

/**
 * Tautan di dalam hub dengan transisi halaman (lihat page-slide.ts). Tautan `tab` = pindah antarhalaman
 * utama, arahnya mengikuti posisi tab tujuan. Tautan lain = halaman di dalam halaman utama: membuka
 * halaman = geser dari kanan ke kiri; ke beranda = kembali (kiri ke kanan). Posisi gulir diatur
 * scroll-memory.ts (Next tidak menggulir ke atas: scroll={false}); tautan ke halaman yang sedang dibuka
 * tidak beranimasi, melainkan menggulir halaman ke atas (mis. tab aktif ditekan lagi).
 */
export function HubLink({ onClick, tab = false, ...props }: HubLinkProps) {
  const href = typeof props.href === "string" ? props.href : props.href.pathname ?? "";
  return <Link scroll={false} {...props} onClick={event => {
    onClick?.(event);
    if (!isPlainClick(event)) return;
    if (isSamePage(href, window.location.pathname)) scrollPageToTop();
    else if (tab) captureTabSwitch(href);
    else capturePage(linkDirection(href));
  }} />;
}
