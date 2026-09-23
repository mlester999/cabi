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
 * The character is always owner-supplied art. The exact `cabi-main.png` supplied
 * by the owner is preferred, followed by the alternate dimensional render and
 * the CPU render as safe fallbacks. If none
 * exists, the reserved space shows a Cabi-branded
 * monogram stand-in at the exact same size, so nothing shifts and no broken
 * image ever appears.
 * A different character is never substituted.
 */
const characterArt = ["/assets/cabi-main.png", "/assets/cabi-main-3d.png", "/assets/cabi-cpu-model.png"] as const;

export function CabiCharacter({ className = "", mood = "cozy" }: { className?: string; mood?: string }) {
  const [artIndex, setArtIndex] = useState(0);
  const artFailed = artIndex >= characterArt.length;
  const reduced = usePrefersReducedMotion();
  const frame = useRef<HTMLDivElement>(null);

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
  const lightX = useTransform(springX, (value) => `${50 + value * 24}%`);
  const lightY = useTransform(springY, (value) => `${38 + value * 18}%`);
  const sheen = useMotionTemplate`radial-gradient(circle at ${lightX} ${lightY}, rgba(255,255,255,.24) 0%, rgba(216,202,255,.11) 13%, rgba(167,139,250,.035) 29%, transparent 48%)`;

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
      const bounds = node.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const ratioX = (event.clientX - bounds.left) / bounds.width - 0.5;
      const ratioY = (event.clientY - bounds.top) / bounds.height - 0.5;
      pointerX.set(Math.max(-1, Math.min(1, ratioX * 2)));
      pointerY.set(Math.max(-1, Math.min(1, ratioY * 2)));
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
        <div className="absolute left-1/2 top-[30%] h-[46%] w-[62%] -translate-x-1/2 rounded-full bg-[#8b5cf6]/[0.14] blur-[64px]" />
        <div className="absolute inset-x-[8%] bottom-[4%] h-[16%] rounded-[100%] bg-[#4c1d95]/[0.30] blur-[48px]" />
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
 * Reserved-size stand-in used only until the supplied artwork is added. It uses
 * the existing Cabi monogram component and a lavender aura, so the composition
 * keeps its final proportions and never shows a broken image.
 */
function CabiPlaceholder() {
  return (
    <div className="relative flex h-full w-full items-end justify-center pb-[4%]">
      <div className="absolute left-1/2 top-[36%] h-[52%] w-[52%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-violet-300/[0.14]" />
      <div className="cabi-orbit absolute left-1/2 top-[36%] h-[66%] w-[66%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-violet-300/[0.12]" />
      <div className="relative flex flex-col items-center">
        <MiniCabi className="h-[104px] w-[104px] rounded-[32px] sm:h-[132px] sm:w-[132px] sm:rounded-[40px]" />
        <p className="mt-6 text-center text-[11px] font-semibold uppercase tracking-[.34em] text-violet-300/70">Cat Partner Unit</p>
        <p className="mt-2 max-w-[15rem] text-center text-[11px] leading-5 text-[#625d6d]">
          Cabi&apos;s official artwork appears here as soon as it is uploaded.
        </p>
      </div>
    </div>
  );
}
