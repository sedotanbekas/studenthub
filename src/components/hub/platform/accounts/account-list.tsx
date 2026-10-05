"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { AccountRow } from "@/lib/frontend/account-rules";
import { api } from "@/lib/frontend/api";
import { demoAccounts } from "@/lib/frontend/demo-accounts";
import { number } from "@/lib/frontend/format";
import { useHub } from "../../context";
import { Icon } from "../../icon";
import { AccountCard } from "./account-card";
import { usePaged, type Paged } from "./use-paged";

const PAGE_SIZE = 20;
const SEARCH_DELAY_MS = 300;

function loadPage(query: string, page: number, demo: boolean): Promise<Paged<AccountRow>> {
  const params = new URLSearchParams(query);
  if (demo) { const rows = demoAccounts(params); return Promise.resolve({ rows, total: rows.length, totalPages: 1 }); }
  params.set("page", String(page));
  params.set("limit", String(PAGE_SIZE));
  return api(`/platform/users?${params}`).then(r => {
    const rows = (r.data ?? []) as AccountRow[];
    return { rows, total: r.meta?.total ?? rows.length, totalPages: r.meta?.totalPages ?? 1 };
  });
}

function useAccountPages(query: string) {
  const { demo } = useHub();
  const load = useCallback((page: number) => loadPage(query, page, demo), [query, demo]);
  return usePaged(load, "Data akun belum berhasil dimuat.");
}

interface ListProps { query: string; emptyText: string; showSchool?: boolean; renderExtra?: (account: AccountRow) => ReactNode }

function AccountListBody({ query, emptyText, showSchool, renderExtra, onChanged }: ListProps & { onChanged: () => void }) {
  const list = useAccountPages(query);
  if (list.error && list.rows.length === 0) return <div className="error-message" role="alert">{list.error}</div>;
  if (list.loading && list.rows.length === 0) return <div className="table-loading" role="status" aria-label="Memuat akun">{[1, 2, 3].map(i => <div className="skeleton" key={i} />)}</div>;
  if (list.rows.length === 0) return <p className="account-empty muted">{emptyText}</p>;
  return <div className="account-list">
    {list.rows.map(account => <AccountCard key={account.id} account={account} showSchool={showSchool} onChanged={onChanged} extraActions={renderExtra?.(account)} />)}
    <div className="account-list-foot">
      <small>{`Menampilkan ${number(list.rows.length)} dari ${number(list.total)} akun`}</small>
      {list.hasMore && <button type="button" className="button secondary small-button" disabled={list.loading} onClick={list.loadMore}>{list.loading ? "Memuat…" : list.error ? "Coba lagi" : "Muat lebih banyak"}</button>}
    </div>
    {list.error && <div className="error-message" role="alert">{list.error}</div>}
  </div>;
}

/** Daftar akun dari GET /platform/users (`query` = filter tetap, mis. `schoolId=..&role=STUDENT`). */
export function AccountList({ searchable = false, ...props }: ListProps & { searchable?: boolean }) {
  const [version, setVersion] = useState(0);
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => { const timer = setTimeout(() => setQ(text.trim()), SEARCH_DELAY_MS); return () => clearTimeout(timer); }, [text]);
  const query = q ? `${props.query}&q=${encodeURIComponent(q)}` : props.query;
  return <div className="account-list-wrap">
    {searchable && <div className="table-search"><Icon name="search" size={17} /><input aria-label="Cari akun" placeholder="Cari nama, email, atau NISN…" value={text} onChange={e => setText(e.target.value)} /></div>}
    <AccountListBody key={`${query}|${version}`} {...props} query={query} emptyText={q ? `Tidak ada akun yang cocok dengan "${q}".` : props.emptyText} onChanged={() => setVersion(v => v + 1)} />
  </div>;
}
