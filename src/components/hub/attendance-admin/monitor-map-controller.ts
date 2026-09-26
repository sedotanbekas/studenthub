import type * as Leaflet from "leaflet";
import {
  SPIDER_MAX_RADIUS,
  clusterByPixel,
  clusterClickAction,
  clusterOf,
  escapeHtml,
  firstZoomAlone,
  pixelSpread,
  spiderfyLayout,
  type ClusterInput,
  type PixelCluster,
} from "@/lib/frontend/map-cluster-rules";
import { PIN_SIZE, SCHOOL_HTML, clusterHtml, clusterSize, clusterSummary, pinCard, pinHtml, pinLabel } from "./map-markup";
import type { MapPoint } from "./monitor-rules";

/**
 * Adaptor Leaflet peta kehadiran admin: pin per status, pengelompokan piksel yang dihitung ulang saat
 * zoom/geser (hanya kelompok di sekitar layar yang dirender), klik kelompok = perbesar atau sebar
 * (spiderfy) dengan animasi, dan fokus ke pin dari daftar. React hanya memegang instance ini.
 */

type LeafletModule = typeof Leaflet;
export interface SchoolArea { readonly latitude: number; readonly longitude: number; readonly radiusM: number }
export interface MapCallbacks { readonly onSelect: (id: string | null) => void; readonly onDetail: (id: string) => void }

export const MAX_ZOOM = 19;
const OSM_TILES = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
/** Kelompok di luar layar + 35% tepi tidak dirender (ribuan titik tetap ringan). */
const RENDER_PAD = 0.35;
const SPIDER_MS = 280;
const FIT_PADDING: [number, number] = [28, 28];
/** Lebar isi popup (px): 236 ideal, maks 300; di peta sempit = lebar peta − 72 (margin kartu 32 + sisi 20). */
const POPUP_WIDTH = 236;
const POPUP_MAX_WIDTH = 300;
const POPUP_MIN_WIDTH = 160;
const POPUP_SIDE_SPACE = 72;
/** Tinggi bingkai popup di luar isinya (margin kartu atas+bawah 30, ekor 20); isi yang lebih tinggi digulir. */
const POPUP_FRAME_HEIGHT = 50;
/** Peta lebih sempit dari ini (HP) -> padding geser otomatis popup dikecilkan agar kartu muat (lihat juga @container di monitor.css). */
const NARROW_MAP = 420;
/** Jari-jari sebaran mengikuti peta: setengah sisi terpendek − 24 px, antara 90 px dan SPIDER_MAX_RADIUS. */
const SPIDER_EDGE = 24;
const SPIDER_MIN_REACH = 90;

interface Rendered { readonly marker: Leaflet.Marker; readonly ids: readonly string[] }
interface Spider {
  readonly key: string;
  readonly center: Leaflet.LatLng;
  readonly clusterMarker: Leaflet.Marker;
  readonly markers: Map<string, Leaflet.Marker>;
  readonly legs: Leaflet.Polyline[];
  readonly positions: Map<string, Leaflet.LatLng>;
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/**
 * Leaflet 1.9 menjadwalkan akhir animasi zoom (setTimeout 250 ms) yang membaca posisi pane peta; setelah
 * remove() pane sudah tidak ada -> TypeError `_leaflet_pos`. Menandai animasi selesai membuat jadwal itu
 * berhenti di penjaganya sendiri (`if (!this._animatingZoom) return`) — tidak ada API publik untuk ini.
 */
function settleZoomAnimation(map: Leaflet.Map): void {
  const internal = map as unknown as { _animatingZoom?: boolean };
  if (internal._animatingZoom) internal._animatingZoom = false;
}

/** Ukuran popup dari ukuran peta saat dibuka: di peta sempit kartu tidak pernah lebih lebar/tinggi dari peta. */
function popupFit(size: Leaflet.Point): Partial<Leaflet.PopupOptions> {
  const room = size.x - POPUP_SIDE_SPACE;
  const width = Math.max(POPUP_MIN_WIDTH, Math.min(POPUP_WIDTH, room));
  const pad = size.x < NARROW_MAP ? 8 : 24;
  return { minWidth: width, maxWidth: Math.max(width, Math.min(POPUP_MAX_WIDTH, room)), maxHeight: Math.max(160, size.y - POPUP_FRAME_HEIGHT - 2 * pad), autoPanPadding: [pad, pad] };
}

export class MonitorMapController {
  private readonly map: Leaflet.Map;
  private readonly base: Leaflet.LayerGroup;
  private readonly spiderLayer: Leaflet.LayerGroup;
  private readonly popup: Leaflet.Popup;
  private points: readonly MapPoint[] = [];
  private byId = new Map<string, MapPoint>();
  private clusters: PixelCluster[] = [];
  private readonly rendered = new Map<string, Rendered>();
  private readonly pins = new Map<string, Leaflet.Marker>();
  private spider: Spider | null = null;
  private selectedId: string | null = null;
  private fitted = false;
  private animation = 0;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  /** Listener peta milik adaptor ini; dilepas sebelum peta dibongkar. */
  private readonly events: Leaflet.LeafletEventHandlerFnMap = {
    zoomstart: () => this.collapse(false),
    moveend: () => this.render(),
    click: () => this.collapse(true),
    popupclose: event => { if (event.popup === this.popup) this.select(null); },
  };

  constructor(private readonly L: LeafletModule, container: HTMLElement, private readonly school: SchoolArea, private readonly callbacks: MapCallbacks) {
    const still = reducedMotion();
    this.map = L.map(container, { maxZoom: MAX_ZOOM, zoomAnimation: !still, fadeAnimation: !still, markerZoomAnimation: !still });
    L.tileLayer(OSM_TILES, { maxZoom: MAX_ZOOM, attribution: OSM_ATTRIBUTION }).addTo(this.map);
    const center = L.latLng(school.latitude, school.longitude);
    L.circle(center, { radius: school.radiusM, className: "monitor-geofence", interactive: false }).addTo(this.map);
    L.marker(center, { icon: L.divIcon({ className: "att-school-icon", html: SCHOOL_HTML, iconSize: [34, 34] }), keyboard: false, zIndexOffset: -500 })
      .bindTooltip("Sekolah", { direction: "top", offset: [0, -16], className: "att-tooltip" })
      .addTo(this.map);
    this.base = L.layerGroup().addTo(this.map);
    this.spiderLayer = L.layerGroup().addTo(this.map);
    this.popup = L.popup({ className: "monitor-popup", maxWidth: POPUP_MAX_WIDTH, minWidth: POPUP_WIDTH, offset: [0, -10], autoPanPadding: [24, 24] });
    this.fitAll(false);
    this.map.on(this.events);
  }

  /** Ganti data (filter berubah): sebaran ditutup, popup ditutup bila pinnya hilang, render ulang. */
  setPoints(points: readonly MapPoint[]): void {
    this.points = points;
    this.byId = new Map(points.map(p => [p.attendanceId, p]));
    this.collapse(false);
    if (this.selectedId && !this.byId.has(this.selectedId)) this.map.closePopup(this.popup);
    this.base.clearLayers();
    this.rendered.clear();
    this.pins.clear();
    if (!this.fitted && points.length) {
      this.fitted = true;
      this.fitAll(false);
    }
    this.render();
  }

  /** Tampilkan area sekolah + semua titik. */
  fitAll(animate = true): void {
    const bounds = this.L.latLng(this.school.latitude, this.school.longitude).toBounds(this.school.radiusM * 2);
    for (const p of this.points) bounds.extend([p.latitude, p.longitude]);
    this.map.fitBounds(bounds, { padding: FIT_PADDING, maxZoom: 18, animate: animate && !reducedMotion() });
  }

  /** Fokus dari daftar: perbesar sampai pin terlihat sendiri, atau sebar kelompoknya; lalu buka popup. */
  focus(id: string): void {
    const point = this.byId.get(id);
    if (!point) return;
    const spidered = this.spider?.positions.get(id);
    if (spidered) {
      this.openPin(id, spidered);
      return;
    }
    this.collapse(false);
    const latlng = this.L.latLng(point.latitude, point.longitude);
    const alone = firstZoomAlone(id, this.map.getZoom(), MAX_ZOOM, zoom => this.project(zoom));
    if (alone !== null) this.moveThen(latlng, alone, () => this.openPin(id, latlng));
    else this.moveThen(latlng, MAX_ZOOM, () => this.spiderfyFor(id, latlng));
  }

  resize(): void {
    this.map.invalidateSize();
  }

  /**
   * Bongkar peta dengan aman meski animasi sedang berjalan: timer & sebaran dihentikan, listener
   * dilepas, animasi geser/terbang dihentikan, dan animasi zoom ditandai selesai sebelum remove().
   */
  destroy(): void {
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    this.spider = null;
    this.map.off(this.events);
    this.map.stop();
    settleZoomAnimation(this.map);
    this.map.remove();
  }

  // ------------------------------------------------------------------ render kelompok

  private project(zoom: number): ClusterInput[] {
    return this.points.map(p => {
      const pt = this.map.project([p.latitude, p.longitude], zoom);
      return { id: p.attendanceId, x: pt.x, y: pt.y };
    });
  }

  private render(): void {
    const zoom = this.map.getZoom();
    this.clusters = clusterByPixel(this.project(zoom));
    const view = this.map.getPixelBounds().pad(RENDER_PAD);
    const wanted = new Map<string, PixelCluster>();
    for (const c of this.clusters) if (view.contains([c.x, c.y])) wanted.set(`${zoom}|${c.key}`, c);
    for (const [key, entry] of this.rendered) {
      if (wanted.has(key)) continue;
      this.base.removeLayer(entry.marker);
      if (entry.ids.length === 1) this.pins.delete(entry.ids[0]!);
      this.rendered.delete(key);
    }
    for (const [key, cluster] of wanted) if (!this.rendered.has(key)) this.rendered.set(key, { marker: this.addCluster(cluster, zoom), ids: cluster.ids });
  }

  private addCluster(cluster: PixelCluster, zoom: number): Leaflet.Marker {
    if (cluster.ids.length === 1) {
      const point = this.byId.get(cluster.ids[0]!)!;
      const marker = this.pinMarker(point, this.L.latLng(point.latitude, point.longitude), false).addTo(this.base);
      this.pins.set(point.attendanceId, marker);
      return marker;
    }
    return this.clusterMarker(cluster, this.map.unproject([cluster.x, cluster.y], zoom)).addTo(this.base);
  }

  private pinMarker(point: MapPoint, latlng: Leaflet.LatLng, spider: boolean): Leaflet.Marker {
    const classes = ["att-pin-icon", spider ? "spider-pin" : "", point.attendanceId === this.selectedId ? "is-selected" : ""].filter(Boolean).join(" ");
    const icon = this.L.divIcon({ className: classes, html: pinHtml(point, this.school.radiusM), iconSize: [PIN_SIZE, PIN_SIZE] });
    const marker = this.L.marker(latlng, { icon, keyboard: true, riseOnHover: true, zIndexOffset: spider ? 1000 : 0 });
    marker.bindTooltip(escapeHtml(point.name), { direction: "top", offset: [0, -PIN_SIZE / 2], className: "att-tooltip" });
    marker.on("add", () => marker.getElement()?.setAttribute("aria-label", pinLabel(point, this.school.radiusM)));
    marker.on("click", () => this.openPin(point.attendanceId, marker.getLatLng()));
    return marker;
  }

  private clusterMarker(cluster: PixelCluster, latlng: Leaflet.LatLng): Leaflet.Marker {
    const statuses = cluster.ids.map(id => this.byId.get(id)!.status);
    const size = clusterSize(statuses.length);
    const icon = this.L.divIcon({ className: "att-cluster-icon", html: clusterHtml(statuses), iconSize: [size, size] });
    const marker = this.L.marker(latlng, { icon, keyboard: true, riseOnHover: true, zIndexOffset: 500 });
    marker.bindTooltip(clusterSummary(statuses), { direction: "top", offset: [0, -size / 2], className: "att-tooltip cluster-tip" });
    marker.on("add", () => {
      const element = marker.getElement();
      element?.setAttribute("aria-label", `${statuses.length} siswa`);
      element?.setAttribute("aria-expanded", "false");
    });
    marker.on("click", () => this.onClusterClick(cluster, marker));
    return marker;
  }

  // ------------------------------------------------------------------ klik kelompok & sebaran

  private onClusterClick(cluster: PixelCluster, marker: Leaflet.Marker): void {
    if (this.spider?.key === cluster.key) {
      this.collapse(true);
      return;
    }
    this.collapse(false);
    const members = cluster.ids.map(id => this.byId.get(id)!);
    const spread = pixelSpread(members.map(p => this.map.project([p.latitude, p.longitude], MAX_ZOOM)));
    const action = clusterClickAction({ spreadAtMaxZoomPx: spread, zoom: this.map.getZoom(), maxZoom: MAX_ZOOM });
    if (action === "spiderfy") this.spiderfy(cluster, marker);
    else this.zoomInto(members);
  }

  private zoomInto(members: readonly MapPoint[]): void {
    const bounds = this.L.latLngBounds(members.map(p => [p.latitude, p.longitude] as [number, number]));
    const zoom = this.map.getZoom();
    const fit = this.map.getBoundsZoom(bounds, false, this.L.point(112, 112));
    const target = Math.min(MAX_ZOOM, Math.max(zoom + 1, fit));
    this.map.flyTo(bounds.getCenter(), target, { animate: !reducedMotion(), duration: 0.6 });
  }

  private spiderfy(cluster: PixelCluster, clusterMarker: Leaflet.Marker): void {
    const center = clusterMarker.getLatLng();
    const origin = this.map.latLngToLayerPoint(center);
    const size = this.map.getSize();
    const reach = Math.max(SPIDER_MIN_REACH, Math.min(SPIDER_MAX_RADIUS, Math.min(size.x, size.y) / 2 - SPIDER_EDGE));
    const offsets = spiderfyLayout(cluster.ids.length, { maxRadius: reach });
    const animate = !reducedMotion();
    const spider: Spider = { key: cluster.key, center, clusterMarker, markers: new Map(), legs: [], positions: new Map() };
    cluster.ids.forEach((id, i) => {
      const target = this.map.layerPointToLatLng(origin.add([offsets[i]?.x ?? 0, offsets[i]?.y ?? 0]));
      spider.positions.set(id, target);
      spider.legs.push(this.L.polyline([center, target], { className: "spider-leg", interactive: false, weight: 1.5 }).addTo(this.spiderLayer));
      spider.markers.set(id, this.pinMarker(this.byId.get(id)!, animate ? center : target, true).addTo(this.spiderLayer));
    });
    this.markExpanded(clusterMarker, true);
    clusterMarker.closeTooltip();
    this.spider = spider;
    if (!animate) return;
    const token = this.startAnimation();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (this.spider !== spider) return;
      spider.markers.forEach((marker, id) => marker.setLatLng(spider.positions.get(id)!));
      this.later(() => this.endAnimation(token), SPIDER_MS + 60);
    }));
  }

  /** Tutup sebaran (klik latar/kelompok lain/zoom/ganti data); `animate` = pin kembali menguncup. */
  private collapse(animate: boolean): void {
    const spider = this.spider;
    if (!spider) return;
    this.spider = null;
    this.markExpanded(spider.clusterMarker, false);
    if (this.selectedId && spider.markers.has(this.selectedId)) this.map.closePopup(this.popup);
    spider.legs.forEach(leg => this.spiderLayer.removeLayer(leg));
    const remove = () => spider.markers.forEach(marker => this.spiderLayer.removeLayer(marker));
    if (!animate || reducedMotion()) {
      remove();
      return;
    }
    const token = this.startAnimation();
    spider.markers.forEach(marker => {
      marker.getElement()?.classList.add("is-leaving");
      marker.setLatLng(spider.center);
    });
    this.later(() => {
      remove();
      this.endAnimation(token);
    }, SPIDER_MS);
  }

  private spiderfyFor(id: string, latlng: Leaflet.LatLng): void {
    const cluster = clusterOf(this.clusters, id);
    const entry = cluster && this.rendered.get(`${this.map.getZoom()}|${cluster.key}`);
    if (!cluster || cluster.ids.length === 1 || !entry) {
      this.openPin(id, latlng);
      return;
    }
    this.spiderfy(cluster, entry.marker);
    this.openPin(id, this.spider?.positions.get(id) ?? latlng);
  }

  /** Tandai kelompok yang tersebar; penanda lain diredupkan lewat `.has-spider` pada kontainer peta. */
  private markExpanded(marker: Leaflet.Marker, expanded: boolean): void {
    this.map.getContainer().classList.toggle("has-spider", expanded);
    const element = marker.getElement();
    element?.classList.toggle("is-spidered", expanded);
    element?.setAttribute("aria-expanded", String(expanded));
  }

  // ------------------------------------------------------------------ popup & sorotan

  private openPin(id: string, latlng: Leaflet.LatLng): void {
    const point = this.byId.get(id);
    if (!point) return;
    this.L.setOptions(this.popup, popupFit(this.map.getSize()));
    this.popup.setLatLng(latlng).setContent(pinCard(point, this.school.radiusM, () => this.callbacks.onDetail(id)));
    this.map.openPopup(this.popup);
    this.select(id);
  }

  private select(id: string | null): void {
    if (this.selectedId) this.markerFor(this.selectedId)?.getElement()?.classList.remove("is-selected");
    this.selectedId = id;
    if (id) this.markerFor(id)?.getElement()?.classList.add("is-selected");
    this.callbacks.onSelect(id);
  }

  private markerFor(id: string): Leaflet.Marker | undefined {
    return this.spider?.markers.get(id) ?? this.pins.get(id);
  }

  // ------------------------------------------------------------------ utilitas

  /** Pindah ke titik lalu jalankan `then` setelah peta berhenti (langsung bila sudah terlihat). */
  private moveThen(latlng: Leaflet.LatLng, zoom: number, then: () => void): void {
    if (this.map.getZoom() === zoom && this.map.getBounds().pad(-0.15).contains(latlng)) {
      then();
      return;
    }
    this.map.once("moveend", then);
    this.map.setView(latlng, zoom, { animate: !reducedMotion() });
  }

  private startAnimation(): number {
    this.animation += 1;
    this.map.getContainer().classList.add("is-spider-anim");
    return this.animation;
  }

  private endAnimation(token: number): void {
    if (token === this.animation) this.map.getContainer().classList.remove("is-spider-anim");
  }

  private later(run: () => void, ms: number): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      run();
    }, ms);
    this.timers.add(timer);
  }
}
