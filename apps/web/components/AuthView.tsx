"use client";

import { useState, type ChangeEvent, type FormEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { api, errMessage, jsonInit } from "@/lib/api";
import { ArrowRightIcon, EyeIcon, EyeOffIcon, LockIcon, MailIcon, ShieldIcon, SpinnerIcon, StoreIcon } from "./icons";
import { Logo } from "./Logo";

type Mode = "login" | "register";

const MIN_PASSWORD = 10;

interface FloatFieldProps {
  id: string;
  name: string;
  label: string;
  icon: ReactNode;
  type?: string;
  autoComplete?: string;
  inputMode?: InputHTMLAttributes<HTMLInputElement>["inputMode"];
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  /** Pass both to make the field controlled (used by the password field). */
  value?: string;
  onChange?: (value: string) => void;
  trailing?: ReactNode;
}

/** Input with a leading icon and a label that floats up once focused / filled. */
function FloatField({ id, name, label, icon, type = "text", value, onChange, trailing, ...rest }: FloatFieldProps) {
  const controlled =
    value !== undefined ? { value, onChange: (e: ChangeEvent<HTMLInputElement>) => onChange?.(e.target.value) } : {};
  return (
    <div className="ffield">
      <span className="ficon" aria-hidden="true">
        {icon}
      </span>
      <input id={id} name={name} type={type} placeholder=" " {...rest} {...controlled} />
      <label htmlFor={id}>{label}</label>
      {trailing}
    </div>
  );
}

export function AuthView({ onAuthed }: { onAuthed: () => void | Promise<void> }) {
  const [mode, setMode] = useState<Mode>("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);

  const register = mode === "register";
  const strength = password.length >= MIN_PASSWORD ? 3 : password.length >= 6 ? 2 : password.length > 0 ? 1 : 0;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      if (!register) {
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
    setPassword("");
    setReveal(false);
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
        <div className="auth-card fade-in">
          <Logo variant="full" height={52} className="auth-logo" />

          <h1>{register ? "Mulai terima pembayaran" : "Selamat datang kembali"}</h1>
          <p className="sub">
            {register
              ? "Buat akun merchant. Akun pertama otomatis jadi OWNER."
              : "Masuk untuk mengelola QRIS dan membuat QR checkout."}
          </p>

          <form key={mode} onSubmit={submit}>
            {register && (
              <FloatField id="merchantName" name="merchantName" label="Nama merchant" icon={<StoreIcon size={20} />} required maxLength={120} autoComplete="organization" />
            )}
            <FloatField id="email" name="email" label="Email" type="email" icon={<MailIcon size={20} />} required autoComplete="email" inputMode="email" />
            <FloatField
              id="password"
              name="password"
              label="Password"
              type={reveal ? "text" : "password"}
              icon={<LockIcon size={20} />}
              required
              minLength={register ? MIN_PASSWORD : undefined}
              autoComplete={register ? "new-password" : "current-password"}
              value={password}
              onChange={setPassword}
              trailing={
                <button
                  type="button"
                  className="icon-btn icon-btn-ghost fpeek"
                  onClick={() => setReveal((v) => !v)}
                  aria-label={reveal ? "Sembunyikan password" : "Tampilkan password"}
                  aria-pressed={reveal}
                >
                  {reveal ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
                </button>
              }
            />

            {register && (
              <>
                <div className="meter" aria-hidden="true">
                  {[1, 2, 3].map((n) => (
                    <i key={n} className={strength >= n ? "on" : undefined} />
                  ))}
                </div>
                <p className="meter-text">
                  {password.length >= MIN_PASSWORD ? "Panjang password sudah cukup." : `Minimal ${MIN_PASSWORD} karakter (${password.length}/${MIN_PASSWORD}).`}
                </p>
              </>
            )}

            <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={busy}>
              {busy ? (
                <>
                  <SpinnerIcon size={18} />
                  Memproses…
                </>
              ) : (
                <>
                  {register ? "Buat akun" : "Masuk"}
                  <ArrowRightIcon size={18} />
                </>
              )}
            </button>

            {error && (
              <p className="alert" role="alert">
                {error}
              </p>
            )}
          </form>

          <p className="auth-switch">
            {register ? "Sudah punya akun? " : "Belum punya akun? "}
            <button type="button" className="link-btn" onClick={() => switchMode(register ? "login" : "register")}>
              {register ? "Masuk" : "Daftar gratis"}
            </button>
          </p>

          <p className="auth-secure">
            <ShieldIcon size={16} />
            Dana tidak pernah lewat Kirana Pay
          </p>
        </div>
      </section>
    </main>
  );
}
