"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "밭", match: (p: string) => p === "/" || p.startsWith("/plan") },
  { href: "/calendar", label: "캘린더", match: (p: string) => p.startsWith("/calendar") },
  { href: "/log/new", label: "기록", match: (p: string) => p.startsWith("/log") },
  { href: "/settings", label: "설정", match: (p: string) => p.startsWith("/settings") },
];

const HIDDEN = ["/login", "/onboarding", "/invite"];

export function BottomNav() {
  const pathname = usePathname();
  if (HIDDEN.some((h) => pathname.startsWith(h))) return null;
  return (
    <>
      <div className="h-16" />
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-200 bg-white pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto grid max-w-md grid-cols-4">
          {ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex h-14 items-center justify-center text-sm ${item.match(pathname) ? "font-semibold text-primary" : "text-neutral-500"}`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </nav>
    </>
  );
}
