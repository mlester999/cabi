"use client";

import { MiniCabi } from "@/components/cabi/mini-cabi";
import { ParticleField, usePrefersReducedMotion } from "@/components/cabi/particle-field";
import { motion, useMotionTemplate, useMotionValue, useSpring, useTransform } from "motion/react";
import { useEffect, useRef, useState } from "react";

/**
 * Cabi's large hero presence on the prelaunch page.
 *
 * Everything here is presentation-layer only:
 * - a slow float plus a 1.7% breathing scale on the artwork,
 * - a breathing lavender aura and a light sweep travelling behind her,
 * - spring-smoothed perspective tilt and light that follow fine pointers,
 * - separated foreground, silhouette, aura, and shadow depth planes,
 * - a sparse field of rising sparkles.
 *
 * The character is always the owner-supplied official art (see `characterArt`
 * below). If it cannot load, the reserved space shows the official Cabi mascot
 * and a Cat Partner Unit label at the exact same size, so nothing shifts and no
 * broken image ever appears.
 * A different character is never substituted.
 */
/**
 * The official Cabi character render. `cabi-cpu-model.png` is the supplied
 * artwork; `cabi-main.png` is kept as a second candidate only so an owner who
 * uploads a higher-resolution main render gets it automatically. If neither
 * loads, the reserved space shows the official mini mascot and a Cat Partner
 * Unit label at the exact same size, so nothing shifts and no broken image ever
 * appears. A different character is never substituted.
 */
const characterArt = ["/assets/cabi-cpu-model.png", "/assets/cabi-main.png"] as const;

/**
 * Bounds of the *rendered* artwork inside its frame.
 *
 * The image uses `object-contain object-bottom`, so the drawn box is the natural
 * aspect ratio scaled to fit and then anchored to the bottom. This is used only
 * for pointer tracking, and it is measured against the untransformed layout box
 * (`offsetWidth`/`offsetHeight`) because a 3D-transformed `getBoundingClientRect`
 * is skewed by the rotate/perspective used for the depth effect.
 */
function getContainedArtBounds(frame: HTMLElement, image: HTMLImageElement | null) {
  const frameRect = frame.getBoundingClientRect();
  const frameWidth = frame.offsetWidth || frameRect.width;
  const frameHeight = frame.offsetHeight || frameRect.height;

  // Fall back to the square official render when the image has not decoded yet,
  // so the first pointer event is still tracked against the right box.
  const naturalWidth = image?.naturalWidth || 500;
  const naturalHeight = image?.naturalHeight || 500;
  const scale = Math.min(frameWidth / naturalWidth, frameHeight / naturalHeight);
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;

  return {
    left: frameRect.left + (frameWidth - width) / 2,
    right: frameRect.left + (frameWidth + width) / 2,
    top: frameRect.bottom - height,
    bottom: frameRect.bottom,
  };
}

export function CabiCharacter({ className = "", mood = "cozy" }: { className?: string; mood?: string }) {
  const [artIndex, setArtIndex] = useState(0);
  const artFailed = artIndex >= characterArt.length;
  const reduced = usePrefersReducedMotion();
  const frame = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);

  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const springX = useSpring(pointerX, { stiffness: 118, damping: 22, mass: 0.72 });
  const springY = useSpring(pointerY, { stiffness: 118, damping: 22, mass: 0.72 });
  const modelX = useTransform(springX, (value) => value * 12);
  const modelY = useTransform(springY, (value) => value * 8);
  const modelRotateY = useTransform(springX, (value) => value * 8.5);
  const modelRotateX = useTransform(springY, (value) => value * -6.5);
  const silhouetteX = useTransform(springX, (value) => value * -8);
  const silhouetteY = useTransform(springY, (value) => value * -5);
  const auraX = useTransform(springX, (value) => value * -20);
  const auraY = useTransform(springY, (value) => value * -14);
  const shadowX = useTransform(springX, (value) => value * 10);
  const shadowScale = useTransform(springY, (value) => 1 - value * 0.08);
  const lightX = useTransform(springX, (value) => `${50 + value * 34}%`);
  const lightY = useTransform(springY, (value) => `${50 + value * 34}%`);
  const sheen = useMotionTemplate`radial-gradient(ellipse 26% 19% at ${lightX} ${lightY}, rgba(255,255,255,.34) 0%, rgba(216,202,255,.15) 28%, rgba(167,139,250,.045) 52%, transparent 74%), linear-gradient(120deg, rgba(255,255,255,.07), transparent 42%, rgba(139,92,246,.055) 80%, transparent)`;

  useEffect(() => {
    if (reduced) {
      pointerX.jump(0);
      pointerY.jump(0);
      springX.jump(0);
      springY.jump(0);
      return;
    }
    if (typeof window.matchMedia !== "function") return;
    if (!window.matchMedia("(pointer: fine)").matches) return;
    const node = frame.current;
    if (!node) return;
    const onMove = (event: PointerEvent) => {
      const artBounds = getContainedArtBounds(node, image.current);
      const insideArt = event.clientX >= artBounds.left && event.clientX <= artBounds.right
        && event.clientY >= artBounds.top && event.clientY <= artBounds.bottom;
      if (!insideArt) {
        pointerX.set(0);
        pointerY.set(0);
        return;
      }
      const ratioX = (event.clientX - artBounds.left) / (artBounds.right - artBounds.left);
      const ratioY = (event.clientY - artBounds.top) / (artBounds.bottom - artBounds.top);
      pointerX.set(ratioX * 2 - 1);
      pointerY.set(ratioY * 2 - 1);
    };
    const onLeave = () => { pointerX.set(0); pointerY.set(0); };
    node.addEventListener("pointermove", onMove);
    node.addEventListener("pointerleave", onLeave);
    return () => {
      node.removeEventListener("pointermove", onMove);
      node.removeEventListener("pointerleave", onLeave);
    };
  }, [pointerX, pointerY, reduced, springX, springY]);

  return (
    <div
      ref={frame}
      className={`cabi-model-stage relative isolate select-none ${className}`}
      data-cabi-mood={mood}
      data-cabi-model="interactive"
    >
      <motion.div aria-hidden="true" style={{ x: auraX, y: auraY }} className="pointer-events-none absolute inset-0">
        <div className="cabi-glow absolute left-1/2 top-[42%] h-[86%] w-[86%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-500/[0.20] blur-[86px]" />
        <div className="absolute left-1/2 top-[30%] h-[46%] w-[62%] -translate-x-1/2 rounded-full bg-[var(--cabi-accent)]/[0.14] blur-[64px]" />
        <div className="absolute inset-x-[8%] bottom-[4%] h-[16%] rounded-[100%] bg-[var(--cabi-accent)]/[0.30] blur-[48px]" />
      </motion.div>

      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="cabi-sweep absolute left-1/2 top-[18%] h-[74%] w-[26%] -translate-x-1/2 rounded-full bg-gradient-to-b from-violet-200/25 via-violet-300/10 to-transparent blur-[34px]" />
      </div>

      <ParticleField className="z-10" />

      <motion.div
        aria-hidden="true"
        style={{ x: shadowX, scaleX: shadowScale }}
        className="absolute inset-x-[15%] bottom-[1.5%] z-10 h-[7%] rounded-[100%] bg-black/65 blur-[22px]"
      />

      <motion.div
        data-cabi-plane="model"
        style={{ x: modelX, y: modelY, rotateX: modelRotateX, rotateY: modelRotateY, transformPerspective: 1100 }}
        className="cabi-model-depth relative z-20 flex h-full w-full items-end justify-center will-change-transform"
      >
        <div className="cabi-float relative h-full w-full">
          <div className="cabi-breathe-slow cabi-model-depth relative flex h-full w-full items-end justify-center">
            {!artFailed ? (
              <>
                <motion.div
                  aria-hidden="true"
                  data-cabi-plane="silhouette"
                  style={{ x: silhouetteX, y: silhouetteY, z: -46 }}
                  className="pointer-events-none absolute inset-0 flex items-end justify-center opacity-[.22] blur-[18px] saturate-150"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={characterArt[artIndex]}
                    alt=""
                    width={1086}
                    height={1448}
                    decoding="async"
                    draggable={false}
                    className="h-full w-full scale-[.985] object-contain object-bottom"
                  />
                </motion.div>

                <motion.img
                  key={characterArt[artIndex]}
                  ref={image}
                  src={characterArt[artIndex]}
                  alt="Cabi, the purple Cat Partner Unit, getting ready"
                  width={1086}
                  height={1448}
                  decoding="async"
                  draggable={false}
                  onError={() => setArtIndex((value) => value + 1)}
                  style={{ z: 46 }}
                  className="cabi-model-image relative z-20 h-full w-full object-contain object-bottom drop-shadow-[0_38px_66px_rgba(0,0,0,.68)]"
                />

                <motion.div
                  aria-hidden="true"
                  data-cabi-plane="sheen"
                  style={{
                    background: sheen,
                    maskImage: `url(${characterArt[artIndex]})`,
                    WebkitMaskImage: `url(${characterArt[artIndex]})`,
                    z: 72,
                  }}
                  className="cabi-model-sheen pointer-events-none absolute inset-[3%] z-30 rounded-[42%]"
                />
              </>
            ) : (
              <CabiPlaceholder />
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

/**
 * Reserved-size fallback used only if no character artwork can be loaded. It
 * uses the official Cabi logo mark inside the shared orb treatment, so the
 * composition keeps its final proportions and never shows a broken image.
 */
function CabiPlaceholder() {
  return (
    <div className="relative flex h-full w-full items-end justify-center pb-[4%]">
      <div className="absolute left-1/2 top-[36%] h-[52%] w-[52%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-violet-300/[0.14]" />
      <div className="cabi-orbit absolute left-1/2 top-[36%] h-[66%] w-[66%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-violet-300/[0.12]" />
      <div className="relative flex flex-col items-center">
        <MiniCabi className="h-[104px] w-[104px] rounded-2xl sm:h-[132px] sm:w-[132px] sm:rounded-full" />
        <p className="mt-6 text-center text-[11px] font-semibold uppercase tracking-[.34em] text-[var(--cabi-primary)]/70">Cat Partner Unit</p>
        <p className="mt-2 max-w-[15rem] text-center text-[11px] leading-5 text-[var(--cabi-text-faint)]">
          Cabi&apos;s official artwork appears here as soon as it is uploaded.
        </p>
      </div>
    </div>
  );
}
