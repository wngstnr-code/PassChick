"use client";

import { useEffect, useState } from "react";

export function LoadingScreen() {
  const [visible, setVisible] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem("passchick-loaded")) return;
    sessionStorage.setItem("passchick-loaded", "1");
    setVisible(true);

    const fadeTimer = setTimeout(() => setFadeOut(true), 1800);
    const hideTimer = setTimeout(() => setVisible(false), 2400);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
    };
  }, []);

  if (!visible) return null;

  return (
    <div className={`loading-screen${fadeOut ? " loading-screen-out" : ""}`}>
      <div className="loading-logo">
        <img src="/favicon.png" alt="PassChick" className="loading-logo-img" />
        <div className="loading-wordmark">
          <span className="loading-egg">PASS</span>
          <span className="loading-rest">CHICK</span>
        </div>
      </div>
      <div className="loading-bar-track">
        <div className="loading-bar-fill" />
      </div>
    </div>
  );
}
