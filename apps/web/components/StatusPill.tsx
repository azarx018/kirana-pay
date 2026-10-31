type Tone = "ok" | "warn" | "bad" | "off" | "brand";

// PAID / SUCCESS / READY / ACTIVE = hijau, PENDING = kuning,
// FAILED = merah, EXPIRED / ARCHIVED / REVOKED = abu-abu.
const TONES: Record<string, Tone> = {
  READY: "ok",
  PAID: "ok",
  SUCCESS: "ok",
  ACTIVE: "ok",
  PENDING: "warn",
  FAILED: "bad",
  EXPIRED: "off",
  ARCHIVED: "off",
  REVOKED: "off",
};

export function StatusPill({ status, tone }: { status: string; tone?: Tone }) {
  const resolved = tone ?? TONES[status.toUpperCase()] ?? "off";
  return <span className={`pill pill-${resolved}`}>{status}</span>;
}
