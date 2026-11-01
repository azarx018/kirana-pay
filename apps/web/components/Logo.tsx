import type { CSSProperties } from "react";

interface LogoProps {
  /**
   * full     = mark + divider + wordmark (login)
   * compact  = mark + wordmark, no divider (sidebar / top bar)
   * mark     = illustration only
   * wordmark = text only
   */
  variant?: "full" | "compact" | "mark" | "wordmark";
  /** Height of the whole lockup in px. */
  height?: number;
  className?: string;
}

/**
 * Kirana Pay logo, drawn with CSS masks so it stays plain black / white and
 * follows the theme through the --logo variable (ink on light surfaces,
 * ivory on dark ones and in the sidebar).
 */
export function Logo({ variant = "compact", height = 48, className = "" }: LogoProps) {
  const style = { "--h": `${height}px` } as CSSProperties;
  const cls = `logo logo-${variant} ${className}`.trim();

  return (
    <span className={cls} style={style} role="img" aria-label="Kirana Pay">
      {variant !== "wordmark" && <span className="logo-mark" />}
      {variant === "full" && <span className="logo-divider" />}
      {variant !== "mark" && <span className="logo-word" />}
    </span>
  );
}
