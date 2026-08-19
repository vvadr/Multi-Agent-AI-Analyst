"use client";

import { useEffect, useRef } from "react";

/**
 * The ambient layer behind the whole app.
 *
 * The drifting shapes are document *chunks*: this product splits an uploaded
 * file into indexed pieces and retrieves them by similarity, so the background
 * depicts that index rather than a generic particle field. Every few seconds
 * one lights up in a stage hue — a chunk being retrieved.
 *
 * It is decorative and marked `aria-hidden`. The canvas idles when the tab is
 * hidden and renders a single static frame when the reader has asked for
 * reduced motion, so it never spends a frame it was not asked for.
 */

interface Chunk {
  x: number;
  y: number;
  /** 0.35–1. Drives size, opacity, and parallax strength together. */
  depth: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  lines: number;
  /** 0 when dormant; decays to 0 after the chunk is "retrieved". */
  glow: number;
  glowColor: string;
}

/**
 * Deliberately sparse. At the density this started out (26) the chunks read as
 * a busy pattern competing with the content rather than as depth behind it,
 * and clusters of them landed under the sign-in card.
 */
const CHUNK_COUNT = 15;
const MAX_DPR = 2;

/** Read the live theme values so the canvas matches the active palette. */
function readPalette() {
  const styles = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback;
  return {
    ink: get("--ink", "#e9ecf7"),
    stages: [
      get("--stage-supervisor", "#8b6bff"),
      get("--stage-agent", "#22d3ee"),
      get("--stage-review", "#ffb74d"),
      get("--stage-answer", "#34e5a0"),
    ],
  };
}

export function AmbientField() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let palette = readPalette();
    let width = 0;
    let height = 0;
    let chunks: Chunk[] = [];
    let frame = 0;
    let lastRetrieval = 0;

    // Where the parallax is now, and where the pointer wants it to be. The gap
    // between them is what makes the motion feel weighted rather than glued.
    const parallax = { x: 0, y: 0, targetX: 0, targetY: 0 };

    const seed = () => {
      chunks = Array.from({ length: CHUNK_COUNT }, () => {
        const depth = 0.35 + Math.random() * 0.65;
        return {
          x: Math.random() * width,
          y: Math.random() * height,
          depth,
          w: (52 + Math.random() * 78) * depth,
          h: (34 + Math.random() * 52) * depth,
          vx: (Math.random() - 0.5) * 0.16 * depth,
          vy: (Math.random() - 0.5) * 0.16 * depth,
          rot: (Math.random() - 0.5) * 0.5,
          vr: (Math.random() - 0.5) * 0.0009,
          lines: 2 + Math.floor(Math.random() * 3),
          glow: 0,
          glowColor: palette.stages[0],
        };
      });
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (chunks.length === 0) seed();
    };

    const drawChunk = (chunk: Chunk) => {
      const px = chunk.x + parallax.x * chunk.depth * 34;
      const py = chunk.y + parallax.y * chunk.depth * 34;

      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(chunk.rot);

      const base = 0.032 + chunk.depth * 0.042;
      ctx.globalAlpha = base + chunk.glow * 0.5;
      ctx.strokeStyle = chunk.glow > 0.01 ? chunk.glowColor : palette.ink;
      ctx.lineWidth = 1;

      if (chunk.glow > 0.01) {
        ctx.shadowColor = chunk.glowColor;
        ctx.shadowBlur = 26 * chunk.glow;
      }

      ctx.beginPath();
      ctx.roundRect(-chunk.w / 2, -chunk.h / 2, chunk.w, chunk.h, 6 * chunk.depth);
      ctx.stroke();

      // The "text" inside the chunk, which is what makes it read as a document
      // fragment rather than a rectangle.
      ctx.shadowBlur = 0;
      ctx.globalAlpha = (base + chunk.glow * 0.4) * 0.75;
      const gap = chunk.h / (chunk.lines + 1);
      for (let i = 1; i <= chunk.lines; i += 1) {
        const y = -chunk.h / 2 + gap * i;
        const inset = chunk.w * 0.16;
        const len = (chunk.w - inset * 2) * (i === chunk.lines ? 0.55 : 1);
        ctx.beginPath();
        ctx.moveTo(-chunk.w / 2 + inset, y);
        ctx.lineTo(-chunk.w / 2 + inset + len, y);
        ctx.stroke();
      }

      ctx.restore();
    };

    const render = (now: number) => {
      ctx.clearRect(0, 0, width, height);

      parallax.x += (parallax.targetX - parallax.x) * 0.045;
      parallax.y += (parallax.targetY - parallax.y) * 0.045;

      // Light up one chunk periodically: a retrieval landing on an index entry.
      if (now - lastRetrieval > 2400 && chunks.length > 0) {
        lastRetrieval = now;
        const target = chunks[Math.floor(Math.random() * chunks.length)];
        target.glow = 1;
        target.glowColor =
          palette.stages[Math.floor(Math.random() * palette.stages.length)];
      }

      for (const chunk of chunks) {
        chunk.x += chunk.vx;
        chunk.y += chunk.vy;
        chunk.rot += chunk.vr;
        chunk.glow *= 0.986;

        // Wrap with a margin so a chunk never visibly pops at the edge.
        const margin = 140;
        if (chunk.x < -margin) chunk.x = width + margin;
        if (chunk.x > width + margin) chunk.x = -margin;
        if (chunk.y < -margin) chunk.y = height + margin;
        if (chunk.y > height + margin) chunk.y = -margin;

        drawChunk(chunk);
      }

      frame = requestAnimationFrame(render);
    };

    const renderStaticFrame = () => {
      ctx.clearRect(0, 0, width, height);
      for (const chunk of chunks) drawChunk(chunk);
    };

    const start = () => {
      cancelAnimationFrame(frame);
      if (reduceMotion.matches) renderStaticFrame();
      else frame = requestAnimationFrame(render);
    };

    const stop = () => cancelAnimationFrame(frame);

    const onPointerMove = (event: PointerEvent) => {
      parallax.targetX = (event.clientX / window.innerWidth - 0.5) * 2;
      parallax.targetY = (event.clientY / window.innerHeight - 0.5) * 2;
    };

    const onResize = () => {
      resize();
      if (reduceMotion.matches) renderStaticFrame();
    };

    const onVisibility = () => (document.hidden ? stop() : start());

    const onThemeChange = () => {
      palette = readPalette();
      if (reduceMotion.matches) renderStaticFrame();
    };

    resize();
    start();

    window.addEventListener("resize", onResize);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    reduceMotion.addEventListener("change", start);

    // The toggle writes `data-theme` on <html>; the canvas has to re-read its
    // colours when it does, since it holds resolved values rather than vars.
    const themeObserver = new MutationObserver(onThemeChange);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", onThemeChange);

    return () => {
      stop();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("visibilitychange", onVisibility);
      reduceMotion.removeEventListener("change", start);
      scheme.removeEventListener("change", onThemeChange);
      themeObserver.disconnect();
    };
  }, []);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden grain"
      style={{ opacity: "var(--ambient-opacity)" }}
    >
      {/* Aurora wash. CSS gradients rather than canvas blur: the GPU composites
          these for free, where a blurred canvas costs a full repaint. */}
      <div
        className="animate-drift absolute -top-1/3 -left-1/4 h-[85vh] w-[85vh] rounded-full blur-[120px]"
        style={{
          background:
            "radial-gradient(circle, color-mix(in oklab, var(--stage-supervisor) 34%, transparent), transparent 68%)",
        }}
      />
      <div
        className="animate-drift absolute top-1/4 -right-1/4 h-[75vh] w-[75vh] rounded-full blur-[120px]"
        style={{
          background:
            "radial-gradient(circle, color-mix(in oklab, var(--stage-agent) 26%, transparent), transparent 68%)",
          animationDelay: "-9s",
        }}
      />
      <div
        className="animate-drift absolute -bottom-1/3 left-1/3 h-[70vh] w-[70vh] rounded-full blur-[120px]"
        style={{
          background:
            "radial-gradient(circle, color-mix(in oklab, var(--stage-answer) 22%, transparent), transparent 68%)",
          animationDelay: "-17s",
        }}
      />
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  );
}
