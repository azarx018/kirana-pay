import type { SVGProps } from "react";

type IconProps = { size?: number };

const base = (size: number): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
});

export const QrIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
    <path d="M14 14h3v3h-3zM20.5 14v3.5M17 20.5h3.5" />
  </svg>
);

export const CardIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
    <path d="M3 10h18M7 15h4" />
  </svg>
);

export const SlidersIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="8" cy="17" r="2" />
  </svg>
);

export const LogoutIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M9 4H6.5A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20H9M15 8l4 4-4 4M19 12H9" />
  </svg>
);

export const SunIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
  </svg>
);

export const MoonIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
  </svg>
);

export const CopyIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
    <path d="M15.5 8.5V6.5A2.5 2.5 0 0 0 13 4H6.5A2.5 2.5 0 0 0 4 6.5V13A2.5 2.5 0 0 0 6.5 15.5h2" />
  </svg>
);

export const UploadIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M12 16V4M7 9l5-5 5 5M4.5 15v2.5A2.5 2.5 0 0 0 7 20h10a2.5 2.5 0 0 0 2.5-2.5V15" />
  </svg>
);

export const DownloadIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M12 4v12M7 11l5 5 5-5M4.5 15v2.5A2.5 2.5 0 0 0 7 20h10a2.5 2.5 0 0 0 2.5-2.5V15" />
  </svg>
);

export const SparkIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
    <path d="M19 15v4M17 17h4" />
  </svg>
);

export const CheckBadgeIcon = ({ size = 26 }: IconProps) => (
  <svg className="check-badge" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="11" fill="currentColor" />
    <path
      d="M7.5 12.5l3 3 6-6.5"
      fill="none"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ stroke: "var(--surface)" }}
    />
  </svg>
);

export const ClockIcon = ({ size = 24 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);

export const RefreshIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" />
  </svg>
);

export const ChevronRightIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="m9 6 6 6-6 6" />
  </svg>
);

export const MoreIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="5.5" r="1.3" fill="currentColor" />
    <circle cx="12" cy="12" r="1.3" fill="currentColor" />
    <circle cx="12" cy="18.5" r="1.3" fill="currentColor" />
  </svg>
);
