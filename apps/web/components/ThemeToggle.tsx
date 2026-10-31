"use client";

import { useEffect, useState } from "react";
import { MoonIcon, SunIcon } from "./icons";

export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.dataset.theme === "dark");
  }, []);

  function toggle() {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("kp-theme", next);
    } catch {
      /* storage unavailable */
    }
    setDark(!dark);
  }

  const label = dark ? "Pakai mode terang" : "Pakai mode gelap";
  return (
    <button type="button" className="icon-btn" onClick={toggle} aria-label={label} title={label}>
      {dark ? <SunIcon size={18} /> : <MoonIcon size={18} />}
    </button>
  );
}
