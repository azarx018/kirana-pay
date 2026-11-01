"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, errMessage } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { digitsOnly, fmtDate, formatAmountInput, rupiah } from "@/lib/format";
import type { ConvertResult, QrJob, Qris } from "@/lib/types";
import { CardIcon, CheckBadgeIcon, ClockIcon, CopyIcon, DownloadIcon, QrIcon, RefreshIcon, SparkIcon } from "./icons";
import { RowMenu } from "./RowMenu";
import { StatusPill } from "./StatusPill";
import { useToast } from "./Toast";

const QUICK_AMOUNTS = [1000, 2500, 10000, 25000, 50000];
const idr = new Intl.NumberFormat("id-ID");

export function GeneratorTab({ onGoQris }: { onGoQris: () => void }) {
  const toast = useToast();
  const [qris, setQris] = useState<Qris[] | null>(null);
  const [jobs, setJobs] = useState<QrJob[] | null>(null);
  const [qrisId, setQrisId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConvertResult | null>(null);
  const resultRef = useRef<HTMLElement>(null);

  const loadJobs = useCallback(async () => {
    try {
      setJobs(await api<QrJob[]>("/v1/qr?limit=10"));
    } catch (err) {
      setJobs([]);
      toast(errMessage(err), "error");
    }
  }, [toast]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const active = (await api<Qris[]>("/v1/qris")).filter((q) => q.status === "ACTIVE");
        if (!alive) return;
        setQris(active);
        setQrisId(active[0]?.id ?? "");
      } catch {
        if (alive) setQris([]);
      }
    })();
    void loadJobs();
    return () => {
      alive = false;
    };
  }, [loadJobs]);

  // Below 1280px the result sits under the form: bring it into view.
  useEffect(() => {
    if (result && window.matchMedia("(max-width: 1279px)").matches) {
      resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [result]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const value = Number(digitsOnly(amount));
    if (!qrisId) return setError("Pilih QRIS dulu (tambahkan di tab QRIS).");
    if (!value) return setError("Nominal harus lebih dari 0.");

    const body = new FormData();
    body.append("qrisId", qrisId);
    body.append("amount", String(value));
    const trimmed = note.trim();
    if (trimmed) body.append("note", trimmed);

    setBusy(true);
    try {
      setResult(await api<ConvertResult>("/v1/qr/convert", { method: "POST", body }));
      void loadJobs();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function copyValue(label: string, value: string) {
    const ok = await copyText(value);
    toast(ok ? `${label} disalin.` : `Gagal menyalin ${label}.`, ok ? "success" : "error");
  }

  const noQris = qris !== null && qris.length === 0;
  const typed = digitsOnly(amount);

  return (
    <>
      <div className="split">
        <section className="card">
          <div className="card-head">
            <h2>
              <QrIcon size={26} />
              QRIS
            </h2>
          </div>

          <form onSubmit={submit} noValidate>
            <div className="field">
              <div className="select-wrap">
                <CardIcon size={20} />
                <select className="select" aria-label="Pilih QRIS" value={qrisId} onChange={(e) => setQrisId(e.target.value)} disabled={!qris?.length}>
                  {qris === null && <option value="">Memuat…</option>}
                  {noQris && <option value="">Belum ada QRIS aktif</option>}
                  {qris?.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.displayName} · {q.provider.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <label className="field" style={{ marginBottom: 0 }}>
              <span className="label">Nominal</span>
              <div className="amount">
                <span>Rp</span>
                <input
                  value={amount}
                  onChange={(e) => setAmount(formatAmountInput(e.target.value))}
                  inputMode="numeric"
                  placeholder="0"
                  autoComplete="off"
                  aria-label="Nominal dalam rupiah"
                />
              </div>
            </label>

            <div className="chips">
              {QUICK_AMOUNTS.map((n) => (
                <button key={n} type="button" className="chip" aria-pressed={typed === String(n)} onClick={() => setAmount(formatAmountInput(String(n)))}>
                  {idr.format(n)}
                </button>
              ))}
            </div>

            <label className="field">
              <span className="label">
                Keterangan <span className="opt">Opsional</span>
              </span>
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={25} placeholder="INV-001" />
            </label>

            <button className="btn btn-primary btn-block" type="submit" disabled={busy || noQris}>
              <SparkIcon size={18} />
              {busy ? "Memproses…" : "Generate QR"}
            </button>

            {noQris && (
              <p className="note">
                Belum ada QRIS aktif.{" "}
                <button type="button" className="link-btn" onClick={onGoQris}>
                  Tambah QRIS
                </button>
              </p>
            )}
            {error && (
              <p className="alert" role="alert">
                {error}
              </p>
            )}
          </form>
        </section>

        <section className="card" ref={resultRef} aria-live="polite">
          <div className="card-head">
            <h2>
              {result ? <CheckBadgeIcon size={26} /> : <QrIcon size={26} />}
              Hasil
            </h2>
            {result ? <StatusPill status={result.status} /> : <span className="hint">belum ada</span>}
          </div>

          {result ? (
            <div className="fade-in">
              <div className="qr-frame">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`data:image/png;base64,${result.qrImage.data}`} alt={`QR checkout ${rupiah(result.amount)}`} />
              </div>
              <div className="result-amount">{rupiah(result.amount)}</div>
              <dl className="kv">
                <div>
                  <dt>Merchant</dt>
                  <dd>{result.merchant.name}</dd>
                </div>
                <div>
                  <dt>NMID</dt>
                  <dd>{result.merchant.nmid}</dd>
                </div>
                <div>
                  <dt>Job ID</dt>
                  <dd className="small">{result.id}</dd>
                </div>
              </dl>
              <div className="btn-row">
                <a
                  className="btn btn-secondary"
                  href={`data:image/png;base64,${result.qrImage.data}`}
                  download={`qris-${result.amount}-${result.id.slice(0, 8)}.png`}
                >
                  <DownloadIcon size={18} />
                  Unduh PNG
                </a>
                <button type="button" className="btn btn-accent" onClick={() => setResult(null)}>
                  <CopyIcon size={18} />
                  Buat lagi
                </button>
              </div>
            </div>
          ) : (
            <div className="result-empty">
              <QrIcon size={36} />
              <p>QR hasil generate muncul di sini</p>
            </div>
          )}
        </section>
      </div>

      <section className="card" style={{ marginTop: 22 }}>
        <div className="card-head">
          <h2>
            <ClockIcon size={24} />
            Riwayat
          </h2>
          <button type="button" className="link-btn with-icon" onClick={() => void loadJobs()}>
            <RefreshIcon size={18} />
            Muat ulang
          </button>
        </div>

        {jobs === null && (
          <>
            <div className="skel" />
            <div className="skel" />
            <div className="skel" />
          </>
        )}
        {jobs?.length === 0 && <p className="empty">Belum ada transaksi.</p>}
        {jobs && jobs.length > 0 && (
          <ul className="list">
            {jobs.map((j) => (
              <li key={j.id} className="row row-tx">
                <span className="row-ico" aria-hidden="true">
                  <QrIcon size={22} />
                </span>
                <div className="row-main">
                  <div className="row-title">
                    <span>{j.merchant.name}</span>
                    <StatusPill status={j.status} />
                  </div>
                  <div className="row-meta">
                    {fmtDate(j.createdAt)} · {j.merchant.nmid}
                  </div>
                </div>
                <span className="row-amount">{rupiah(j.amount)}</span>
                <RowMenu
                  label={`Aksi transaksi ${rupiah(j.amount)}`}
                  actions={[
                    { label: "Salin Job ID", onSelect: () => void copyValue("Job ID", j.id) },
                    { label: "Salin NMID", onSelect: () => void copyValue("NMID", j.merchant.nmid) },
                  ]}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
