"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { api } from "@/lib/api";
import { ProfileProvider, useProfiles } from "./ProfileProvider";

const NAV = [
  { href: "/", label: "Live call" },
  { href: "/calls", label: "Call log" },
  { href: "/calendar", label: "Calendar" },
  { href: "/leads", label: "CRM leads" },
  { href: "/outbound", label: "Outbound" },
  { href: "/profiles", label: "Business profile" },
];

function ProfileSwitcher() {
  const { profiles, current, setCurrent } = useProfiles();
  return (
    <div className="switcher" role="tablist" aria-label="Business profile">
      {profiles.map((p) => (
        <button
          key={p.id}
          role="tab"
          aria-selected={current?.id === p.id}
          className={current?.id === p.id ? "active" : ""}
          onClick={() => setCurrent(p.id)}
          data-testid={`profile-${p.id}`}
        >
          <span className="switcher-name">{p.name}</span>
          <span className="switcher-sub">{p.industry}</span>
        </button>
      ))}
    </div>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { current } = useProfiles();
  return (
    <div className="frame">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-dot" aria-hidden />
          AI Receptionist
        </div>
        <nav>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={(n.href === "/" ? path === "/" : path.startsWith(n.href)) ? "active" : ""}>
              {n.label}
            </Link>
          ))}
        </nav>
        <button
          className="link-button"
          onClick={async () => {
            await api("/api/auth/logout", { method: "POST" });
            window.location.href = "/login";
          }}
        >
          Sign out
        </button>
      </aside>
      <main className="main">
        <header className="topbar">
          <ProfileSwitcher />
          {current && (
            <div className="topbar-meta">
              Agent <strong>{current.agentName}</strong>
              {current.calendarOutage && <span className="badge red">Calendar outage simulated</span>}
              {!current.synced && <span className="badge amber">Not synced to Vapi</span>}
            </div>
          )}
        </header>
        <div className="content">{children}</div>
      </main>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  if (path === "/login") return <>{children}</>;
  return (
    <ProfileProvider>
      <Frame>{children}</Frame>
    </ProfileProvider>
  );
}
