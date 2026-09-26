"use client";
import { useEffect, useRef, useState } from "react";

/** Lebar elemen (px) yang mengikuti perubahan ukuran; 0 sebelum diukur. */
export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => {
      const next = Math.floor(entries[0]?.contentRect.width ?? 0);
      setWidth(prev => (prev === next ? prev : next));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}
