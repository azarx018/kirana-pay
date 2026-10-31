"use client";

import { useState, type FormEvent } from "react";
import { api, errMessage, jsonInit } from "@/lib/api";
import { Logo } from "./Logo";

type Mode = "login" | "register";

export function AuthView({ onAuthed }: { onAuthed: () => void | Promise<void> }) {
  const [mode, setMode] = useState<Mode>("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") {
        await api("/v1/auth/login", jsonInit("POST", { email: f.get("email"), password: f.get("password") }));
      } else {
        await api(
          "/v1/auth/register",
          jsonInit("POST", {
            email: f.get("email"),
            password: f.get("password"),
            merchantName: f.get("merchantName"),
          }),
        );
      }
      await onAuthed();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
  }

  return (
    <main className="auth">
      <aside className="auth-art" aria-hidden="true">
        <Logo variant="wordmark" height={64} />
        <div className="art-mark">
          <Logo variant="mark" height={340} />
        </div>
        <blockquote>
          <p>Payments, made effortless.</p>
          <ul>
            <li>QRIS statis jadi QR dengan nominal tetap</li>
            <li>Dana tidak pernah lewat Kirana Pay</li>
            <li>Multi-merchant dengan API key sendiri</li>
          </ul>
        </blockquote>
      </aside>

      <section className="auth-panel">
        <div className="auth-box fade-in">
          <Logo variant="full" height={64} />

          <h1>{mode === "login" ? "Selamat datang kembali" : "Mulai terima pembayaran"}</h1>
          <p className="sub">
            {mode === "login"
              ? "Masuk untuk mengelola QRIS dan membuat QR checkout."
              : "Buat akun merchant. Akun pertama otomatis jadi OWNER."}
          </p>

          <div className="segmented" role="tablist" aria-label="Masuk atau daftar">
            <button type="button" role="tab" aria-selected={mode === "login"} onClick={() => switchMode("login")}>
              Masuk
            </button>
            <button type="button" role="tab" aria-selected={mode === "register"} onClick={() => switchMode("register")}>
              Daftar
            </button>
          </div>

          <form key={mode} onSubmit={submit}>
            {mode === "register" && (
              <label className="field">
                <span className="label">Nama merchant</span>
                <input className="input" name="merchantName" required maxLength={120} placeholder="Toko Utama" autoComplete="organization" />
              </label>
            )}
            <label className="field">
              <span className="label">Email</span>
              <input className="input" name="email" type="email" required placeholder="owner@toko.id" autoComplete="email" inputMode="email" />
            </label>
            <label className="field">
              <span className="label">
                Password {mode === "register" && <span className="opt">min 10 karakter</span>}
              </span>
              <input
                className="input"
                name="password"
                type="password"
                required
                minLength={mode === "register" ? 10 : undefined}
                placeholder="••••••••••"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
            </label>

            <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
              {busy ? "Memproses…" : mode === "login" ? "Masuk" : "Buat akun"}
            </button>
            {error && (
              <p className="alert" role="alert">
                {error}
              </p>
            )}
          </form>
        </div>
      </section>
    </main>
  );
}
