import { initials } from "@/lib/frontend/format";
import { STATUS_META, flagLabels, formatAccuracy, formatDistance, isOutsideRadius, ringGradient, statusClass, type MapPoint, type MonitorStatus } from "./monitor-rules";

/**
 * Markup ikon Leaflet (L.divIcon memakai innerHTML -> semua teks dari data di-escape) dan kartu
 * popup pin (dibangun dengan DOM + textContent, tanpa innerHTML).
 */

export const PIN_SIZE = 32;

export function pinHtml(point: MapPoint, radiusM: number): string {
  const outside = isOutsideRadius(point, radiusM) ? " is-outside" : "";
  const flag = point.hasAnomaly ? '<i class="att-pin-flag">!</i>' : "";
  return `<span class="att-pin ${statusClass(point.status)}${outside}" aria-hidden="true"><b>${STATUS_META[point.status].letter}</b>${flag}</span>`;
}

/** Nama aksesibel pin (elemen role=button milik Leaflet). */
export function pinLabel(point: MapPoint, radiusM: number): string {
  const parts = [point.name, STATUS_META[point.status].label];
  if (point.checkInTimeLocal) parts.push(`masuk ${point.checkInTimeLocal}`);
  if (isOutsideRadius(point, radiusM)) parts.push("di luar radius");
  if (point.hasAnomaly) parts.push("perlu ditinjau");
  return parts.join(", ");
}

export const clusterSize = (count: number): number => (count < 10 ? 40 : count < 50 ? 46 : 54);

export function clusterHtml(statuses: readonly MonitorStatus[]): string {
  return `<span class="att-cluster" style="--ring:${ringGradient(statuses)}" aria-hidden="true"><b>${statuses.length}</b></span>`;
}

/** "20 hadir · 6 terlambat" — urutan status kanonik, status kosong dilewati. */
export function clusterSummary(statuses: readonly MonitorStatus[]): string {
  const order = Object.keys(STATUS_META) as MonitorStatus[];
  return order
    .map(s => [s, statuses.filter(v => v === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${STATUS_META[s].label.toLowerCase()}`)
    .join(" · ");
}

export const SCHOOL_HTML =
  '<span class="att-school" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21V9l9-6 9 6v12 M1 21h22 M9 21v-7h6v7"/></svg></span>';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function pillElement(status: MonitorStatus): HTMLElement {
  const pill = el("span", `att-pill ${statusClass(status)}`);
  pill.append(el("i"), document.createTextNode(STATUS_META[status].label));
  return pill;
}

function cardHead(point: MapPoint): HTMLElement {
  const head = el("div", "pin-card-head");
  const text = el("div");
  text.append(el("strong", "", point.name), el("small", "", [point.className ?? "Tanpa kelas", `NIS ${point.nis}`].join(" · ")));
  head.append(el("span", `att-avatar ${statusClass(point.status)}`, initials(point.name)), text);
  return head;
}

function fact(label: string, value: string, tone = ""): HTMLElement {
  const row = el("div", tone);
  row.append(el("dt", "", label), el("dd", "", value));
  return row;
}

function cardFacts(point: MapPoint, radiusM: number): HTMLElement {
  const facts = el("dl", "pin-card-facts");
  const outside = isOutsideRadius(point, radiusM);
  facts.append(
    fact("Jam masuk", point.checkInTimeLocal ?? "—"),
    fact("Jarak ke sekolah", `${formatDistance(point.distanceM)}${outside ? " · di luar radius" : ""}`, outside ? "is-warning" : ""),
    fact("Akurasi GPS", formatAccuracy(point.accuracyM)),
  );
  return facts;
}

function flagList(point: MapPoint): HTMLElement {
  const list = el("ul", `pin-card-flags${point.hasAnomaly ? " is-anomaly" : ""}`);
  list.setAttribute("aria-label", "Catatan pemeriksaan");
  for (const text of flagLabels(point.flags)) list.append(el("li", "", text));
  return list;
}

/** Kartu ringkas di popup pin: identitas, status, jam, jarak, akurasi, anomali, tombol detail. */
export function pinCard(point: MapPoint, radiusM: number, onDetail: () => void): HTMLElement {
  const card = el("div", "pin-card");
  card.append(cardHead(point), pillElement(point.status), cardFacts(point, radiusM));
  if (point.flags.length) card.append(flagList(point));
  const button = el("button", "button primary small-button pin-card-detail", "Lihat detail");
  button.type = "button";
  button.addEventListener("click", onDetail);
  card.append(button);
  return card;
}
