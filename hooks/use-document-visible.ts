"use client";

import { useEffect, useState } from "react";

/**
 * Tracks `document.visibilityState`.
 *
 * The prelaunch page keeps a handful of looping decorative animations running.
 * While the tab is hidden there is nothing to look at, so callers pause them
 * instead of burning GPU/CPU on an invisible page.
 */
export function useDocumentVisible() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}
