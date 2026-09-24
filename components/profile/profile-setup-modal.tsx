"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

/**
 * Mandatory profile setup.
 *
 * Shown once, immediately after a wallet authenticates for the first time. The
 * account cannot use the social or ranked features until a username is claimed,
 * because the leaderboard must never fall back to displaying a wallet address.
 *
 * The avatar is optional and skipped by default: without one the product renders
 * CSS initials, so nobody is forced to upload a picture to get in.
 *
 * Guest chat is completely unaffected - this only mounts for a wallet session
 * that has no `profile_completed_at`.
 */
export function ProfileSetupModal({ open, suggestedName, onComplete }: {
  open: boolean;
  suggestedName?: string | null;
  onComplete: (profile: { username: string; displayName: string | null; initials: string | null }) => void;
}) {
  const [username, setUsername] = useState(suggestedName ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    // Focus the field so a keyboard user can type immediately. The error message
    // is cleared on edit and on submit rather than here, so mounting the modal
    // does not cascade an extra render.
    const timer = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => window.clearTimeout(timer);
  }, [open]);

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string; profile?: { username: string; displayName: string | null; initials: string | null } };
      if (!response.ok || !payload.ok || !payload.profile) {
        setError(payload.error ?? "That name could not be saved.");
        return;
      }
      onComplete(payload.profile);
    } catch {
      setError("That name could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-black/80 p-4 backdrop-blur-md"
          // A modal dialog with its own heading, so assistive tech announces the
          // purpose rather than reading an unlabelled overlay.
          role="dialog"
          aria-modal="true"
          aria-labelledby="profile-setup-title"
        >
          <motion.div
            initial={{ opacity: 0, y: 16, scale: .97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 220, damping: 26 }}
            className="glass w-full max-w-[440px] rounded-2xl p-6 sm:p-7"
          >
            <h2 id="profile-setup-title" className="text-lg font-bold tracking-[-0.01em] text-white">Welcome to Cabi.</h2>
            <p className="mt-2 text-sm leading-7 text-[var(--cabi-text-secondary)]">
              Before we keep going, what should I call you?
            </p>

            <label className="mt-5 block">
              <span className="text-[11px] font-semibold uppercase tracking-[.14em] text-[var(--cabi-text-muted)]">Your name</span>
              <input
                ref={inputRef}
                value={username}
                onChange={(event) => { setUsername(event.target.value); setError(""); }}
                onKeyDown={(event) => { if (event.key === "Enter") void submit(); }}
                placeholder="mark"
                autoComplete="off"
                spellCheck={false}
                maxLength={20}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "profile-setup-error" : "profile-setup-hint"}
                className="focus-ring mt-2 h-12 w-full rounded-2xl border border-[var(--cabi-border)] bg-[var(--cabi-surface-2)] px-4 text-sm text-white placeholder:text-[var(--cabi-text-faint)]"
              />
            </label>

            <p id="profile-setup-hint" className="mt-2 text-[11px] leading-5 text-[var(--cabi-text-faint)]">
              3 to 20 characters. Letters, numbers, hyphens and underscores. This is the name shown on the leaderboard, so it needs to be yours.
            </p>

            {error ? (
              <p id="profile-setup-error" role="alert" className="mt-2 text-[12px] font-medium text-rose-300">{error}</p>
            ) : null}

            <p className="mt-4 text-[11px] leading-5 text-[var(--cabi-text-faint)]">
              No photo needed. I will use your initials until you add one.
            </p>

            <button
              type="button"
              onClick={() => void submit()}
              disabled={saving || username.trim().length === 0}
              className="focus-ring mt-5 inline-flex h-12 w-full items-center justify-center rounded-2xl bg-violet-300 text-sm font-bold text-[var(--cabi-on-primary)] transition hover:bg-[var(--cabi-primary)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? "Saving that..." : "Continue"}
            </button>

            <p className="mt-3 text-center text-[11px] text-[var(--cabi-text-faint)]">
              I never ask for your private key or seed phrase.
            </p>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}