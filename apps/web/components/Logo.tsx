import type { CSSProperties } from "react";

interface LogoProps {
  variant?: "full" | "mark" | "wordmark";
  /** Height of the whole lockup in px. */
  height?: number;
  className?: string;
}

/**
 * Kirana Pay logo, rendered with CSS masks so it always follows the theme
 * colour (ink in light mode, cream in dark mode).
 */
export function Logo({ variant = "full", height = 48, className = "" }: LogoProps) {
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
