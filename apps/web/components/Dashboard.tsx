"use client";

import { useCallback, useEffect, useState, type ComponentType } from "react";
import { api } from "@/lib/api";
import type { Me } from "@/lib/types";
import { AuthView } from "./AuthView";
import { GeneratorTab } from "./GeneratorTab";
import { QrisTab } from "./QrisTab";
import { SettingsTab } from "./SettingsTab";
import { CardIcon, LogoutIcon, QrIcon, SlidersIcon } from "./icons";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

type Tab = "generator" | "qris" | "settings";

interface TabDef {
  id: Tab;
  label: string;
  title: string;
  desc: string;
  Icon: ComponentType<{ size?: number }>;
}

const TABS: TabDef[] = [
  { id: "generator", label: "Generator", title: "Generator QR", desc: "Ubah QRIS statis jadi QR dengan nominal tetap.", Icon: QrIcon },
  { id: "qris", label: "QRIS", title: "QRIS Saya", desc: "Simpan beberapa QRIS statis, masing-masing dengan provider dan nama sendiri.", Icon: CardIcon },
  { id: "settings", label: "Pengaturan", title: "Pengaturan", desc: "Profil merchant dan kredensial API.", Icon: SlidersIcon },
];

const isTab = (v: string): v is Tab => v === "generator" || v === "qris" || v === "settings";

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
  const initial = (me.merchant.name.trim()[0] ?? "K").toUpperCase();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Logo height={56} />
        </div>

        <nav className="nav" aria-label="Navigasi utama">
          {TABS.map((t) => (
            <button key={t.id} type="button" className="nav-item" aria-current={tab === t.id ? "page" : undefined} onClick={() => go(t.id)}>
              <t.Icon size={20} />
              {t.label}
            </button>
          ))}
        </nav>

        <div className="side-foot">
          <div className="merchant">
            <span className="avatar" aria-hidden="true">{initial}</span>
            <div className="merchant-meta">
              <strong>{me.merchant.name}</strong>
              <span>{me.merchant.role}</span>
            </div>
          </div>
          <div className="side-actions">
            <ThemeToggle />
            <button type="button" className="btn btn-secondary btn-sm" onClick={logout}>
              <LogoutIcon size={16} />
              Keluar
            </button>
          </div>
        </div>
      </aside>

      <div>
        <header className="topbar">
          <Logo height={40} />
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
              <h1>{current.title}</h1>
              <p>{current.desc}</p>
            </div>

            {tab === "generator" && <GeneratorTab onGoQris={() => go("qris")} />}
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
