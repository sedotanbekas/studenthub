"use client";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import type { Circle, CircleMarker, Map as LeafletMap } from "leaflet";

/**
 * Peta absensi (Leaflet + OpenStreetMap, tanpa API key): lingkaran area sekolah, titik sekolah, titik
 * siswa, dan lingkaran akurasi GPS. Leaflet dimuat dinamis karena menyentuh `window` saat diimpor.
 */
export interface SchoolArea { readonly latitude: number; readonly longitude: number; readonly radiusM: number }
export interface LivePoint { readonly latitude: number; readonly longitude: number; readonly accuracy: number }

const SCHOOL_COLOR = "#1d4ed8";
const STUDENT_COLOR = "#c2410c";
const OSM_TILES = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

interface Layers { map: LeafletMap; student: CircleMarker; accuracy: Circle; fitted: boolean }

export function AttendanceMap({ school, position, inside }: { school: SchoolArea; position: LivePoint | null; inside: boolean | null }) {
  const container = useRef<HTMLDivElement>(null);
  const layers = useRef<Layers | null>(null);
  const latest = useRef(position);
  useEffect(() => { latest.current = position; }, [position]);

  useEffect(() => {
    let cancelled = false;
    void import("leaflet").then(L => {
      if (cancelled || !container.current) return;
      const center: [number, number] = [school.latitude, school.longitude];
      const map = L.map(container.current, { zoomControl: true, attributionControl: true }).setView(center, 17);
      L.tileLayer(OSM_TILES, { maxZoom: 19, attribution: OSM_ATTRIBUTION }).addTo(map);
      L.circle(center, { radius: school.radiusM, color: SCHOOL_COLOR, weight: 2, fillColor: SCHOOL_COLOR, fillOpacity: 0.12 }).addTo(map);
      L.circleMarker(center, { radius: 7, color: "#fff", weight: 3, fillColor: SCHOOL_COLOR, fillOpacity: 1 }).bindTooltip("Sekolah", { permanent: true, direction: "top", offset: [0, -8] }).addTo(map);
      const student = L.circleMarker(center, { radius: 8, color: "#fff", weight: 3, fillColor: STUDENT_COLOR, fillOpacity: 1, opacity: 0 }).addTo(map);
      const accuracy = L.circle(center, { radius: 0, color: STUDENT_COLOR, weight: 1, fillColor: STUDENT_COLOR, fillOpacity: 0.1, opacity: 0 }).addTo(map);
      layers.current = { map, student, accuracy, fitted: false };
      if (latest.current) place(layers.current, latest.current, school);
    });
    return () => { cancelled = true; layers.current?.map.remove(); layers.current = null; };
  }, [school]);

  useEffect(() => { if (layers.current && position) place(layers.current, position, school); }, [position, school]);

  const status = inside === null ? "Mencari posisimu…" : inside ? "Kamu berada di area sekolah" : "Kamu berada di luar area sekolah";
  return <figure className="attendance-map"><div ref={container} className="map-canvas" role="img" aria-label={`Peta area sekolah. ${status}.`} /><figcaption><span><i className="legend school" />Area sekolah</span><span><i className="legend student" />Posisimu</span></figcaption></figure>;
}

function place(target: Layers, point: LivePoint, school: SchoolArea) {
  const at: [number, number] = [point.latitude, point.longitude];
  target.student.setLatLng(at).setStyle({ opacity: 1, fillOpacity: 1 });
  target.accuracy.setLatLng(at).setRadius(point.accuracy).setStyle({ opacity: 0.6, fillOpacity: 0.1 });
  if (target.fitted) return;
  target.fitted = true;
  target.map.fitBounds([at, [school.latitude, school.longitude]], { padding: [48, 48], maxZoom: 18 });
}
