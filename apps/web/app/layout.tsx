import type { Metadata, Viewport } from "next";
import { DM_Serif_Display, Plus_Jakarta_Sans } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

// Plus Jakarta Sans: dashboard, navigasi, tabel, form.
const sans = Plus_Jakarta_Sans({ subsets: ["latin"], display: "swap", variable: "--font-sans-loaded" });
// DM Serif Display: heading & halaman login.
const serif = DM_Serif_Display({ subsets: ["latin"], weight: "400", display: "swap", variable: "--font-serif-loaded" });

export const metadata: Metadata = {
  title: "Kirana Pay",
  description: "Ubah QRIS statis jadi QR dengan nominal tetap.",
  icons: { icon: "/brand/favicon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f6f3" },
    { media: "(prefers-color-scheme: dark)", color: "#121212" },
  ],
};

// Sets data-theme before first paint so there is no light/dark flash.
const themeScript = `(function(){try{var t=localStorage.getItem('kp-theme');if(!t){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t}catch(e){}})()`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id" className={`${sans.variable} ${serif.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
