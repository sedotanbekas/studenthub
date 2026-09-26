"use client";
import { useEffect, useRef, type RefObject } from "react";

/**
 * Dialog modal peninjauan (sheet detail & dialog keputusan): dibuka saat dipasang; saat dilepas
 * ditutup dan fokus dikembalikan ke pembukanya. Bila pembuka sudah hilang atau nonaktif (item baru
 * diputuskan, tombol menunggu data terbaru), fokus jatuh ke tombol antrean item itu, item terpilih,
 * item pertama, lalu panel antrean — tidak pernah ke <body>.
 */

function focusFirst(candidates: readonly (HTMLElement | null | undefined)[]): void {
  for (const element of candidates) {
    if (!element || !element.isConnected) continue;
    element.focus();
    if (document.activeElement === element) return;
  }
}

function restoreFocus(opener: HTMLElement | null, itemId: string | null): void {
  const buttons = Array.from(document.querySelectorAll<HTMLElement>(".review-queue .review-item"));
  focusFirst([
    opener && opener !== document.body ? opener : null,
    itemId === null ? null : buttons.find(button => button.dataset.reviewId === itemId),
    buttons.find(button => button.getAttribute("aria-current") === "true"),
    buttons[0],
    document.querySelector<HTMLElement>(".review-list-panel"),
  ]);
}

/** `itemId` = item yang sedang ditampilkan dialog (boleh berubah selama terbuka). */
export function useModalDialog(dialog: RefObject<HTMLDialogElement | null>, itemId: string | null = null): void {
  const lastItem = useRef(itemId);
  useEffect(() => { lastItem.current = itemId; }, [itemId]);
  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const item = lastItem;
    element?.showModal();
    return () => {
      if (element?.open) element.close();
      restoreFocus(opener, item.current);
    };
  }, [dialog]);
}
