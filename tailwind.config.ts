import type { Config } from "tailwindcss";

// PlayProof — "capture deck" identity.
// The product records human takes and stamps their provenance on-chain, so the
// interface is built like a recording deck: bone-on-graphite, a rec-red used
// only for live/recording, a phosphor-lime for verified signal, monospace for
// every machine reading (timecode, hash, counter).
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Surfaces — a dark edit-bay, faintly green-graphite, never blue-black.
        ink: "#0B0E0C", // deepest background
        panel: "#12150F", // wait — keep panels slightly warmer than ink
        panel2: "#171B14",
        deck: "#1A1F18", // raised equipment surface
        edge: "#2C332A", // seams / hairlines between panels
        rail: "#3A4236", // stronger divider / control outline

        // Type
        bone: "#E9E7DD", // primary text (film-leader off-white)
        muted: "#7E887A", // secondary labels (graphite)

        // Accents — each does ONE job.
        rec: "#FF3B30", // recording / live ONLY
        phosphor: "#C9F03C", // verified / good-take signal
        amber: "#F2B23E", // pending / awaiting

        // Back-compat aliases so existing classes re-skin in place.
        brand: "#C9F03C", // was purple → now phosphor signal
        brand2: "#9BD0E8", // cool readout accent (used sparingly)
        good: "#C9F03C",
        warn: "#F2B23E",
        bad: "#FF3B30",
      },
      fontFamily: {
        // Display/UI: a clean grotesque (Space Grotesk), stamped + tracked for
        // equipment-label headers. Mono: machine readings.
        sans: ["var(--font-grotesk)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-grotesk)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      letterSpacing: {
        stamp: "0.22em", // equipment-label tracking
      },
      borderRadius: {
        // Deck hardware is barely rounded — tight radii, not pill-soft cards.
        deck: "4px",
      },
      boxShadow: {
        // A thin lit seam, like backlit equipment, in phosphor.
        glow: "0 0 0 1px rgba(201,240,60,0.35), 0 1px 0 0 rgba(233,231,221,0.04) inset",
        rec: "0 0 0 1px rgba(255,59,48,0.5), 0 0 24px -6px rgba(255,59,48,0.5)",
        inset: "0 1px 0 0 rgba(233,231,221,0.05) inset, 0 -1px 0 0 rgba(0,0,0,0.4) inset",
      },
      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        recPulse: {
          "0%,100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.35", transform: "scale(0.82)" },
        },
        playhead: {
          "0%": { left: "0%" },
          "100%": { left: "100%" },
        },
        ticker: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
      },
      animation: {
        shimmer: "shimmer 2.4s linear infinite",
        recPulse: "recPulse 1.1s ease-in-out infinite",
        playhead: "playhead 6s linear infinite",
        ticker: "ticker 28s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
