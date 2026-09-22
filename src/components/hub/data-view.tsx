"use client";
import { display, initials, label } from "@/lib/frontend/format";
import type { Row } from "@/lib/frontend/types";
import { Icon } from "./icon";

export function Status({ value }: { value: unknown }) {
  const text = String(value ?? "");
  const tone = /^(ACTIVE|APPROVED|PAID|PUBLISHED|HADIR)$/.test(text) ? "green" : /^(REJECTED|ALPHA|VOID|SUSPENDED)$/.test(text) ? "red" : /PENDING|PARTIAL|UNPAID|TERLAMBAT|DRAFT/.test(text) ? "amber" : "neutral";
  return <span className={`status ${tone}`}><i />{display(value)}</span>;
}
function Cell({ value, name }: { value: unknown; name: string }) {
  if (name === "status") return <Status value={value} />;
  if (name === "name" || name === "student") return <span className="person-cell"><span className="avatar table-avatar">{initials(display(value))}</span><span><strong>{display(value)}</strong>{typeof value === "object" && value && <small>{String((value as Row).nisn ?? (value as Row).className ?? "")}</small>}</span></span>;
  if (name === "attendance" && value && typeof value === "object") return <span className="attendance-cell"><Status value={(value as Row).status} /><small>{String((value as Row).checkInTimeLocal ?? "")}</small></span>;
  return <span className="cell-text">{display(value, name)}</span>;
}
export function DataTable({ rows, onSelect }: { rows: Row[]; onSelect?: (row: Row) => void }) {
  const keys = Object.keys(rows[0] ?? {}).filter(k => !["id", "mustChangePassword"].includes(k) && !/Ids?$/.test(k)).slice(0, 6);
  return <div className="table-scroll"><table><thead><tr>{keys.map(k => <th key={k} scope="col">{label(k)}</th>)}{onSelect && <th scope="col"><span className="sr-only">Detail</span></th>}</tr></thead><tbody>{rows.map((row, i) => <tr key={String(row.id ?? i)}>{keys.map(k => <td key={k}><Cell name={k} value={row[k]} /></td>)}{onSelect && <td><button className="table-detail" onClick={() => onSelect(row)} aria-label={`Lihat detail ${display(row.name ?? row.title ?? row.student ?? i + 1)}`}><Icon name="arrow" size={17} /></button></td>}</tr>)}</tbody></table></div>;
}
export function Details({ value, depth = 0, field = "", onSelect }: { value: unknown; depth?: number; field?: string; onSelect?: (row: Row, field: string) => void }) {
  if (value === null || value === undefined) return <p className="muted">Belum ada informasi.</p>;
  if (Array.isArray(value)) return value.length ? typeof value[0] === "object" ? <DataTable rows={value as Row[]} onSelect={onSelect && ["terms", "payments", "submissions"].includes(field) ? row => onSelect(row, field) : undefined} /> : <div className="tag-list">{value.map((v, i) => <span className="pill" key={i}>{display(v)}</span>)}</div> : <p className="muted">Belum ada data.</p>;
  if (typeof value !== "object") return <p className="detail-text">{display(value)}</p>;
  return <div className={`details-grid depth-${depth}`}>{Object.entries(value as Row).filter(([key]) => !["id", "schoolId", "userId", "sponsorId", "sessionId", "requestId"].includes(key)).map(([key, item]) => {
    const nested = item !== null && typeof item === "object";
    return <div className={`detail-field ${nested ? "full-width" : ""} ${/password|secret/i.test(key) ? "sensitive-field" : ""}`} key={key}><span className="detail-label">{label(key)}</span>{nested ? <Details value={item} depth={depth + 1} field={key} onSelect={onSelect} /> : key === "status" ? <Status value={item} /> : /FileId$/.test(key) && item ? <a className="text-link" target="_blank" rel="noreferrer" href={`/api/web/files/${encodeURIComponent(String(item))}`}><Icon name="image" size={17} />Lihat berkas</a> : key === "otpauthUri" && String(item).startsWith("otpauth://") ? <a className="text-link" href={String(item)}>Buka aplikasi autentikator</a> : <strong className="detail-value">{display(item, key)}</strong>}</div>;
  })}</div>;
}
