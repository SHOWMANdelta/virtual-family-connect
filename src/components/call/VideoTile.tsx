import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { Maximize2, MicOff, MonitorUp, Volume2, VolumeX } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";

export interface VideoTileProps {
  /** The stream to render. May be mutated (tracks added) without changing identity. */
  stream: MediaStream | null;
  /** Stable identifier, passed back to the id-carrying callbacks so they can stay memo-stable. */
  tileId?: string;
  displayName: string;
  initials: string;
  avatarUrl?: string;
  /** Local self-view: mirror the image and never show a volume control. */
  isLocal?: boolean;
  mirror?: boolean;
  /** Peer's mic is off (from the presence signal) — show a mic-off badge. */
  audioOff?: boolean;
  /** Peer's camera is off — force the avatar overlay even if a frame lingers. */
  videoOff?: boolean;
  /** Peer is sharing their screen — show a badge. */
  screenSharing?: boolean;
  /** ICE connection state, drives the quality dot. */
  connection?: RTCIceConnectionState;
  pinned?: boolean;
  compact?: boolean;
  onSelect?: (id: string) => void;
  onFullscreen?: () => void;
  /** Remote tiles only: initial volume 0..1 and a stable id-carrying setter that must NOT re-render the page. */
  showVolume?: boolean;
  initialVolume?: number;
  onVolumeChange?: (id: string, vol: number) => void;
  className?: string;
}

/**
 * A single participant tile.
 *
 * The whole point of this component is stability: the `<video>` element is
 * mounted once and never conditionally swapped, `srcObject` is assigned inside
 * an effect keyed on the stream *identity* (not its track count), and `play()`
 * runs only when the element is actually paused. Inline `ref` callbacks in the
 * previous implementation re-attached on every parent render and fought each
 * other's `play()` promises, which is what produced the black frames. Keeping
 * this memoized and self-contained also means a volume drag re-renders one tile
 * rather than the entire room.
 */
function VideoTileImpl({
  stream,
  tileId,
  displayName,
  initials,
  avatarUrl,
  isLocal,
  mirror,
  audioOff,
  videoOff,
  screenSharing,
  connection,
  pinned,
  compact,
  onSelect,
  onFullscreen,
  showVolume,
  initialVolume = 1,
  onVolumeChange,
  className,
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasLiveVideo, setHasLiveVideo] = useState(false);
  const [volume, setVolume] = useState(initialVolume);
  const prevVolumeRef = useRef(initialVolume > 0 ? initialVolume : 1);

  // Attach the stream once per identity change; play only if paused.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (stream) {
      if (el.srcObject !== stream) {
        el.srcObject = stream;
      }
      if (el.paused) {
        el.play().catch(() => {});
      }
    } else if (el.srcObject) {
      el.srcObject = null;
    }
  }, [stream]);

  // Track whether a live, unmuted video track exists — without driving parent
  // re-renders. Combined with the `videoOff` presence hint below.
  useEffect(() => {
    if (!stream) {
      setHasLiveVideo(false);
      return;
    }
    let cleanups: Array<() => void> = [];
    const compute = () => {
      const track = stream.getVideoTracks().find((t) => t.readyState === "live");
      setHasLiveVideo(!!track && !track.muted && track.enabled);
    };
    const resubscribe = () => {
      cleanups.forEach((fn) => fn());
      cleanups = [];
      stream.getVideoTracks().forEach((t) => {
        const handler = () => compute();
        t.addEventListener("mute", handler);
        t.addEventListener("unmute", handler);
        t.addEventListener("ended", handler);
        cleanups.push(() => {
          t.removeEventListener("mute", handler);
          t.removeEventListener("unmute", handler);
          t.removeEventListener("ended", handler);
        });
      });
      compute();
    };
    resubscribe();
    const onChange = () => resubscribe();
    stream.addEventListener("addtrack", onChange);
    stream.addEventListener("removetrack", onChange);
    return () => {
      cleanups.forEach((fn) => fn());
      stream.removeEventListener("addtrack", onChange);
      stream.removeEventListener("removetrack", onChange);
    };
  }, [stream]);

  const applyVolume = (vol: number) => {
    if (vol > 0) prevVolumeRef.current = vol;
    setVolume(vol);
    if (tileId) onVolumeChange?.(tileId, vol);
  };

  const toggleMute = () => {
    if (volume === 0) applyVolume(prevVolumeRef.current || 1);
    else applyVolume(0);
  };

  const showAvatar = !hasLiveVideo || !!videoOff;

  const dotColor =
    connection === "connected" || connection === "completed"
      ? "bg-green-400"
      : connection === "checking" || connection === "new"
        ? "bg-amber-400"
        : connection === "failed" || connection === "disconnected" || connection === "closed"
          ? "bg-red-400"
          : "bg-gray-400";

  return (
    <div
      onClick={() => tileId && onSelect?.(tileId)}
      className={cn(
        "group relative overflow-hidden rounded-2xl bg-gray-900 ring-1 ring-white/10 shadow-lg",
        pinned && "ring-2 ring-blue-500",
        onSelect && "cursor-pointer",
        className,
      )}
      aria-label={`Video tile for ${displayName}`}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        onLoadedMetadata={(e) => {
          if (e.currentTarget.paused) e.currentTarget.play().catch(() => {});
        }}
        onCanPlay={(e) => {
          if (e.currentTarget.paused) e.currentTarget.play().catch(() => {});
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onFullscreen?.();
        }}
        className={cn(
          "h-full w-full bg-gray-900 object-cover transition-opacity duration-200",
          showAvatar ? "opacity-0" : "opacity-100",
          mirror && "-scale-x-100",
        )}
      />

      {/* Avatar overlay — always mounted, faded in when there's no picture. */}
      <div
        className={cn(
          "absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-gray-800 to-gray-900 transition-opacity duration-200",
          showAvatar ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <Avatar className={cn("ring-2 ring-white/15", compact ? "h-12 w-12" : "h-20 w-20")}>
          <AvatarImage src={avatarUrl} />
          <AvatarFallback className={compact ? "text-sm" : "text-2xl"}>{initials}</AvatarFallback>
        </Avatar>
        {!compact && <p className="text-sm font-medium text-gray-300">Camera off</p>}
      </div>

      {/* Top-left status badges */}
      <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-1.5">
        <span className={cn("h-2.5 w-2.5 rounded-full ring-2 ring-black/30", dotColor)} />
        {screenSharing && (
          <span className="flex items-center gap-1 rounded-full bg-blue-600/90 px-2 py-0.5 text-[10px] font-semibold text-white shadow">
            <MonitorUp className="h-3 w-3" /> Sharing
          </span>
        )}
        {pinned && (
          <span className="rounded-full bg-blue-600/90 px-2 py-0.5 text-[10px] font-semibold text-white shadow">
            On stage
          </span>
        )}
      </div>

      {/* Name + mic status bar */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/70 via-black/20 to-transparent p-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {audioOff && (
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-500/90 shadow">
              <MicOff className="h-3 w-3 text-white" />
            </span>
          )}
          <span className="truncate text-xs font-medium text-white drop-shadow">
            {displayName}
            {isLocal && " (You)"}
          </span>
        </div>
      </div>

      {/* Volume control — remote tiles only, on hover */}
      {showVolume && !isLocal && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute right-2 top-2 flex items-center gap-1.5 rounded-full bg-black/65 px-2 py-1 opacity-0 backdrop-blur-sm transition-opacity duration-150 group-hover:opacity-100"
        >
          <button
            type="button"
            onClick={toggleMute}
            className="text-white/90 transition-colors hover:text-white"
            aria-label={volume === 0 ? "Unmute participant" : "Mute participant"}
          >
            {volume === 0 ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
          </button>
          <div className="w-14">
            <Slider
              value={[volume]}
              min={0}
              max={1}
              step={0.01}
              onValueChange={(vals) => applyVolume(vals[0] ?? 0)}
              aria-label="Participant volume"
            />
          </div>
        </div>
      )}

      {onFullscreen && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onFullscreen();
          }}
          className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white/90 opacity-0 backdrop-blur-sm transition-opacity duration-150 hover:text-white group-hover:opacity-100"
          aria-label="Fullscreen"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

export const VideoTile = memo(VideoTileImpl);
