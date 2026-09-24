import { MiniCabi } from "@/components/cabi/mini-cabi";
export default function Loading() { return <main className="grid min-h-[100dvh] place-items-center bg-[var(--cabi-bg)] text-white"><div role="status" className="text-center"><MiniCabi className="mx-auto h-16 w-16 animate-pulse" /><p className="mt-4 text-sm text-[var(--cabi-text-muted)]">Cabi is getting comfy…</p></div></main>; }
