"use client";
import Link from "next/link";
import type { ComponentProps } from "react";
import { isPlainClick, linkDirection } from "@/lib/frontend/page-slide-rules";
import { capturePage } from "./page-slide";

/**
 * Tautan di dalam hub dengan arah transisi halaman (lihat page-slide.ts): membuka halaman = geser dari
 * kanan ke kiri; ke beranda = kembali (kiri ke kanan). Tautan ke halaman yang sedang dibuka tidak
 * beranimasi.
 */
export function HubLink({ onClick, ...props }: ComponentProps<typeof Link>) {
  const href = typeof props.href === "string" ? props.href : props.href.pathname ?? "";
  return <Link {...props} onClick={event => {
    onClick?.(event);
    if (isPlainClick(event) && href.split(/[?#]/)[0] !== window.location.pathname) capturePage(linkDirection(href));
  }} />;
}
