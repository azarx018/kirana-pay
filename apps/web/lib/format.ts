const idr = new Intl.NumberFormat("id-ID");

export const rupiah = (n: number): string => "Rp" + idr.format(n);

export const digitsOnly = (s: string): string => s.replace(/\D/g, "");

export const formatAmountInput = (raw: string): string => {
  const d = digitsOnly(raw);
  return d ? idr.format(Number(d)) : "";
};

export const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
