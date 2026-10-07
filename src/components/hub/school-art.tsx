/**
 * Ilustrasi gedung sekolah beranimasi untuk halaman masuk (permintaan pemilik 2026-10-07): menara jam,
 * serambi berpilar, dua sayap gedung, pepohonan. SVG sebaris (tanpa unduhan gambar, ramah PageSpeed);
 * warnanya ikut tema sekolah lewat variabel CSS dan gerakannya diatur src/styles/login-art.css
 * (mati sendiri bila prefers-reduced-motion).
 */
const WING_COLUMNS = [0, 1, 2, 3, 4, 5, 6, 7];
/** Jendela yang sesekali menyala (indeks baris-kolom) -- tampak hidup tanpa terlalu ramai. */
const LIT = new Set(["l-0-2", "l-1-5", "r-0-4", "r-1-1", "r-0-7"]);

export function SchoolArt({ className }: { className?: string }) {
  return <svg className={`sh-art ${className ?? ""}`} viewBox="0 -24 600 404" preserveAspectRatio="xMidYMax slice" role="presentation" focusable="false">
    <ArtDefs />
    <Sky />
    <Wing side="l" x={14} />
    <Wing side="r" x={366} />
    <Tower />
    <Portico />
    <Ground />
  </svg>;
}

function ArtDefs() {
  return <defs>
    <linearGradient id="sh-roof" x1="0" y1="0" x2="1" y2="1"><stop offset="0" className="sh-stop-roof-a" /><stop offset="1" className="sh-stop-roof-b" /></linearGradient>
    <linearGradient id="sh-col" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#ffffff" /><stop offset="0.65" stopColor="#eef2fb" /><stop offset="1" stopColor="#cdd6ea" /></linearGradient>
    <linearGradient id="sh-tree" x1="0" y1="0" x2="1" y2="0"><stop offset="0" className="sh-stop-tree-a" /><stop offset="1" className="sh-stop-tree-b" /></linearGradient>
    <linearGradient id="sh-lawn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" className="sh-stop-lawn-a" /><stop offset="1" className="sh-stop-lawn-b" /></linearGradient>
    <path id="sh-win" d="M0 8a8 8 0 0 1 16 0v16H0z" />
  </defs>;
}

function Sky() {
  return <g>
    <circle className="sh-sun" cx="486" cy="78" r="44" />
    <g className="sh-cloud sh-cloud-a"><ellipse cx="96" cy="70" rx="44" ry="15" /><ellipse cx="122" cy="58" rx="26" ry="18" /><ellipse cx="78" cy="62" rx="20" ry="13" /></g>
    <g className="sh-cloud sh-cloud-b"><ellipse cx="250" cy="44" rx="34" ry="11" /><ellipse cx="268" cy="35" rx="19" ry="13" /></g>
    <g className="sh-cloud sh-cloud-c"><ellipse cx="530" cy="138" rx="30" ry="10" /><ellipse cx="546" cy="130" rx="16" ry="11" /></g>
    <g className="sh-birds"><path d="M0 0q6-7 12 0q6-7 12 0" /><path d="M30 10q5-6 10 0q5-6 10 0" /></g>
  </g>;
}

/** Sayap gedung: atap datar, list putih, dua baris jendela melengkung. */
function Wing({ side, x }: { side: "l" | "r"; x: number }) {
  return <g>
    <rect className="sh-roof" x={x - 4} y="182" width="228" height="16" rx="3" />
    <rect className="sh-trim" x={x - 8} y="196" width="236" height="7" rx="2" />
    <rect className="sh-wall" x={x} y="203" width="220" height="97" />
    <rect className="sh-trim" x={x} y="246" width="220" height="3" />
    {[0, 1].map(row => WING_COLUMNS.map(col => {
      const key = `${side}-${row}-${col}`;
      return <use key={key} href="#sh-win" className={LIT.has(key) ? "sh-window sh-lit" : "sh-window"} x={x + 12 + col * 26} y={row === 0 ? 214 : 260} style={LIT.has(key) ? { animationDelay: `${(col % 4) * 1.3}s` } : undefined} />;
    }))}
  </g>;
}

/** Menara jam di belakang serambi: badan, jam, balkon, kubah, menara runcing, bendera. */
function Tower() {
  return <g>
    <rect className="sh-tower" x="330" y="116" width="80" height="80" />
    <rect className="sh-tower-shade" x="392" y="116" width="18" height="80" />
    <circle className="sh-clock" cx="370" cy="152" r="18" />
    <circle className="sh-clock-ring" cx="370" cy="152" r="14" />
    <line className="sh-hand sh-hour" x1="370" y1="152" x2="370" y2="143" />
    <line className="sh-hand sh-minute" x1="370" y1="152" x2="379" y2="152" />
    <rect className="sh-trim" x="320" y="104" width="100" height="12" rx="2" />
    {[0, 1, 2, 3, 4, 5, 6, 7].map(i => <rect key={i} className="sh-trim" x={326 + i * 12} y="92" width="4" height="12" />)}
    <rect className="sh-trim" x="320" y="88" width="100" height="5" rx="2" />
    <rect className="sh-trim" x="344" y="58" width="52" height="30" />
    <path className="sh-door" d="M354 86V70a5 5 0 0 1 10 0v16zM376 86V70a5 5 0 0 1 10 0v16z" />
    <path className="sh-roof" d="M338 60Q370 18 402 60Z" />
    <path className="sh-trim" d="M366 30L370 4L374 30Z" />
    <line className="sh-pole" x1="370" y1="6" x2="370" y2="-14" />
    <path className="sh-flag" d="M370 -14h20l-5 6 5 6h-20z" />
  </g>;
}

/** Serambi berpilar di tengah: dinding, segitiga atap, empat pilar, pintu, anak tangga. */
function Portico() {
  return <g>
    <rect className="sh-roof" x="176" y="178" width="248" height="14" rx="3" />
    <rect className="sh-wall-2" x="186" y="192" width="228" height="108" />
    {[0, 1, 2].map(i => <use key={i} href="#sh-win" className="sh-window" x={[228, 356, 292][i]} y={i === 2 ? 204 : 218} />)}
    <path className="sh-trim" d="M190 190L300 138L410 190Z" />
    <path className="sh-pediment" d="M214 184L300 146L386 184Z" />
    <rect className="sh-trim" x="186" y="188" width="228" height="14" rx="2" />
    {[204, 244, 344, 384].map(cx => <rect key={cx} x={cx} y="202" width="12" height="86" fill="url(#sh-col)" />)}
    <rect className="sh-trim" x="266" y="236" width="68" height="8" rx="2" />
    <rect className="sh-door" x="278" y="244" width="44" height="44" />
    <rect className="sh-door-glow" x="278" y="244" width="44" height="44" />
    <rect className="sh-step" x="180" y="288" width="240" height="6" />
    <rect className="sh-step sh-step-2" x="170" y="294" width="260" height="6" />
  </g>;
}

/** Halaman: rumput, jalan masuk melengkung, semak, dan cemara yang bergoyang pelan. */
function Ground() {
  return <g>
    <rect x="0" y="300" width="600" height="80" fill="url(#sh-lawn)" />
    <path className="sh-path" d="M150 380C204 334 254 312 288 300H312C346 312 396 334 450 380Z" />
    <ellipse className="sh-bush" cx="150" cy="298" rx="30" ry="14" />
    <ellipse className="sh-bush" cx="452" cy="298" rx="34" ry="15" />
    <ellipse className="sh-bush" cx="40" cy="302" rx="26" ry="11" />
    {[[30, 258, 9, 40, 0], [58, 266, 8, 32, 1.4], [520, 238, 22, 78, 0.6], [564, 256, 17, 60, 2.1], [482, 270, 9, 34, 1]].map(([cx, cy, rx, ry, delay]) =>
      <ellipse key={cx} className="sh-tree" cx={cx} cy={cy} rx={rx} ry={ry} fill="url(#sh-tree)" style={{ animationDelay: `${delay}s` }} />)}
  </g>;
}
