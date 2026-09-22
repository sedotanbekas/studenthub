import type { CSSProperties } from "react";
const paths: Record<string, string> = {
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  check: "M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9 M9 11l4 4L22 4",
  book: "M12 5v16 M12 5C8 2 4 3 2 4v15c4-2 7-1 10 2 3-3 6-4 10-2V4c-2-1-6-2-10 1",
  report: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h8 M8 17h5",
  wallet: "M20 8V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h16v12H5a3 3 0 0 1-3-3V6 M21 13h-6v4h6",
  megaphone: "M3 10v4h4l12 5V5L7 10z M7 14l2 7h3l-2-6 M22 9v6",
  calendar: "M4 5h16v16H4z M16 3v4 M8 3v4 M4 11h16 M8 15h2 M14 15h2",
  settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 2h6l1 4 4 1 2 5-3 3v4l-5 3-3-2-4 1-4-4 1-4-2-3 3-5z",
  history: "M3 12a9 9 0 1 0 3-6 M3 3v5h5 M12 7v5l3 2",
  school: "M3 21V9l9-6 9 6v12 M1 21h22 M9 21v-7h6v7 M7 10h1 M16 10h1",
  heart: "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z",
  image: "M3 3h18v18H3z M3 17l6-6 4 4 3-3 5 5 M15 7h.01",
  chart: "M3 3v18h18 M7 16v-5 M12 16V7 M17 16v-9",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4",
  shield: "M12 2l9 4v6c0 6-9 10-9 10S3 18 3 12V6z M8 12l3 3 5-6",
  search: "M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  arrow: "M4 12h16 M14 6l6 6-6 6", chevron: "M9 5l7 7-7 7", down: "M6 9l6 6 6-6", plus: "M12 5v14 M5 12h14", close: "M6 6l12 12 M6 18L18 6",
  logout: "M9 3H3v18h6 M9 12h12 M16 7l5 5-5 5", menu: "M3 6h18 M3 12h18 M3 18h18", sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1 1 M18 18l1 1 M5 19l1-1 M18 6l1-1",
  download: "M12 3v12 M7 10l5 5 5-5 M4 15v6h16v-6", upload: "M12 16V4 M7 9l5-5 5 5 M4 16v5h16v-5", refresh: "M20 7a9 9 0 1 0 1 9 M20 2v6h-6", eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12 M15 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0", help: "M9 9a3 3 0 0 1 6 0c0 2-3 2-3 5 M12 18h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0", spark: "M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3z", leaf: "M20 3C6 1 1 10 6 16s15 2 14-13 M4 21L16 8", camera: "M3 7h4l2-4h6l2 4h4v14H3z M16 13a4 4 0 1 0-8 0 4 4 0 0 0 8 0", location: "M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0 M15 10a3 3 0 1 0-6 0 3 3 0 0 0 6 0",
};
export function Icon({ name, size = 20, style }: { name: string; size?: number; style?: CSSProperties }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" style={style}><path d={paths[name] ?? paths.report} /></svg>;
}
export function Brand() { return <span className="brand"><span className="brand-mark"><Icon name="book" size={23} /></span>student<span className="brand-light">hub</span><span className="brand-dot">.</span></span>; }
