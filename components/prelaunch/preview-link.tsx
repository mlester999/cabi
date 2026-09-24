"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";

/** Keep application navigation inside /preview while public routes stay locked. */
export default function PreviewLink({ href, ...props }: ComponentProps<typeof Link>) {
  const pathname = usePathname();
  const target = typeof href === "string" && pathname.startsWith("/preview") &&
    href.startsWith("/") && !href.startsWith("/preview") && !href.startsWith("/admin") && !href.startsWith("/api/")
    ? href === "/" ? "/preview" : `/preview${href}`
    : href;
  return <Link href={target} {...props} />;
}
