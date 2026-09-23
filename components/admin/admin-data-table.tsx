"use client";

import { Header, Banner } from "@/components/admin/ai-settings-panel";
import Link from "next/link";
import { useEffect, useState } from "react";

export function AdminDataTable({ resource, title, description, rowHref }: {
  resource: "users" | "conversations" | "memories" | "audit";
  title: string;
  description: string;
  /** Optional per-row destination, for lists that open a record detail page. */
  rowHref?: (row: Record<string, unknown>) => string | null;
}) {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]); const [count, setCount] = useState(0); const [databaseReady, setDatabaseReady] = useState(true);
  useEffect(() => { void fetch(`/api/admin/data/${resource}`, { cache: "no-store" }).then(async (response) => { if (!response.ok) return; const payload = await response.json() as { rows: Array<Record<string, unknown>>; count: number; databaseReady: boolean }; setRows(payload.rows); setCount(payload.count); setDatabaseReady(payload.databaseReady); }); }, [resource]);
  const columns = rows.length ? Object.keys(rows[0]).filter((key) => !["metadata_json"].includes(key)).slice(0, 6) : [];
  return <div><Header eyebrow="Admin records" title={title} description={description} />{!databaseReady && <Banner>Connect Supabase to view live records.</Banner>}<p className="mt-6 text-xs text-[#706a7d]">{count} total records · viewing the newest 50</p><div className="scrollbar-cabi mt-3 overflow-x-auto rounded-[24px] border border-white/[0.065] bg-[#0e0c15]"><table className="w-full min-w-[680px] text-left text-sm"><thead className="border-b border-white/[0.06] bg-white/[0.02] text-[10px] uppercase tracking-[.11em] text-[#706a7d]"><tr>{columns.map((column) => <th key={column} className="px-4 py-3 font-semibold">{column.replaceAll("_", " ")}</th>)}</tr></thead><tbody className="divide-y divide-white/[0.05]">{rows.map((row, index) => { const href = rowHref?.(row) ?? null; return <tr key={String(row.id ?? index)} className="hover:bg-white/[0.018]">{columns.map((column) => <td key={column} className="max-w-[280px] truncate px-4 py-3 text-xs text-[#b3aebb]" title={String(row[column] ?? "")}>{format(row[column])}</td>)}{href && <td className="px-4 py-3 text-right"><Link href={href} className="focus-ring rounded-lg px-2 py-1 text-xs font-semibold text-violet-200 hover:bg-white/[0.05]">Open</Link></td>}</tr>; })}</tbody></table>{!rows.length && <div className="p-10 text-center text-sm text-[#777180]">No records yet.</div>}</div></div>;
}
function format(value: unknown) { if (value == null) return "—"; if (typeof value === "boolean") return value ? "Yes" : "No"; if (typeof value === "object") return JSON.stringify(value); const text = String(value); return /^\d{4}-\d{2}-\d{2}T/u.test(text) ? new Date(text).toLocaleString() : text; }
