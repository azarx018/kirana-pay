"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errMessage, jsonInit } from "@/lib/api";
import { digitsOnly, fmtDate, formatAmountInput, rupiah } from "@/lib/format";
import type { Invoice, InvoiceDetail, InvoiceList, Qris } from "@/lib/types";
import { useToast } from "./Toast";

const EXPIRY_PRESETS = [
  { label: "15 menit", value: 15 },
  { label: "1 jam", value: 60 },
  { label: "6 jam", value: 360 },
  { label: "24 jam", value: 1440 },
  { label: "7 hari", value: 10080 },
];

const STATUS_LABEL: Record<Invoice["status"], string> = {
  PENDING: "Menunggu",
  PAID: "Dibayar",
  EXPIRED: "Kedaluwarsa",
};

const STATUS_CLASS: Record<Invoice["status"], string> = {
  PENDING: "pill pill-pending",
  PAID: "pill pill-paid",
  EXPIRED: "pill muted",
};

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

  const openDetail = useCallback(async (publicId: string) => {
    setDetailLoading(true);
    setConfirmOpen(false);
    try {
      setDetail(await api<InvoiceDetail>(`/v1/invoices/${publicId}`));
    } catch (err) {
      toast(errMessage(err), "error");
    } finally {
      setDetailLoading(false);
    }
  }, [toast]);

  async function submit(e: React.FormEvent) {
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
      const updated = await api<InvoiceDetail>(
        `/v1/invoices/${detail.publicId}/confirm-payment`,
        { method: "POST" },
      );
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

  const showPanel = creating || !!detail;

  return (
    <div className={showPanel ? "split" : undefined}>
      <section className="card">
        <div className="card-head">
          <div>
            <h2>Invoice</h2>
            <p className="hint">Tagihan dengan nominal tetap. Status &quot;dibayar&quot; selalu dikonfirmasi manual oleh merchant.</p>
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={openCreate} disabled={creating}>
            + Buat invoice
          </button>
        </div>

        {listError && <div className="alert">{listError}</div>}

        {loading ? (
          <div>
            <div className="skel" />
            <div className="skel" />
            <div className="skel" />
          </div>
        ) : items.length === 0 ? (
          <div className="empty">Belum ada invoice. Buat yang pertama untuk mulai menagih.</div>
        ) : (
          <ul className="list">
            {items.map((inv) => (
              <li key={inv.id} className="row">
                <div className="row-main">
                  <div className="row-title">
                    <span className="mono">{inv.publicId}</span>
                    <span className={STATUS_CLASS[inv.status]}>{STATUS_LABEL[inv.status]}</span>
                  </div>
                  <div className="row-meta">
                    {inv.qris.displayName} · {inv.qris.provider.name}
                    {inv.description ? ` · ${inv.description}` : ""}
                  </div>
                  <div className="row-meta">
                    {inv.status === "PENDING" ? `Kedaluwarsa ${fmtDate(inv.expiresAt)}` : `Dibuat ${fmtDate(inv.createdAt)}`}
                  </div>
                </div>
                <div className="row-actions">
                  <span className="row-amount">{rupiah(inv.amount)}</span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void openDetail(inv.publicId)}>
                    Detail
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {creating && (
        <section className="card fade-in">
          <div className="card-head">
            <div>
              <h2>Invoice baru</h2>
              <p className="hint">QR yang dihasilkan hanya alat tagih — bukan bukti pembayaran.</p>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCreating(false)}>
              Tutup
            </button>
          </div>

          <form onSubmit={submit}>
            <label className="field">
              <span className="label">Nominal (Rp)</span>
              <input
                className="input"
                inputMode="numeric"
                placeholder="25.000"
                value={amount}
                onChange={(e) => setAmount(formatAmountInput(e.target.value))}
                required
              />
            </label>

            <label className="field">
              <span className="label">Deskripsi (opsional)</span>
              <input
                className="input"
                maxLength={200}
                placeholder="Kopi susu 2 gelas"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>

            <label className="field">
              <span className="label">QRIS</span>
              <select className="select" value={qrisId} onChange={(e) => setQrisId(e.target.value)} required>
                <option value="">Pilih QRIS…</option>
                {qrisList.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.displayName} — {q.provider.name}
                  </option>
                ))}
              </select>
            </label>
            {qrisError && <div className="alert">{qrisError}</div>}

            <label className="field">
              <span className="label">Berlaku sampai</span>
              <select className="select" value={expiry} onChange={(e) => setExpiry(Number(e.target.value))}>
                {EXPIRY_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>

            {formError && <div className="alert">{formError}</div>}

            <div className="btn-row">
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? "Membuat…" : "Buat invoice + QR"}
              </button>
            </div>
          </form>
        </section>
      )}

      {detailLoading && !detail && (
        <section className="card">
          <div className="skel" />
          <div className="skel" />
        </section>
      )}

      {detail && !creating && (
        <section className="card fade-in">
          <div className="card-head">
            <div>
              <h2 className="mono">{detail.publicId}</h2>
              <p className="hint">
                <span className={STATUS_CLASS[detail.status]}>{STATUS_LABEL[detail.status]}</span>{" "}
                {detail.status === "PAID" ? "— dikonfirmasi manual oleh merchant" : ""}
              </p>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDetail(null)}>
              Tutup
            </button>
          </div>

          {detail.qrUrl ? (
            <div className="qr-frame">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={detail.qrUrl} alt={`QR invoice ${detail.publicId}`} />
            </div>
          ) : (
            <div className="empty">QR tidak tersedia.</div>
          )}

          <dl className="kv">
            <div>
              <dt>Nominal</dt>
              <dd>{rupiah(detail.amount)}</dd>
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
                <dt>Dikonfirmasi oleh</dt>
                <dd>{detail.confirmedBy.email}</dd>
              </div>
            )}
          </dl>

          {detail.status === "PENDING" && !confirmOpen && (
            <button type="button" className="btn btn-primary btn-block" onClick={() => setConfirmOpen(true)}>
              Tandai sudah dibayar
            </button>
          )}

          {confirmOpen && (
            <div className="note-box">
              <p>
                <strong>Konfirmasi manual.</strong> Ini mencatat bahwa kamu (merchant) sudah menerima uangnya.
                Bukan verifikasi otomatis dari provider — pastikan dana benar-benar masuk dulu.
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
          )}

          {detail.events.length > 0 && (
            <>
              <h3 className="label" style={{ marginTop: 22 }}>
                Riwayat
              </h3>
              <ul className="list">
                {detail.events.map((ev, i) => (
                  <li key={`${ev.type}-${i}`} className="row">
                    <div className="row-main">
                      <div className="row-title">{eventLabel(ev.type)}</div>
                      <div className="row-meta">
                        {fmtDate(ev.createdAt)}
                        {ev.actorEmail ? ` · ${ev.actorEmail}` : ""}
                      </div>
                    </div>
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

function eventLabel(type: "CREATED" | "PAYMENT_CONFIRMED" | "EXPIRED"): string {
  if (type === "CREATED") return "Invoice dibuat (menunggu pembayaran)";
  if (type === "PAYMENT_CONFIRMED") return "Ditandai dibayar oleh merchant";
  return "Kedaluwarsa";
}
