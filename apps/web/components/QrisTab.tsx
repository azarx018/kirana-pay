"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent, type KeyboardEvent } from "react";
import { api, errMessage } from "@/lib/api";
import type { Provider, Qris } from "@/lib/types";
import { CardIcon, UploadIcon } from "./icons";
import { RowMenu, type MenuAction } from "./RowMenu";
import { StatusPill } from "./StatusPill";
import { useToast } from "./Toast";

const MAX_BYTES = 5 * 1024 * 1024;

export function QrisTab() {
  const toast = useToast();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [items, setItems] = useState<Qris[] | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [providerCode, setProviderCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const replaceId = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await api<Qris[]>("/v1/qris"));
    } catch (err) {
      setItems([]);
      toast(errMessage(err), "error");
    }
  }, [toast]);

  useEffect(() => {
    void load();
    api<Provider[]>("/v1/payment-providers")
      .then(setProviders)
      .catch(() => setProviders([]));
  }, [load]);

  // Free the object URL whenever the preview changes / on unmount.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  function pick(f: File) {
    if (!/^image\/(png|jpe?g)$/.test(f.type)) return setError("File harus PNG atau JPEG.");
    if (f.size > MAX_BYTES) return setError("Ukuran file maksimal 5 MB.");
    setError(null);
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files?.[0];
    if (f) pick(f);
  }

  function onZoneKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileRef.current?.click();
    }
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!file) return setError("Pilih gambar QRIS dulu.");
    if (!providerCode) return setError("Pilih payment provider.");

    const body = new FormData();
    body.append("file", file);
    body.append("providerCode", providerCode);
    body.append("displayName", name.trim());

    setBusy(true);
    try {
      await api("/v1/qris", { method: "POST", body });
      setFile(null);
      setPreview(null);
      setName("");
      setProviderCode("");
      toast("QRIS tersimpan.", "success");
      await load();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function archive(q: Qris) {
    if (!window.confirm(`Arsipkan "${q.displayName}"?`)) return;
    try {
      await api(`/v1/qris/${q.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      toast(errMessage(err), "error");
    }
  }

  function startReplace(id: string) {
    replaceId.current = id;
    replaceRef.current?.click();
  }

  async function onReplace(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    const id = replaceId.current;
    e.target.value = "";
    if (!f || !id) return;
    const body = new FormData();
    body.append("file", f);
    try {
      await api(`/v1/qris/${id}/image`, { method: "PUT", body });
      toast("Gambar QRIS diganti.", "success");
      await load();
    } catch (err) {
      toast(errMessage(err), "error");
    }
  }

  function actionsFor(q: Qris): MenuAction[] {
    const list: MenuAction[] = [{ label: "Ganti gambar", onSelect: () => startReplace(q.id) }];
    if (q.status === "ACTIVE") list.push({ label: "Arsipkan", danger: true, onSelect: () => void archive(q) });
    return list;
  }

  const active = items?.filter((q) => q.status === "ACTIVE").length ?? 0;

  return (
    <div className="split">
      <section className="card">
        <div className="card-head">
          <h2>
            <UploadIcon size={24} />
            Tambah QRIS
          </h2>
        </div>

        <form onSubmit={submit} noValidate>
          <div
            className={`dropzone${drag ? " drag" : ""}`}
            role="button"
            tabIndex={0}
            aria-label="Pilih atau seret gambar QRIS"
            onClick={() => fileRef.current?.click()}
            onKeyDown={onZoneKey}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
          >
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) pick(f);
                e.target.value = "";
              }}
            />
            {file && preview ? (
              <div className="drop-preview">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview} alt="Pratinjau QRIS" />
                <div>
                  <span>{file.name}</span>
                  <small>{Math.max(1, Math.round(file.size / 1024))} KB · ketuk untuk ganti</small>
                </div>
              </div>
            ) : (
              <>
                <UploadIcon size={28} />
                <strong>Seret gambar QRIS ke sini</strong>
                <small>atau ketuk untuk memilih · PNG / JPEG · maks 5 MB</small>
              </>
            )}
          </div>

          <label className="field">
            <span className="label">Payment provider</span>
            <select className="select" value={providerCode} onChange={(e) => setProviderCode(e.target.value)} required>
              <option value="">Pilih provider</option>
              {providers.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="label">Nama QR</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} placeholder="QR Toko Utama" />
          </label>

          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            {busy ? "Menyimpan…" : "Simpan QRIS"}
          </button>
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
        </form>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>
            <CardIcon size={24} />
            Terdaftar
          </h2>
          <span className="hint">
            {active} aktif / {items?.length ?? 0} total
          </span>
        </div>

        <input ref={replaceRef} type="file" accept="image/png,image/jpeg" hidden onChange={onReplace} />

        {items === null && (
          <>
            <div className="skel" />
            <div className="skel" />
          </>
        )}
        {items?.length === 0 && <p className="empty">Belum ada QRIS.</p>}
        {items && items.length > 0 && (
          <ul className="list">
            {items.map((q) => (
              <li key={q.id} className="row row-tx">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="thumb" src={q.imageUrl} alt="" loading="lazy" />
                <div className="row-main">
                  <div className="row-title">
                    <span>{q.displayName}</span>
                    <StatusPill status={q.status} />
                  </div>
                  <div className="row-meta">
                    {q.provider.name} · {q.nmid ?? "-"}
                  </div>
                </div>
                <RowMenu label={`Aksi ${q.displayName}`} actions={actionsFor(q)} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
