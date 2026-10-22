"use client";

// Links between the console's pages (inbox, knowledge base, overview, alerts, settings)

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox, BookOpen, LayoutDashboard, BellRing, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "Inbox", icon: Inbox },
  { href: "/kb", label: "Knowledge base", icon: BookOpen },
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/alerts", label: "Alerts", icon: BellRing },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppNav({ className }: { className?: string }) {
  const path = usePathname();
  return (
    <nav aria-label="Console" className={cn("flex items-center gap-0.5", className)}>
      {LINKS.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? path === "/" : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            title={label}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex size-8 items-center justify-center rounded-lg transition-colors",
              active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <Icon className="size-4" />
          </Link>
        );
      })}
    </nav>
  );
}
