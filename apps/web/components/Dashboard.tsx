"use client";

import { useCallback, useEffect, useState, type ComponentType } from "react";
import { api } from "@/lib/api";
import type { Me } from "@/lib/types";
import { AuthView } from "./AuthView";
import { GeneratorTab } from "./GeneratorTab";
import { InvoiceTab } from "./InvoiceTab";
import { QrisTab } from "./QrisTab";
import { SettingsTab } from "./SettingsTab";
import { CardIcon, ChevronRightIcon, InvoiceIcon, LogoutIcon, QrIcon, SlidersIcon } from "./icons";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

type Tab = "generator" | "invoice" | "qris" | "settings";

interface TabDef {
  id: Tab;
  label: string;
  title: string;
  desc: string;
  Icon: ComponentType<{ size?: number }>;
}

const TABS: TabDef[] = [
  { id: "generator", label: "Generator", title: "Generator QR", desc: "Ubah QRIS statis jadi QR dengan nominal tetap.", Icon: QrIcon },
  { id: "invoice", label: "Invoice", title: "Invoice", desc: "Tagihan bernominal tetap; status dibayar hanya lewat konfirmasi manual merchant.", Icon: InvoiceIcon },
  { id: "qris", label: "QRIS", title: "QRIS Saya", desc: "Simpan beberapa QRIS statis, masing-masing dengan provider dan nama sendiri.", Icon: CardIcon },
  { id: "settings", label: "Pengaturan", title: "Pengaturan", desc: "Profil merchant dan kredensial API.", Icon: SlidersIcon },
];

const isTab = (v: string): v is Tab => v === "generator" || v === "invoice" || v === "qris" || v === "settings";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "K";
  const second = parts.length > 1 ? parts[1][0] : (parts[0]?.[1] ?? "");
  return (first + second).toUpperCase();
}

export function Dashboard() {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>("generator");

  const loadMe = useCallback(async () => {
    try {
      setMe(await api<Me>("/v1/auth/me"));
    } catch {
      setMe(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (isTab(hash)) setTab(hash);
    void loadMe();
  }, [loadMe]);

  const go = useCallback((next: Tab) => {
    setTab(next);
    history.replaceState(null, "", `#${next}`);
    window.scrollTo({ top: 0 });
  }, []);

  async function logout() {
    try {
      await api("/v1/auth/logout", { method: "POST" });
    } catch {
      /* session may already be gone */
    }
    setMe(null);
  }

  if (!ready) {
    return (
      <div className="boot">
        <Logo variant="mark" height={96} />
      </div>
    );
  }

  if (!me) return <AuthView onAuthed={loadMe} />;

  const current = TABS.find((t) => t.id === tab) ?? TABS[0];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Logo variant="compact" height={84} />
        </div>

        <nav className="nav" aria-label="Navigasi utama">
          {TABS.map((t) => (
            <button key={t.id} type="button" className="nav-item" aria-current={tab === t.id ? "page" : undefined} onClick={() => go(t.id)}>
              <t.Icon size={22} />
              {t.label}
            </button>
          ))}
        </nav>

        {/* Decorative silhouette: fills the free space between nav and footer. */}
        <div className="side-art" aria-hidden="true">
          <span className="side-sil" />
        </div>

        <div className="side-foot">
          <button type="button" className="merchant" onClick={() => go("settings")} aria-label="Buka pengaturan merchant">
            <span className="avatar" aria-hidden="true">{initials(me.merchant.name)}</span>
            <span className="merchant-meta">
              <strong>{me.merchant.name}</strong>
              <span>{me.merchant.role}</span>
            </span>
            <ChevronRightIcon size={18} />
          </button>
          <button type="button" className="btn btn-side" onClick={logout}>
            <LogoutIcon size={18} />
            Keluar
          </button>
        </div>
      </aside>

      <div className="content">
        <header className="topbar">
          <Logo variant="compact" height={44} />
          <div className="actions">
            <ThemeToggle />
            <button type="button" className="icon-btn" onClick={logout} aria-label="Keluar" title="Keluar">
              <LogoutIcon size={18} />
            </button>
          </div>
        </header>

        <main className="main">
          <div key={tab} className="fade-in">
            <div className="page-head">
              <div>
                <h1>{current.title}</h1>
                <p>{current.desc}</p>
              </div>
              <ThemeToggle />
            </div>

            {tab === "generator" && <GeneratorTab onGoQris={() => go("qris")} />}
            {tab === "invoice" && <InvoiceTab />}
            {tab === "qris" && <QrisTab />}
            {tab === "settings" && (
              <SettingsTab
                me={me}
                onUpdated={(name) => setMe((m) => (m ? { ...m, merchant: { ...m.merchant, name } } : m))}
              />
            )}
          </div>
        </main>
      </div>

      <nav className="tabbar" aria-label="Navigasi utama">
        {TABS.map((t) => (
          <button key={t.id} type="button" className="tab" aria-current={tab === t.id ? "page" : undefined} onClick={() => go(t.id)}>
            <t.Icon size={22} />
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
