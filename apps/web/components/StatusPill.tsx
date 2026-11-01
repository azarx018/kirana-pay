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

interface Props {
  status: string;
  /** Override the tone (e.g. "brand" for role badges). */
  tone?: Tone;
  /** Human label shown instead of the raw status code. */
  label?: string;
}

export function StatusPill({ status, tone, label }: Props) {
  const resolved = tone ?? TONES[status.toUpperCase()] ?? "off";
  return <span className={`pill pill-${resolved}`}>{label ?? status}</span>;
}
