"use client";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import type { Circle, CircleMarker, Map as LeafletMap } from "leaflet";

/**
 * Peta pemilih titik sekolah (Leaflet + OpenStreetMap, tanpa API key): klik peta untuk menaruh titik; lingkaran
 * menunjukkan area absen (radius). Menggantikan isian lintang/bujur mentah di formulir pendaftaran sekolah.
 */
export interface PickedPoint { readonly latitude: number; readonly longitude: number }

const COLOR = "#1d4ed8";
const OSM_TILES = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
/** Tengah Indonesia saat titik belum dipilih. */
const INDONESIA: [number, number] = [-2.5, 118];
/** Zoom kota: cukup dekat untuk mengenali kecamatan, lalu pengguna memperbesar ke gedung sekolah. */
const FOCUS_ZOOM = 11;

interface Layers { map: LeafletMap; point: CircleMarker; area: Circle }

interface Props {
  readonly point: PickedPoint | null;
  readonly radiusM: number;
  /** Titik tengah wilayah terpilih (mis. ibu kota provinsi): peta melompat ke sini saat berganti. */
  readonly focus?: PickedPoint | null;
  readonly onPick: (point: PickedPoint) => void;
}

export function LocationPicker({ point, radiusM, focus = null, onPick }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const layers = useRef<Layers | null>(null);
  const pickRef = useRef(onPick);
  const initial = useRef({ point, focus, radiusM });
  useEffect(() => { pickRef.current = onPick; }, [onPick]);

  useEffect(() => {
    let cancelled = false;
    void import("leaflet").then((L) => {
      if (cancelled || !container.current) return;
      const { point: start, focus: region, radiusM: startRadius } = initial.current;
      const view: [number, number] = start ? [start.latitude, start.longitude] : region ? [region.latitude, region.longitude] : INDONESIA;
      const map = L.map(container.current).setView(view, start ? 17 : region ? FOCUS_ZOOM : 5);
      L.tileLayer(OSM_TILES, { maxZoom: 19, attribution: OSM_ATTRIBUTION }).addTo(map);
      const at: [number, number] = start ? [start.latitude, start.longitude] : INDONESIA;
      const area = L.circle(at, { radius: start ? startRadius : 0, color: COLOR, weight: 2, fillColor: COLOR, fillOpacity: 0.12, opacity: start ? 1 : 0 }).addTo(map);
      const marker = L.circleMarker(at, { radius: 8, color: "#fff", weight: 3, fillColor: COLOR, fillOpacity: start ? 1 : 0, opacity: start ? 1 : 0 }).addTo(map);
      map.on("click", (event) => pickRef.current({ latitude: Number(event.latlng.lat.toFixed(7)), longitude: Number(event.latlng.lng.toFixed(7)) }));
      layers.current = { map, point: marker, area };
    });
    return () => { cancelled = true; layers.current?.map.remove(); layers.current = null; };
  }, []);

  useEffect(() => {
    const current = layers.current;
    if (!current || !point) return;
    const at: [number, number] = [point.latitude, point.longitude];
    current.point.setLatLng(at).setStyle({ opacity: 1, fillOpacity: 1 });
    current.area.setLatLng(at).setRadius(radiusM).setStyle({ opacity: 1, fillOpacity: 0.12 });
    if (current.map.getZoom() < 15) current.map.setView(at, 17);
  }, [point, radiusM]);

  const focusLat = focus?.latitude ?? null;
  const focusLng = focus?.longitude ?? null;
  useEffect(() => {
    if (focusLat === null || focusLng === null) return;
    layers.current?.map.setView([focusLat, focusLng], FOCUS_ZOOM);
  }, [focusLat, focusLng]);

  return <figure className="attendance-map location-picker">
    <div ref={container} className="map-canvas" role="application" aria-label="Peta lokasi sekolah. Klik untuk menaruh titik sekolah." />
    <figcaption>{point ? `Titik: ${point.latitude}, ${point.longitude} · area absen ${radiusM} m` : "Perbesar peta lalu klik tepat di gedung sekolah."}</figcaption>
  </figure>;
}
