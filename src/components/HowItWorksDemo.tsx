import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Heart,
  ImageIcon,
  Mail,
  MapPin,
  MessageCircle,
  Mic,
  MonitorUp,
  MousePointerClick,
  Pause,
  Play,
  Send,
  Video as VideoIcon,
} from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";

/**
 * A coded, auto-advancing explainer for the landing page. Every scene is drawn
 * with divs + framer-motion (no image or video assets), so it never goes stale
 * against the real UI and costs nothing to ship. Used two ways: as a full modal
 * ({@link HowItWorksDemo}) and as a looping hero miniature ({@link HowItWorksMini}).
 */

type Step = {
  key: string;
  title: string;
  subtitle: string;
  duration: number;
  accent: string;
  Scene: React.ComponentType<{ compact?: boolean }>;
};

// A gradient avatar with initials — no photos needed.
const Face = memo(function Face({
  initials,
  from,
  to,
  speaking,
  muted,
  size = "md",
  label,
}: {
  initials: string;
  from: string;
  to: string;
  speaking?: boolean;
  muted?: boolean;
  size?: "sm" | "md" | "lg";
  label?: string;
}) {
  const dim = size === "lg" ? "h-16 w-16 text-xl" : size === "sm" ? "h-9 w-9 text-xs" : "h-12 w-12 text-base";
  return (
    <div className="relative flex flex-col items-center gap-1">
      <div className="relative">
        {speaking && (
          <motion.span
            className="absolute inset-0 rounded-full ring-2 ring-green-400"
            animate={{ scale: [1, 1.18, 1], opacity: [0.9, 0.2, 0.9] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
        <div className={cn("flex items-center justify-center rounded-full font-bold text-white shadow-md", dim)} style={{ backgroundImage: `linear-gradient(135deg, ${from}, ${to})` }}>
          {initials}
        </div>
        {muted && (
          <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 ring-2 ring-white">
            <Mic className="h-3 w-3 text-white" />
          </span>
        )}
      </div>
      {label && <span className="text-[10px] font-medium text-gray-500">{label}</span>}
    </div>
  );
});

function useTypewriter(text: string, active: boolean, speed = 55) {
  const [out, setOut] = useState("");
  useEffect(() => {
    if (!active) {
      setOut(text);
      return;
    }
    setOut("");
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setOut(text.slice(0, i));
      if (i >= text.length) clearInterval(id);
    }, speed);
    return () => clearInterval(id);
  }, [text, active, speed]);
  return out;
}

// ── Scene 1: distance ───────────────────────────────────────────────────────
const SceneDistance = memo(function SceneDistance() {
  return (
    <div className="relative flex h-full w-full items-center justify-between px-4 sm:px-10">
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5 }}
        className="flex flex-col items-center gap-2"
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-100 shadow-sm sm:h-16 sm:w-16">
          <MapPin className="h-7 w-7 text-blue-600" />
        </div>
        <p className="text-sm font-semibold text-gray-800">You</p>
        <p className="text-xs text-gray-500">Home</p>
      </motion.div>

      <div className="relative mx-2 flex-1">
        <svg viewBox="0 0 220 70" className="w-full" fill="none">
          <motion.path
            d="M8,55 Q110,-8 212,55"
            stroke="#93c5fd"
            strokeWidth="2.5"
            strokeDasharray="6 8"
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.1, ease: "easeInOut" }}
          />
        </svg>
        <motion.div
          className="absolute left-1/2 top-0 -translate-x-1/2"
          animate={{ scale: [1, 1.15, 1] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-rose-500 shadow-lg">
            <Heart className="h-5 w-5 fill-white text-white" />
          </div>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5, delay: 0.15 }}
        className="flex flex-col items-center gap-2"
      >
        <Face initials="G" from="#fb7185" to="#e11d48" size="lg" />
        <p className="text-sm font-semibold text-gray-800">Grandma</p>
        <p className="text-xs text-gray-500">200 miles away</p>
      </motion.div>
    </div>
  );
});

// ── Scene 2: create room + invite by email ──────────────────────────────────
const SceneInvite = memo(function SceneInvite({ compact }: { compact?: boolean }) {
  const email = useTypewriter("grandma@family.com", !compact);
  return (
    <div className="flex h-full w-full items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45 }}
        className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-4 shadow-xl sm:p-5"
      >
        <div className="mb-3 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600">
            <Mail className="h-4 w-4 text-white" />
          </div>
          <p className="text-sm font-semibold text-gray-900">Invite to Sunday Call</p>
        </div>
        <label className="mb-1 block text-[11px] font-medium text-gray-500">Email address</label>
        <div className="mb-3 flex h-9 items-center rounded-lg border border-gray-300 bg-gray-50 px-3 text-sm text-gray-800">
          {email}
          <motion.span className="ml-0.5 inline-block h-4 w-px bg-blue-500" animate={{ opacity: [1, 0] }} transition={{ duration: 0.6, repeat: Infinity }} />
        </div>
        <motion.div
          className="flex h-9 items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-semibold text-white shadow"
          animate={{ scale: [1, 0.96, 1] }}
          transition={{ duration: 0.5, delay: 1.6 }}
        >
          <Send className="h-4 w-4" /> Send invitation
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 2.1 }}
          className="mt-3 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2"
        >
          <Check className="h-4 w-4 text-green-600" />
          <span className="text-xs text-green-700">Link on its way to their inbox</span>
        </motion.div>
      </motion.div>
    </div>
  );
});

// ── Scene 3: one-click join (the differentiator) ─────────────────────────────
const SceneOneClick = memo(function SceneOneClick() {
  return (
    <div className="relative flex h-full w-full items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.45 }}
        className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-5 text-center shadow-xl"
      >
        <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Email · Just now</p>
        <p className="mt-1 text-sm font-semibold text-gray-900">You're invited to a video call</p>
        <p className="mt-1 text-xs text-gray-500">Tap the button — that's all.</p>

        <div className="relative mt-4">
          <motion.div
            className="mx-auto flex h-11 w-40 items-center justify-center gap-2 rounded-xl bg-blue-600 text-sm font-semibold text-white shadow-lg"
            animate={{ scale: [1, 1, 0.94, 1] }}
            transition={{ duration: 2, times: [0, 0.7, 0.8, 1] }}
          >
            <VideoIcon className="h-4 w-4" /> Join the call
          </motion.div>
          <motion.div
            className="absolute left-1/2 top-1/2"
            initial={{ x: 60, y: 34, opacity: 0 }}
            animate={{ x: [60, 0, 0], y: [34, 4, 4], opacity: [0, 1, 1] }}
            transition={{ duration: 1.6, times: [0, 0.8, 1] }}
          >
            <MousePointerClick className="h-5 w-5 text-gray-700 drop-shadow" />
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 2.2 }}
          className="mt-4 flex items-center justify-center gap-2 text-green-600"
        >
          <Check className="h-4 w-4" />
          <span className="text-sm font-semibold">Connected</span>
        </motion.div>

        <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
          {["No download", "No account", "Any browser"].map((t) => (
            <span key={t} className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-semibold text-blue-700">{t}</span>
          ))}
        </div>
      </motion.div>
    </div>
  );
});

// ── Scene 4: sit down together (the call) ────────────────────────────────────
const SceneCall = memo(function SceneCall() {
  const controls = [
    { icon: Mic, on: "bg-gray-700" },
    { icon: VideoIcon, on: "bg-gray-700" },
    { icon: MonitorUp, on: "bg-blue-600" },
    { icon: MessageCircle, on: "bg-gray-700" },
  ];
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-4">
      <div className="grid w-full max-w-md grid-cols-2 gap-2">
        {[
          { i: "You", f: "#60a5fa", t: "#2563eb", speaking: false },
          { i: "G", f: "#fb7185", t: "#e11d48", speaking: true },
          { i: "M", f: "#a78bfa", t: "#7c3aed", speaking: false },
          { i: "D", f: "#34d399", t: "#059669", speaking: false },
        ].map((p, idx) => (
          <motion.div
            key={p.i}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: idx * 0.12 }}
            className="flex aspect-video items-center justify-center rounded-xl bg-gradient-to-br from-gray-800 to-gray-900"
          >
            <Face initials={p.i} from={p.f} to={p.t} speaking={p.speaking} muted={idx === 2} />
          </motion.div>
        ))}
      </div>
      <div className="flex items-center gap-2 rounded-full bg-gray-900 px-3 py-2 shadow-lg">
        {controls.map((c, idx) => (
          <motion.div
            key={idx}
            className={cn("flex h-8 w-8 items-center justify-center rounded-full text-white", c.on)}
            animate={{ scale: [1, 1.15, 1] }}
            transition={{ duration: 0.5, delay: 0.6 + idx * 0.25 }}
          >
            <c.icon className="h-4 w-4" />
          </motion.div>
        ))}
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-600 text-white">
          <VideoIcon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
});

// ── Scene 5: share what matters ──────────────────────────────────────────────
const SceneShare = memo(function SceneShare() {
  const swatches = ["#fca5a5", "#fdba74", "#fcd34d", "#86efac", "#93c5fd", "#c4b5fd"];
  return (
    <div className="flex h-full w-full items-center justify-center gap-3 px-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.45 }}
        className="relative w-full max-w-sm rounded-xl bg-gradient-to-br from-gray-800 to-gray-900 p-3 shadow-xl"
      >
        <span className="absolute left-2 top-2 z-10 flex items-center gap-1 rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-semibold text-white">
          <MonitorUp className="h-3 w-3" /> Sharing
        </span>
        <div className="mt-5 flex items-center gap-1.5 text-white/80">
          <ImageIcon className="h-4 w-4" />
          <span className="text-xs font-medium">Family album</span>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {swatches.map((c, idx) => (
            <motion.div
              key={c}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: idx * 0.08 }}
              className="aspect-square rounded-md"
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        <div className="absolute -bottom-3 -right-3 flex gap-1.5">
          <Face initials="You" from="#60a5fa" to="#2563eb" size="sm" />
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, x: 24 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.9 }}
        className="hidden max-w-[9rem] rounded-2xl rounded-bl-sm bg-white px-3 py-2 text-xs text-gray-700 shadow-lg sm:block"
      >
        <p className="font-semibold text-gray-900">Grandma</p>
        Look how big they've grown! 😊
      </motion.div>
    </div>
  );
});

const STEPS: Step[] = [
  { key: "distance", title: "Someone you love is far away", subtitle: "A different city. A hospital ward. A care home down the coast.", duration: 4200, accent: "from-rose-500 to-red-500", Scene: SceneDistance },
  { key: "invite", title: "Create a room, invite by email", subtitle: "One room, one link. Add them by email in seconds.", duration: 4800, accent: "from-blue-500 to-indigo-500", Scene: SceneInvite },
  { key: "oneclick", title: "They click once — and they're in", subtitle: "No app to download. No account. No password to remember.", duration: 5800, accent: "from-blue-600 to-cyan-500", Scene: SceneOneClick },
  { key: "call", title: "Sit down together", subtitle: "Faces, not voices. Mute, camera and screen-share, right there.", duration: 5200, accent: "from-violet-500 to-purple-500", Scene: SceneCall },
  { key: "share", title: "Share what matters", subtitle: "Show a photo album or a discharge letter — and chat alongside.", duration: 5200, accent: "from-emerald-500 to-green-500", Scene: SceneShare },
];

function DemoStage({ step }: { step: number }) {
  const active = STEPS[step]!;
  const Scene = active.Scene;
  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl bg-gradient-to-br from-slate-50 to-blue-50">
      <AnimatePresence mode="wait">
        <motion.div
          key={active.key}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35 }}
          className="absolute inset-0"
        >
          <Scene />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

export function HowItWorksDemo({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const reduce = useReducedMotion();

  // Reset when the modal opens.
  useEffect(() => {
    if (open) {
      setStep(0);
      setPlaying(true);
    }
  }, [open]);

  // Auto-advance while playing (disabled for reduced-motion users).
  useEffect(() => {
    if (!open || !playing || reduce) return;
    const id = setTimeout(() => setStep((s) => (s + 1) % STEPS.length), STEPS[step]!.duration);
    return () => clearTimeout(id);
  }, [open, playing, reduce, step]);

  const go = useCallback((dir: 1 | -1) => {
    setPlaying(false);
    setStep((s) => (s + dir + STEPS.length) % STEPS.length);
  }, []);

  const active = STEPS[step]!;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl overflow-hidden p-0">
        {/* Screen-reader title/description — the visible heading below is animated and decorative. */}
        <DialogTitle className="sr-only">{active.title}</DialogTitle>
        <DialogDescription className="sr-only">{active.subtitle}</DialogDescription>
        <div className="p-5 sm:p-6">
          <div className="mb-3 flex items-start justify-between gap-4">
            <div className="min-w-0" aria-hidden="true">
              <AnimatePresence mode="wait">
                <motion.div key={active.key} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }}>
                  <h2 className="text-lg font-bold text-gray-900 sm:text-xl">{active.title}</h2>
                  <p className="mt-0.5 text-sm text-gray-500">{active.subtitle}</p>
                </motion.div>
              </AnimatePresence>
            </div>
            <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-600">
              {step + 1} / {STEPS.length}
            </span>
          </div>

          <div className="aspect-video w-full">
            <DemoStage step={step} />
          </div>

          {/* Progress dots */}
          <div className="mt-4 flex items-center justify-center gap-1.5">
            {STEPS.map((s, i) => (
              <button
                key={s.key}
                type="button"
                aria-label={`Go to step ${i + 1}: ${s.title}`}
                onClick={() => {
                  setPlaying(false);
                  setStep(i);
                }}
                className="group relative h-2 overflow-hidden rounded-full bg-gray-200 transition-all"
                style={{ width: i === step ? 40 : 10 }}
              >
                {i === step && !reduce && playing && (
                  <motion.span
                    key={`p-${step}`}
                    className={cn("absolute inset-0 origin-left rounded-full bg-gradient-to-r", active.accent)}
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: STEPS[step]!.duration / 1000, ease: "linear" }}
                  />
                )}
                {i === step && (reduce || !playing) && (
                  <span className={cn("absolute inset-0 rounded-full bg-gradient-to-r", active.accent)} />
                )}
              </button>
            ))}
          </div>

          {/* Controls */}
          <div className="mt-4 flex items-center justify-center gap-2">
            <button type="button" onClick={() => go(-1)} aria-label="Previous step" className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 text-gray-600 transition-colors hover:bg-gray-50">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setPlaying((p) => !p)}
              aria-label={playing ? "Pause" : "Play"}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white shadow transition-colors hover:bg-blue-700"
            >
              {playing && !reduce ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>
            <button type="button" onClick={() => go(1)} aria-label="Next step" className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 text-gray-600 transition-colors hover:bg-gray-50">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** A compact, always-looping version for the hero. Click to open the full modal. */
export function HowItWorksMini({ onOpen }: { onOpen: () => void }) {
  const [step, setStep] = useState(0);
  const reduce = useReducedMotion();
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (reduce) return;
    timerRef.current = window.setTimeout(() => setStep((s) => (s + 1) % STEPS.length), STEPS[step]!.duration);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [reduce, step]);

  const active = STEPS[step]!;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Play the full walkthrough of how Virtual Family Connect works"
      className="group block w-full rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-2xl transition-shadow hover:shadow-blue-200/60 sm:p-5"
    >
      <div className="aspect-video w-full">
        <DemoStage step={step} />
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-900">{active.title}</p>
          <p className="truncate text-xs text-gray-500">{active.subtitle}</p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow transition-transform group-hover:scale-105">
          <Play className="h-3.5 w-3.5" /> Watch
        </span>
      </div>
      <div className="mt-3 flex items-center gap-1.5">
        {STEPS.map((s, i) => (
          <span key={s.key} className={cn("h-1.5 rounded-full transition-all", i === step ? "w-6 bg-blue-600" : "w-1.5 bg-gray-200")} />
        ))}
      </div>
    </button>
  );
}
