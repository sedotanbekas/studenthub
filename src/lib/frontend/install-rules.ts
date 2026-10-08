import type { DeviceInfo } from "./web-push-rules";

/**
 * Aturan murni pemasangan PWA (keputusan pemilik 2026-10-08: PWA saja, tanpa APK/toko aplikasi). Android/komputer
 * Chromium memasang lewat tawaran browser (beforeinstallprompt); iPhone/iPad tidak punya tawaran itu, jadi pengguna
 * dipandu lewat Bagikan -> Tambah ke Layar Utama. Browser di dalam aplikasi lain (Instagram, Facebook, WebView)
 * tidak bisa memasang sama sekali -> buka di browser dulu.
 */

export type InstallMode =
  | "installed"
  | "prompt"
  | "ios-safari"
  | "ios-browser"
  | "ios-in-app"
  | "android-in-app"
  | "android-menu"
  | "desktop";

export interface InstallEnv {
  readonly ua: string;
  readonly device: DeviceInfo;
  /** Browser sudah menawarkan pasang (beforeinstallprompt ditahan). */
  readonly canPrompt: boolean;
  /** appinstalled / pasang diterima di halaman ini. */
  readonly installed: boolean;
}

/**
 * Penanda UA browser bawaan aplikasi lain (WebView Android = "; wv)"). Di iPhone, WebView aplikasi lain juga tidak
 * membawa token "Safari/" (Safari, Chrome/Edge/Firefox iOS selalu membawanya); Safari View tidak bisa dibedakan.
 */
const IN_APP_UA = /FBAN|FBAV|FB_IAB|Instagram|\bLine\/|musical_ly|BytedanceWebview|TikTok|Twitter|LinkedInApp|Snapchat|MicroMessenger|KAKAOTALK|Pinterest|\bGSA\/|; wv\)/;
const SAFARI_TOKEN = /Safari\//;
/** Browser iPhone selain Safari (semuanya WebKit; Tambah ke Layar Utama tersedia di menu Bagikan sejak iOS 16.4). */
const IOS_OTHER_BROWSER_UA = /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|DuckDuckGo|YaBrowser/;

export function installModeOf(env: InstallEnv): InstallMode {
  const { ua, device } = env;
  if (device.standalone || env.installed) return "installed";
  if (env.canPrompt) return "prompt";
  if (IN_APP_UA.test(ua) || (device.ios && !SAFARI_TOKEN.test(ua))) {
    if (device.ios) return "ios-in-app";
    if (device.android) return "android-in-app";
  }
  if (device.ios) return IOS_OTHER_BROWSER_UA.test(ua) ? "ios-browser" : "ios-safari";
  return device.android ? "android-menu" : "desktop";
}

const STEPS: Readonly<Record<InstallMode, readonly string[]>> = {
  installed: [],
  prompt: [],
  desktop: [],
  "ios-safari": [
    "Ketuk tombol Bagikan (kotak dengan panah ke atas). Di iOS 26, ketuk ••• di samping alamat situs dulu.",
    "Gulir ke bawah, lalu pilih Tambah ke Layar Utama.",
    "Ketuk Tambah, lalu buka aplikasi dari ikon barunya dan masuk sekali lagi.",
  ],
  "ios-browser": [
    "Ketuk tombol Bagikan (kotak dengan panah ke atas) di bilah alamat atau di menu browser.",
    "Pilih Tambah ke Layar Utama, lalu Tambah.",
    "Pilihan itu tidak ada? Buka halaman ini di Safari, lalu ikuti langkah yang sama.",
  ],
  "ios-in-app": [
    "Halaman ini terbuka di dalam aplikasi lain, jadi belum bisa dipasang dari sini.",
    "Ketuk ••• atau ikon kompas, lalu pilih Buka di Safari.",
    "Di Safari, ketuk Bagikan lalu Tambah ke Layar Utama.",
  ],
  "android-in-app": [
    "Halaman ini terbuka di dalam aplikasi lain, jadi belum bisa dipasang dari sini.",
    "Ketuk ⋮ di pojok kanan atas, lalu pilih Buka di Chrome (atau Buka di browser).",
    "Di Chrome, buka lagi halaman ini lalu ketuk Pasang.",
  ],
  "android-menu": [
    "Buka halaman ini di Chrome. Dari WhatsApp: ketuk ⋮ lalu Buka di Chrome.",
    "Ketuk menu ⋮ di pojok kanan atas.",
    "Pilih Instal aplikasi atau Tambahkan ke layar utama, lalu ikuti petunjuknya.",
  ],
};

const NO_STORE = "tanpa Play Store dan tanpa mengunduh berkas APK";
const IOS_INTRO = "Di iPhone dan iPad, aplikasi dipasang lewat menu Bagikan — tanpa App Store. Notifikasi juga hanya aktif bila aplikasi dibuka dari ikon di layar utama.";
const IN_APP_INTRO = "Pemasangan hanya bisa dari browser HP: Safari di iPhone, Chrome di Android.";

const INTROS: Readonly<Record<InstallMode, string>> = {
  installed: "Aplikasi sudah terpasang di perangkat ini. Buka dari ikon di layar utama.",
  prompt: `Buka langsung dari layar utama seperti aplikasi biasa — ${NO_STORE}.`,
  "ios-safari": IOS_INTRO,
  "ios-browser": IOS_INTRO,
  "ios-in-app": IN_APP_INTRO,
  "android-in-app": IN_APP_INTRO,
  "android-menu": `Aplikasi dipasang langsung dari browser — ${NO_STORE}. Sudah terpasang? Buka dari ikon di layar utama.`,
  desktop: "Pasang di HP: pindai kode QR dengan kamera HP untuk membuka halaman ini. Di komputer, pasang lewat Chrome atau Edge.",
};

/** Kalimat pembuka di atas tombol / langkah pasang. */
export function installIntro(mode: InstallMode): string {
  return INTROS[mode];
}

/** Langkah manual per mode; mode tombol (prompt), terpasang, dan komputer tanpa langkah. */
export function installSteps(mode: InstallMode): readonly string[] {
  return STEPS[mode];
}

export type InstallSheetMode = "prompt" | "ios";

export interface InstallSheetInput {
  readonly demo: boolean;
  readonly restricted: boolean;
  /** Lembar hanya di beranda dan bila tidak ada dialog lain yang terbuka. */
  readonly home: boolean;
  readonly dialogOpen: boolean;
  readonly deferred: boolean;
  readonly mobile: boolean;
  readonly mode: InstallMode;
}

/**
 * Lembar ajakan otomatis di beranda HP: hanya bila browser menawarkan pasang atau di iPhone (langkah Bagikan).
 * Android tanpa tawaran / browser dalam aplikasi TIDAK otomatis (bisa jadi sudah terpasang) — tersedia di menu.
 */
export function installSheetOf(i: InstallSheetInput): InstallSheetMode | null {
  if (i.demo || i.restricted || !i.home || i.dialogOpen || i.deferred || !i.mobile) return null;
  if (i.mode === "prompt") return "prompt";
  return i.mode === "ios-safari" || i.mode === "ios-browser" ? "ios" : null;
}

/**
 * Jeda sebelum lembar diputuskan. Android tanpa tawaran ditunggu lebih lama: Chrome bisa mengirim beforeinstallprompt
 * beberapa detik setelah halaman dimuat — tawaran yang datang dalam jeda ini langsung memakai jeda pendek.
 */
export const installSheetDelayMs = (mode: InstallMode): number => (mode === "android-menu" ? 5000 : 1500);

/** Item menu "Pasang aplikasi": belum terdeteksi (server/hidrasi), terpasang, atau komputer tanpa tawaran -> tersembunyi. */
export function menuInstallVisible(mode: InstallMode | null): boolean {
  return mode !== null && mode !== "installed" && mode !== "desktop";
}

/** Halaman publik pemasangan (QR & tautan yang dibagikan sekolah ke orang tua/siswa). */
export const INSTALL_PATH = "/pasang";

export const installPageUrl = (origin: string): string => `${origin.replace(/\/+$/, "")}${INSTALL_PATH}`;

export const installShareText = (appName: string, url: string): string => `Pasang aplikasi ${appName} di HP (Android & iPhone): ${url}`;

export const whatsappShareUrl = (text: string): string => `https://wa.me/?text=${encodeURIComponent(text)}`;

/** "Nanti saja" menunda 7 hari; "Sudah terpasang" (iPhone tidak bisa dideteksi dari Safari) 180 hari. */
export const INSTALL_DEFER_DAYS = 7;
export const INSTALLED_DEFER_DAYS = 180;
const DAY_MS = 86_400_000;

/** Nilai localStorage (milidetik) yang dibaca isPromptDeferred. */
export const installDeferValue = (now: number, days: number): string => String(now + days * DAY_MS);
