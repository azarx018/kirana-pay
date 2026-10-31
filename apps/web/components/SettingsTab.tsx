"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, errMessage, jsonInit } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { fmtDate } from "@/lib/format";
import type { ApiKey, Me } from "@/lib/types";
import { CopyIcon } from "./icons";
import { useToast } from "./Toast";

const CURL_SNIPPET = `curl -X POST https://<domain>/v1/qr/convert \\
  -H "x-api-key: <KEY>" \\
  -F "qrisId=<id>" -F "amount=2300"`;

interface Props {
  me: Me;
  onUpdated: (name: string) => void;
}

export function SettingsTab({ me, onUpdated }: Props) {
  const toast = useToast();

  /* ----- merchant profile ----- */
  const [name, setName] = useState(me.merchant.name);
  const [phone, setPhone] = useState(me.merchant.phone ?? "");
  const [saving, setSaving] = useState(false);

  async function saveProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    try {
      const m = await api<{ name: string }>("/v1/merchant", jsonInit("PATCH", { name: name.trim(), phone: phone.trim() }));
      setName(m.name);
      onUpdated(m.name);
      toast("Profil tersimpan.", "success");
    } catch (err) {
      toast(errMessage(err), "error");
    } finally {
      setSaving(false);
    }
  }

  /* ----- api keys ----- */
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [keyName, setKeyName] = useState("");
  const [plain, setPlain] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadKeys = useCallback(async () => {
    try {
      setKeys(await api<ApiKey[]>("/v1/api-keys"));
    } catch (err) {
      setKeys([]);
      toast(errMessage(err), "error");
    }
  }, [toast]);

  const hidePlain = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setPlain(null);
    setCopied(false);
  }, []);

  useEffect(() => {
    void loadKeys();
    // The plaintext key must never outlive this screen.
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [loadKeys]);

  async function createKey() {
    try {
      const data = await api<{ key: string }>("/v1/api-keys", jsonInit("POST", { name: (keyName || "API key").trim() }));
      setKeyName("");
      setCopied(false);
      setPlain(data.key);
      await loadKeys();
    } catch (err) {
      toast(errMessage(err), "error");
    }
  }

  async function copyKey() {
    if (!plain) return;
    const ok = await copyText(plain);
    setCopied(ok);
    if (!ok) toast("Gagal menyalin — blok key lalu salin manual.", "error");
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(hidePlain, 60_000);
  }

  async function revoke(k: ApiKey) {
    if (!window.confirm("Revoke API key ini? Aplikasi yang memakainya akan langsung gagal.")) return;
    try {
      await api(`/v1/api-keys/${k.id}`, { method: "DELETE" });
      await loadKeys();
    } catch (err) {
      toast(errMessage(err), "error");
    }
  }

  return (
    <div className="split">
      <section className="card">
        <div className="card-head">
          <h2>Profil merchant</h2>
          <span className="pill">{me.merchant.role}</span>
        </div>
        <form onSubmit={saveProfile}>
          <label className="field">
            <span className="label">Nama merchant</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
          </label>
          <label className="field">
            <span className="label">Email kontak</span>
            <input className="input" value={me.user.email} disabled />
          </label>
          <label className="field">
            <span className="label">
              Telepon <span className="opt">opsional</span>
            </span>
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} inputMode="tel" autoComplete="tel" />
          </label>
          <button className="btn btn-primary btn-block" type="submit" disabled={saving}>
            {saving ? "Menyimpan…" : "Simpan"}
          </button>
        </form>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>API key</h2>
        </div>
        <p className="help">
          API key dipakai server/aplikasi kamu untuk memanggil API tanpa login — dikirim di header <code>x-api-key</code>. Simpan di server, jangan di browser.
        </p>

        <div className="key-create">
          <input className="input" value={keyName} onChange={(e) => setKeyName(e.target.value)} maxLength={60} placeholder="Nama key, mis. server-produksi" aria-label="Nama API key" />
          <button type="button" className="btn btn-secondary" onClick={() => void createKey()}>
            Buat key
          </button>
        </div>

        {plain && (
          <div className="key-once fade-in">
            <div className="key-once-head">
              <strong>Key baru — salin sekarang, tidak bisa dilihat lagi</strong>
              <button type="button" className="link-btn" onClick={hidePlain}>
                Sembunyikan
              </button>
            </div>
            <code>{plain}</code>
            <div className="key-once-actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copyKey()}>
                <CopyIcon size={16} />
                Salin key
              </button>
              {copied && <span className="hint">Tersalin. Tempel di server kamu, lalu sembunyikan.</span>}
            </div>
            <pre className="snippet">{CURL_SNIPPET}</pre>
          </div>
        )}

        {keys === null && (
          <>
            <div className="skel" />
            <div className="skel" />
          </>
        )}
        {keys?.length === 0 && <p className="empty">Belum ada API key.</p>}
        {keys && keys.length > 0 && (
          <ul className="list">
            {keys.map((k) => (
              <li key={k.id} className="row">
                <div className="row-main">
                  <div className="row-title">
                    {k.name}
                    <span className={`pill${k.revoked ? " muted" : ""}`}>{k.revoked ? "REVOKED" : "ACTIVE"}</span>
                  </div>
                  <div className="row-meta mono">
                    {k.prefix}… · dibuat {fmtDate(k.createdAt)} · {k.lastUsedAt ? `dipakai ${fmtDate(k.lastUsedAt)}` : "belum dipakai"}
                  </div>
                </div>
                {!k.revoked && (
                  <button type="button" className="link-btn danger" onClick={() => void revoke(k)}>
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
