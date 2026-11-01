"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, errMessage, jsonInit } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { digitsOnly, fmtDate, formatAmountInput, rupiah } from "@/lib/format";
import type { Invoice, InvoiceDetail, InvoiceList, Qris } from "@/lib/types";
import { CardIcon, ChevronRightIcon, CopyIcon, InvoiceIcon, PlusIcon, SparkIcon, XIcon } from "./icons";
import { StatusPill } from "./StatusPill";
import { useToast } from "./Toast";

const QUICK_AMOUNTS = [10000, 25000, 50000, 100000];
const idr = new Intl.NumberFormat("id-ID");

const EXPIRY_PRESETS = [
  { label: "15 menit", value: 15 },
  { label: "1 jam", value: 60 },
  { label: "6 jam", value: 360 },
  { label: "24 jam", value: 1440 },
  { label: "7 hari", value: 10080 },
];

// PENDING = kuning, PAID = hijau, EXPIRED = abu-abu (lihat StatusPill).
const STATUS_LABEL: Record<Invoice["status"], string> = {
  PENDING: "Menunggu",
  PAID: "Dibayar",
  EXPIRED: "Kedaluwarsa",
};

function eventLabel(type: "CREATED" | "PAYMENT_CONFIRMED" | "EXPIRED"): string {
  if (type === "CREATED") return "Invoice dibuat (menunggu pembayaran)";
  if (type === "PAYMENT_CONFIRMED") return "Ditandai dibayar oleh merchant";
  return "Kedaluwarsa";
}

export function InvoiceTab() {
  const toast = useToast();
  const [items, setItems] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [qrisList, setQrisList] = useState<Qris[]>([]);
  const [qrisError, setQrisError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [qrisId, setQrisId] = useState("");
  const [expiry, setExpiry] = useState(60);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const panelRef = useRef<HTMLElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const res = await api<InvoiceList>("/v1/invoices?limit=20");
      setItems(res.items);
    } catch (err) {
      setListError(errMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadQris = useCallback(async () => {
    setQrisError(null);
    try {
      const rows = await api<Qris[]>("/v1/qris");
      const active = rows.filter((q) => q.status === "ACTIVE");
      setQrisList(active);
      setQrisId((prev) => prev || active[0]?.id || "");
      if (active.length === 0) setQrisError("Belum ada QRIS aktif. Tambahkan QRIS dulu di tab QRIS.");
    } catch (err) {
      setQrisError(errMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = useCallback(() => {
    setCreating(true);
    setFormError(null);
    void loadQris();
  }, [loadQris]);

  const openDetail = useCallback(
    async (publicId: string) => {
      setDetailLoading(true);
      setConfirmOpen(false);
      try {
        setDetail(await api<InvoiceDetail>(`/v1/invoices/${publicId}`));
      } catch (err) {
        toast(errMessage(err), "error");
      } finally {
        setDetailLoading(false);
      }
    },
    [toast],
  );

  // Below 1280px the side panel stacks under the list: bring it into view.
  const panelKey = creating ? "create" : (detail?.publicId ?? null);
  useEffect(() => {
    if (panelKey && window.matchMedia("(max-width: 1279px)").matches) {
      panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [panelKey]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);

    const value = Number(digitsOnly(amount));
    if (!Number.isInteger(value) || value <= 0) {
      setFormError("Nominal harus bilangan bulat lebih dari 0.");
      return;
    }
    if (!qrisId) {
      setFormError("Pilih QRIS yang mau dipakai.");
      return;
    }

    setSubmitting(true);
    try {
      const created = await api<Invoice>(
        "/v1/invoices",
        jsonInit("POST", {
          amount: value,
          description: description.trim() || undefined,
          qrisId,
          expiresInMinutes: expiry,
        }),
      );
      toast("Invoice dibuat — status masih menunggu pembayaran.", "success");
      setCreating(false);
      setAmount("");
      setDescription("");
      await load();
      await openDetail(created.publicId);
    } catch (err) {
      setFormError(errMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmPayment() {
    if (!detail) return;
    setConfirming(true);
    try {
      const updated = await api<InvoiceDetail>(`/v1/invoices/${detail.publicId}/confirm-payment`, { method: "POST" });
      setDetail(updated);
      setConfirmOpen(false);
      toast("Ditandai dibayar oleh merchant.", "success");
      await load();
    } catch (err) {
      toast(errMessage(err), "error");
    } finally {
      setConfirming(false);
    }
  }

  async function copyId(publicId: string) {
    const ok = await copyText(publicId);
    toast(ok ? "ID invoice disalin." : "Gagal menyalin ID invoice.", ok ? "success" : "error");
  }

  const showPanel = creating || !!detail;
  const typed = digitsOnly(amount);

  return (
    <div className={showPanel ? "split" : undefined}>
      <section className="card">
        <div className="card-head">
          <h2>
            <InvoiceIcon size={24} />
            Invoice
          </h2>
          <button type="button" className="btn btn-primary btn-sm" onClick={openCreate} disabled={creating}>
            <PlusIcon size={16} />
            Buat invoice
          </button>
        </div>
        <p className="help">Tagihan dengan nominal tetap. Status &quot;dibayar&quot; selalu dikonfirmasi manual oleh merchant.</p>

        {listError && (
          <p className="alert" role="alert">
            {listError}
          </p>
        )}

        {loading ? (
          <div>
            <div className="skel" />
            <div className="skel" />
            <div className="skel" />
          </div>
        ) : items.length === 0 ? (
          <div className="empty-state">
            <InvoiceIcon size={34} />
            <p>Belum ada invoice. Buat yang pertama untuk mulai menagih.</p>
            <button type="button" className="btn btn-accent btn-sm" onClick={openCreate}>
              <PlusIcon size={16} />
              Buat invoice
            </button>
          </div>
        ) : (
          <ul className="list">
            {items.map((inv) => (
              <li key={inv.id} className="row row-tx" aria-current={detail?.publicId === inv.publicId ? "true" : undefined}>
                <span className="row-ico" aria-hidden="true">
                  <InvoiceIcon size={22} />
                </span>
                <div className="row-main">
                  <div className="row-title">
                    <span className="mono-id">{inv.publicId}</span>
                    <StatusPill status={inv.status} label={STATUS_LABEL[inv.status]} />
                  </div>
                  <div className="row-meta">
                    {inv.qris.displayName} · {inv.qris.provider.name}
                    {inv.description ? ` · ${inv.description}` : ""}
                  </div>
                  <div className="row-meta">
                    {inv.status === "PENDING" ? `Kedaluwarsa ${fmtDate(inv.expiresAt)}` : `Dibuat ${fmtDate(inv.createdAt)}`}
                  </div>
                </div>
                <span className="row-amount">{rupiah(inv.amount)}</span>
                <button
                  type="button"
                  className="icon-btn icon-btn-ghost row-go"
                  aria-label={`Lihat detail ${inv.publicId}`}
                  onClick={() => void openDetail(inv.publicId)}
                >
                  <ChevronRightIcon size={18} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {creating && (
        <section className="card fade-in" ref={panelRef}>
          <div className="card-head">
            <h2>
              <SparkIcon size={24} />
              Invoice baru
            </h2>
            <button type="button" className="icon-btn icon-btn-ghost" aria-label="Tutup" onClick={() => setCreating(false)}>
              <XIcon size={18} />
            </button>
          </div>
          <p className="help">QR yang dihasilkan hanya alat tagih — bukan bukti pembayaran.</p>

          <form onSubmit={submit} noValidate>
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
                Deskripsi <span className="opt">Opsional</span>
              </span>
              <input className="input" maxLength={200} placeholder="Kopi susu 2 gelas" value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>

            <div className="field">
              <span className="label">QRIS</span>
              <div className="select-wrap">
                <CardIcon size={20} />
                <select className="select" aria-label="Pilih QRIS" value={qrisId} onChange={(e) => setQrisId(e.target.value)}>
                  <option value="">Pilih QRIS…</option>
                  {qrisList.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.displayName} · {q.provider.name}
                    </option>
                  ))}
                </select>
              </div>
              {qrisError && (
                <p className="alert" role="alert">
                  {qrisError}
                </p>
              )}
            </div>

            <div className="field">
              <span className="label" id="invoice-expiry-label">
                Berlaku sampai
              </span>
              <div className="chips tight" role="group" aria-labelledby="invoice-expiry-label">
                {EXPIRY_PRESETS.map((p) => (
                  <button key={p.value} type="button" className="chip" aria-pressed={expiry === p.value} onClick={() => setExpiry(p.value)}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {formError && (
              <p className="alert" role="alert">
                {formError}
              </p>
            )}

            <button type="submit" className="btn btn-primary btn-block" disabled={submitting} style={{ marginTop: 18 }}>
              <SparkIcon size={18} />
              {submitting ? "Membuat…" : "Buat invoice + QR"}
            </button>
          </form>
        </section>
      )}

      {detailLoading && !detail && !creating && (
        <section className="card">
          <div className="skel" />
          <div className="skel" />
        </section>
      )}

      {detail && !creating && (
        <section className="card fade-in" ref={panelRef}>
          <div className="card-head">
            <h2>
              <InvoiceIcon size={24} />
              Detail invoice
            </h2>
            <div className="head-actions">
              <StatusPill status={detail.status} label={STATUS_LABEL[detail.status]} />
              <button type="button" className="icon-btn icon-btn-ghost" aria-label="Tutup" onClick={() => setDetail(null)}>
                <XIcon size={18} />
              </button>
            </div>
          </div>

          {detail.qrUrl ? (
            <div className="qr-frame">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={detail.qrUrl} alt={`QR invoice ${detail.publicId}`} />
            </div>
          ) : (
            <p className="empty">QR tidak tersedia.</p>
          )}

          <div className="result-amount">{rupiah(detail.amount)}</div>

          <dl className="kv">
            <div>
              <dt>ID</dt>
              <dd className="small mono">{detail.publicId}</dd>
            </div>
            <div>
              <dt>QRIS</dt>
              <dd>
                {detail.qris.displayName} · {detail.qris.provider.name}
              </dd>
            </div>
            {detail.description && (
              <div>
                <dt>Deskripsi</dt>
                <dd>{detail.description}</dd>
              </div>
            )}
            <div>
              <dt>Dibuat</dt>
              <dd>{fmtDate(detail.createdAt)}</dd>
            </div>
            <div>
              <dt>Kedaluwarsa</dt>
              <dd>{fmtDate(detail.expiresAt)}</dd>
            </div>
            {detail.paidAt && (
              <div>
                <dt>Dibayar</dt>
                <dd>{fmtDate(detail.paidAt)}</dd>
              </div>
            )}
            {detail.confirmedBy && (
              <div>
                <dt>Dikonfirmasi</dt>
                <dd>{detail.confirmedBy.email}</dd>
              </div>
            )}
          </dl>

          {confirmOpen ? (
            <div className="note-box">
              <p>
                <strong>Konfirmasi manual.</strong> Ini mencatat bahwa kamu (merchant) sudah menerima uangnya. Bukan verifikasi otomatis dari provider — pastikan dana benar-benar masuk dulu.
              </p>
              <div className="btn-row">
                <button type="button" className="btn btn-primary" onClick={() => void confirmPayment()} disabled={confirming}>
                  {confirming ? "Menyimpan…" : "Ya, sudah dibayar"}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setConfirmOpen(false)} disabled={confirming}>
                  Batal
                </button>
              </div>
            </div>
          ) : (
            <div className="btn-row">
              {detail.status === "PENDING" && (
                <button type="button" className="btn btn-primary" onClick={() => setConfirmOpen(true)}>
                  Tandai sudah dibayar
                </button>
              )}
              <button type="button" className="btn btn-secondary" onClick={() => void copyId(detail.publicId)}>
                <CopyIcon size={18} />
                Salin ID
              </button>
            </div>
          )}

          {detail.events.length > 0 && (
            <>
              <h3 className="sub-head">Riwayat</h3>
              <ul className="timeline">
                {detail.events.map((ev, i) => (
                  <li key={`${ev.type}-${i}`}>
                    <strong>{eventLabel(ev.type)}</strong>
                    <span className="row-meta">
                      {fmtDate(ev.createdAt)}
                      {ev.actorEmail ? ` · ${ev.actorEmail}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </div>
  );
}
