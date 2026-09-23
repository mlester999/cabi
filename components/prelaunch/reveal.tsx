"use client";

import { motion, useReducedMotion } from "motion/react";

/**
 * Gentle fade/slide entrance for a block of the prelaunch page.
 *
 * Motion is skipped entirely when the visitor prefers reduced motion, and the
 * animation only runs once per element, so scrolling never re-triggers work.
 */
export function Reveal({
  children,
  className = "",
  delay = 0,
  y = 14,
  as = "div",
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  as?: "div" | "section" | "li";
}) {
  const reduced = useReducedMotion();
  const Component = motion[as];

  if (reduced) return <div className={className}>{children}</div>;

  return (
    <Component
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </Component>
  );
}
