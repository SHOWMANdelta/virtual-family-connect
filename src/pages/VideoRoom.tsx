import { CallControls } from "@/components/call/CallControls";
import { DeviceSettingsDialog } from "@/components/call/DeviceSettingsDialog";
import { VideoTile } from "@/components/call/VideoTile";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { parseApiError } from "@/lib/errors";
import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, MessageCircle, RefreshCcw, Send, Users } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";

/**
 * STUN/TURN configuration. Hoisted to a module constant so it — and the
 * `JSON.parse` of any custom ICE servers — is built once, not on every render.
 */
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:19302" },
    { urls: "stun:global.stun.twilio.com:3478" },
    ...(() => {
      try {
        const custom = (import.meta as any).env?.VITE_ICE_SERVERS;
        if (!custom) return [];
        if (custom.startsWith("[")) return JSON.parse(custom);
        return custom.split(",").map((u: string) => ({ urls: u.trim() }));
      } catch {
        return [];
      }
    })(),
  ],
  iceCandidatePoolSize: 10,
};

type PresenceState = {
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
};

/**
 * A hidden audio sink per remote peer. Kept separate from the video tiles so
 * audio never cuts out when the layout reshuffles or a tile remounts, and so
 * volume changes (written straight to `el.volume` via a ref) don't re-render
 * anything. Attaches its stream inside an effect keyed on identity and only
 * calls `play()` when paused — the same discipline as VideoTile.
 */
const RemoteAudio = memo(function RemoteAudio({
  uid,
  stream,
  initialVolume,
  sinkId,
  registerEl,
}: {
  uid: string;
  stream: MediaStream;
  initialVolume: number;
  sinkId?: string;
  registerEl: (uid: string, el: HTMLAudioElement | null) => void;
}) {
  const ref = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    el.volume = initialVolume;
    if (el.paused) el.play().catch(() => {});
    registerEl(uid, el);
    return () => registerEl(uid, null);
    // initialVolume intentionally read once on attach; live changes go via ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream, uid, registerEl]);

  useEffect(() => {
    const el = ref.current as any;
    if (el && sinkId && typeof el.setSinkId === "function") {
      el.setSinkId(sinkId).catch(() => {});
    }
  }, [sinkId]);

  return <audio ref={ref} autoPlay playsInline className="hidden" />;
});

export default function VideoRoom() {
  const { roomId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  // ─── Media / control state ──────────────────────────────────────────────
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [isAudioOn, setIsAudioOn] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [isLocalMediaReady, setIsLocalMediaReady] = useState(false);

  // Mirror the toggles into refs for use inside async callbacks / signal sends.
  const isVideoOnRef = useRef(true);
  const isAudioOnRef = useRef(true);
  const isScreenSharingRef = useRef(false);

  // ─── Peer/render state (replaces the old forceRender counter) ────────────
  const [peerIds, setPeerIds] = useState<string[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [peerStatus, setPeerStatus] = useState<Record<string, RTCIceConnectionState>>({});
  const [remoteStates, setRemoteStates] = useState<Record<string, PresenceState>>({});
  const [selectedPeerId, setSelectedPeerId] = useState<string | null>(null);

  // ─── UI state ────────────────────────────────────────────────────────────
  const [showChat, setShowChat] = useState(false);
  const [message, setMessage] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [needsPermissionPrompt, setNeedsPermissionPrompt] = useState(false);
  const [permissionDetail, setPermissionDetail] = useState<string>("");
  const [mainVideoError, setMainVideoError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<{ code: string; message: string } | null>(null);

  const [currentCameraId, setCurrentCameraId] = useState<string | undefined>(undefined);
  const [currentMicId, setCurrentMicId] = useState<string | undefined>(undefined);
  const [currentSpeakerId, setCurrentSpeakerId] = useState<string | undefined>(undefined);

  // Invite dialog state
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteNote, setInviteNote] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [sentInvite, setSentInvite] = useState<{ id: string; email: string; joinUrl: string } | null>(null);

  // ─── Refs (synchronous, no re-render) ────────────────────────────────────
  const isMountedRef = useRef(false);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const localMediaPromiseRef = useRef<Promise<MediaStream | null> | null>(null);
  const mainContainerRef = useRef<HTMLDivElement>(null);
  const wasMicEnabledRef = useRef<boolean>(true);

  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map());
  const makingOfferRef = useRef<Map<string, boolean>>(new Map());
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const lastOfferByPeerRef = useRef<Map<string, string>>(new Map());

  const connectionAlertsRef = useRef<Set<string>>(new Set());
  const iceRestartTimersRef = useRef<Map<string, number>>(new Map());
  const lastRecoverAtRef = useRef<number>(0);

  const remoteVolumeRef = useRef<Map<string, number>>(new Map());
  const remoteAudioElsRef = useRef<Map<string, HTMLAudioElement>>(new Map());

  // Signal processing: re-entrancy guard + exactly-once bookkeeping.
  const isProcessingRef = useRef(false);
  const processedIdsRef = useRef<Set<string>>(new Set());
  const signalsRef = useRef<any[] | undefined>(undefined);

  // ─── Convex data ─────────────────────────────────────────────────────────
  const room = useQuery(api.rooms.getRoom, roomId ? { roomId: roomId as any } : "skip");
  const participants = useQuery(
    api.rooms.getRoomParticipants,
    roomId ? { roomId: roomId as any } : "skip",
  );
  const messages = useQuery(
    api.messages.getRoomMessages,
    roomId && user?._id ? { roomId: roomId as any } : "skip",
  );
  const signals = useQuery(
    api.signaling.getSignals,
    roomId && user?._id ? { roomId: roomId as any, forUserId: (user as any)._id } : "skip",
  );
  const roomInvites = useQuery(
    api.invites.listRoomInvites,
    roomId && sentInvite ? { roomId: roomId as any } : "skip",
  );
  const sentInviteStatus = sentInvite
    ? roomInvites?.find((invite) => invite._id === sentInvite.id)
    : undefined;

  const leaveRoom = useMutation(api.rooms.leaveRoom);
  const sendMessage = useMutation(api.messages.sendMessage);
  const joinRoom = useMutation(api.rooms.joinRoom);
  const inviteUser = useMutation(api.invites.sendRoomInvite);
  const acknowledgeSignals = useMutation(api.signaling.acknowledgeSignals);
  const sendSignal = useMutation(api.signaling.sendSignal);

  signalsRef.current = signals ?? undefined;

  // ─── Small stable helpers ────────────────────────────────────────────────
  const hasActiveLocalMedia = () => {
    const s = localStreamRef.current;
    return !!(s && s.getTracks().some((t) => t.readyState === "live"));
  };

  const toastOnce = (key: string, fn: () => void) => {
    if (connectionAlertsRef.current.has(key)) return;
    connectionAlertsRef.current.add(key);
    fn();
  };

  const getInitials = (name?: string, email?: string) => {
    if (name) return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
    if (email) return email.substring(0, 2).toUpperCase();
    return "U";
  };
  const getDisplayName = (uid: string) => {
    const p = participants?.find((x: any) => String(x.user?._id) === String(uid));
    return p?.user?.name || p?.user?.email || "Participant";
  };
  const getAvatarImage = (uid: string) => {
    const p = participants?.find((x: any) => String(x.user?._id) === String(uid));
    return p?.user?.image;
  };

  const syncPeerIds = useCallback(() => {
    const ids = Array.from(peerConnectionsRef.current.keys()).sort();
    setPeerIds((prev) =>
      prev.length === ids.length && prev.every((v, i) => v === ids[i]) ? prev : ids,
    );
  }, []);

  const setRemoteStream = useCallback((uid: string, stream: MediaStream) => {
    remoteStreamsRef.current.set(uid, stream);
    setRemoteStreams((prev) => (prev[uid] === stream ? prev : { ...prev, [uid]: stream }));
  }, []);

  const forgetPeer = useCallback((uid: string) => {
    try {
      peerConnectionsRef.current.get(uid)?.close();
    } catch {
      // ignore
    }
    peerConnectionsRef.current.delete(uid);
    remoteStreamsRef.current.delete(uid);
    makingOfferRef.current.delete(uid);
    pendingCandidatesRef.current.delete(uid);
    lastOfferByPeerRef.current.delete(uid);
    setRemoteStreams((prev) => {
      if (!(uid in prev)) return prev;
      const next = { ...prev };
      delete next[uid];
      return next;
    });
    setPeerStatus((prev) => {
      if (!(uid in prev)) return prev;
      const next = { ...prev };
      delete next[uid];
      return next;
    });
    setRemoteStates((prev) => {
      if (!(uid in prev)) return prev;
      const next = { ...prev };
      delete next[uid];
      return next;
    });
    setSelectedPeerId((prev) => (prev === uid ? null : prev));
    syncPeerIds();
  }, [syncPeerIds]);

  const setPeerVolume = useCallback((uid: string, vol: number) => {
    remoteVolumeRef.current.set(uid, vol);
    const el = remoteAudioElsRef.current.get(uid);
    if (el) el.volume = vol;
  }, []);

  const registerAudioEl = useCallback((uid: string, el: HTMLAudioElement | null) => {
    if (el) remoteAudioElsRef.current.set(uid, el);
    else remoteAudioElsRef.current.delete(uid);
  }, []);

  const handleSelectTile = useCallback((id: string) => {
    setSelectedPeerId((prev) => (prev === id ? null : id));
  }, []);

  const toggleFullscreen = useCallback((el?: HTMLElement | null) => {
    const target = el ?? mainContainerRef.current;
    if (!target) return;
    const docAny = document as any;
    const elemAny = target as any;
    const isFs = !!(document.fullscreenElement || docAny.webkitFullscreenElement || docAny.msFullscreenElement);
    if (!isFs) {
      (elemAny.requestFullscreen || elemAny.webkitRequestFullscreen || elemAny.msRequestFullscreen || elemAny.mozRequestFullScreen)?.call(elemAny);
    } else {
      (document.exitFullscreen || docAny.webkitExitFullscreen || docAny.msExitFullscreen)?.call(document);
    }
  }, []);

  const handleFullscreen = useCallback(() => toggleFullscreen(mainContainerRef.current), [toggleFullscreen]);

  // ─── Peer role helpers (deterministic caller prevents glare) ─────────────
  const isCallerFor = (peerUserId: string) => {
    if (!user?._id) return false;
    return String((user as any)._id) > String(peerUserId);
  };
  const isPoliteWith = (peerUserId: string) => {
    if (!user?._id) return true;
    return String((user as any)._id) < String(peerUserId);
  };

  const attachLocalTracksToPc = (pc: RTCPeerConnection) => {
    if (!localStreamRef.current) return;
    const senders = pc.getSenders();
    localStreamRef.current.getTracks().forEach((track) => {
      const existingSender = senders.find(
        (s) => s.track?.kind === track.kind || (!s.track && (s as any).trackKind === track.kind),
      );
      if (existingSender) {
        if (existingSender.track !== track) {
          existingSender.replaceTrack(track).catch((e) => console.warn("replaceTrack failed", e));
        }
      } else {
        try {
          pc.addTrack(track, localStreamRef.current as MediaStream);
        } catch (e) {
          console.warn("addTrack failed", e);
        }
      }
    });
  };

  const replaceOutgoingVideoTrack = (newTrack: MediaStreamTrack | null) => {
    for (const pc of peerConnectionsRef.current.values()) {
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
      if (sender) {
        sender.replaceTrack(newTrack).catch((e) => console.warn("replaceTrack failed", e));
      } else if (newTrack && localStreamRef.current) {
        pc.addTrack(newTrack, localStreamRef.current);
      }
    }
  };

  const broadcastState = async (toId?: string) => {
    if (!roomId || !user?._id) return;
    const targets = toId ? [toId] : Array.from(peerConnectionsRef.current.keys());
    const payload = {
      audioEnabled: isAudioOnRef.current,
      videoEnabled: isVideoOnRef.current,
      screenSharing: isScreenSharingRef.current,
    };
    for (const t of targets) {
      try {
        await sendSignal({ roomId: roomId as any, fromUserId: (user as any)._id, toUserId: t as any, kind: "state", payload });
      } catch {
        // best-effort presence
      }
    }
  };

  const ensurePeerConnection = (peerUserId: string) => {
    let pc = peerConnectionsRef.current.get(peerUserId);
    if (pc && pc.signalingState !== "closed") return pc;
    if (pc) {
      try {
        pc.close();
      } catch {
        // ignore
      }
    }

    pc = new RTCPeerConnection(RTC_CONFIG);
    attachLocalTracksToPc(pc);

    pc.ontrack = (event) => {
      let stream = remoteStreamsRef.current.get(peerUserId);
      if (!stream) {
        stream = new MediaStream();
      }
      if (event.track) {
        const exists = stream.getTracks().some((t) => t.id === event.track.id);
        if (!exists) {
          try {
            stream.addTrack(event.track);
          } catch (e) {
            console.warn("Failed to add remote track", e);
          }
        }
      }
      if (event.streams && event.streams[0]) {
        event.streams[0].getTracks().forEach((t) => {
          const exists = stream!.getTracks().some((tt) => tt.id === t.id);
          if (!exists) {
            try {
              stream!.addTrack(t);
            } catch (e) {
              console.warn("Failed to merge track from event.streams", e);
            }
          }
        });
      }
      setRemoteStream(peerUserId, stream);
    };

    pc.onicecandidate = async (event) => {
      if (event.candidate && roomId && user?._id) {
        try {
          await sendSignal({
            roomId: roomId as any,
            fromUserId: (user as any)._id,
            toUserId: peerUserId as any,
            kind: "candidate",
            payload: {
              candidate: event.candidate.candidate,
              sdpMid: event.candidate.sdpMid ?? undefined,
              sdpMLineIndex: event.candidate.sdpMLineIndex ?? undefined,
            },
          });
        } catch (e) {
          console.error("Failed to send ICE candidate", e);
        }
      }
    };

    pc.onicecandidateerror = (event: any) => {
      try {
        const code = event?.errorCode;
        const host = event?.hostCandidate;
        const key = `${peerUserId}:icecandidateerror:${code}:${host || ""}`;
        if (!connectionAlertsRef.current.has(key)) {
          connectionAlertsRef.current.add(key);
          console.warn(`ICE candidate issue with ${getDisplayName(peerUserId)}: ${event?.errorText || code}`);
        }
      } catch {
        // ignore
      }
    };

    pc.oniceconnectionstatechange = () => {
      const state = pc!.iceConnectionState;
      setPeerStatus((prev) => (prev[peerUserId] === state ? prev : { ...prev, [peerUserId]: state }));

      if (state === "connected" || state === "completed") {
        toastOnce(`${peerUserId}:connected`, () => toast.success(`Connected with ${getDisplayName(peerUserId)}`));
        // Tell the freshly-connected peer our current mic/camera/share status.
        broadcastState(peerUserId);
      } else if (state === "failed" || state === "disconnected") {
        const key = `${peerUserId}:ice:${state}`;
        if (!connectionAlertsRef.current.has(key)) {
          connectionAlertsRef.current.add(key);
          if (state === "failed") {
            toast.warning(`Connection with ${getDisplayName(peerUserId)} was interrupted. Recovering…`);
          }
        }
        const prev = iceRestartTimersRef.current.get(peerUserId);
        if (prev) clearTimeout(prev);
        const t = window.setTimeout(async () => {
          try {
            if (isCallerFor(peerUserId) && pc!.signalingState === "stable") {
              await createOfferTo(peerUserId, true);
            }
          } catch (e) {
            console.warn("ICE restart attempt failed", e);
          } finally {
            iceRestartTimersRef.current.delete(peerUserId);
          }
        }, 3000);
        iceRestartTimersRef.current.set(peerUserId, t);
      }
    };

    // Renegotiate an already-established connection when local tracks change
    // (e.g. screen share adds a video track). Initial negotiation stays with the
    // deterministic caller flow, which avoids a glare storm on join.
    pc.onnegotiationneeded = async () => {
      if (pc!.iceConnectionState !== "connected" && pc!.iceConnectionState !== "completed") return;
      if (makingOfferRef.current.get(peerUserId)) return;
      if (pc!.signalingState !== "stable") return;
      try {
        await createOfferTo(peerUserId);
      } catch (e) {
        console.warn("onnegotiationneeded failed", e);
      }
    };

    peerConnectionsRef.current.set(peerUserId, pc);
    syncPeerIds();
    return pc;
  };

  const createOfferTo = async (peerUserId: string, iceRestart = false) => {
    if (!roomId || !user?._id) return;
    if (!localStreamRef.current && localMediaPromiseRef.current) {
      await localMediaPromiseRef.current.catch(() => {});
    }
    const pc = ensurePeerConnection(peerUserId);
    attachLocalTracksToPc(pc);
    if (pc.signalingState !== "stable" && !iceRestart) return;
    if (makingOfferRef.current.get(peerUserId)) return;
    try {
      makingOfferRef.current.set(peerUserId, true);
      const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true, iceRestart });
      await pc.setLocalDescription(offer);
      await sendSignal({
        roomId: roomId as any,
        fromUserId: (user as any)._id,
        toUserId: peerUserId as any,
        kind: "offer",
        payload: { sdp: offer.sdp || "", type: offer.type },
      });
    } catch (e) {
      console.error("createOffer error", e);
    } finally {
      makingOfferRef.current.set(peerUserId, false);
    }
  };

  // ─── Local media acquisition ─────────────────────────────────────────────
  const acquireMedia = async (): Promise<MediaStream | null> => {
    const applyMicHints = async (stream: MediaStream) => {
      const mic = stream.getAudioTracks()[0];
      if (mic) {
        try {
          mic.contentHint = "speech";
          await mic.applyConstraints({
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
          } as any);
        } catch {
          // not all browsers support these
        }
      }
    };

    const finalize = (stream: MediaStream) => {
      localStreamRef.current = stream;
      setLocalStream(stream);
      setIsLocalMediaReady(true);
      setMainVideoError(null);
      setNeedsPermissionPrompt(false);
      setPermissionDetail("");
      const cam = stream.getVideoTracks()[0];
      const mic = stream.getAudioTracks()[0];
      if (cam) setCurrentCameraId(cam.getSettings().deviceId || undefined);
      if (mic) setCurrentMicId(mic.getSettings().deviceId || undefined);
      stream.getTracks().forEach((t) => {
        t.onended = () => toast.warning(`${t.kind === "video" ? "Camera" : "Microphone"} stopped`);
      });
      for (const pc of peerConnectionsRef.current.values()) attachLocalTracksToPc(pc);
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: {
          echoCancellation: { ideal: true } as any,
          noiseSuppression: { ideal: true } as any,
          autoGainControl: { ideal: true } as any,
          channelCount: { ideal: 1 } as any,
        } as any,
      });
      await applyMicHints(stream);
      finalize(stream);
      return stream;
    } catch (error: any) {
      if (error?.name === "NotAllowedError") {
        setNeedsPermissionPrompt(true);
        setPermissionDetail(
          "Permission was blocked. Click 'Enable Camera & Mic'. If it doesn't prompt, click the lock icon in your browser's address bar and allow camera & microphone.",
        );
      }
      // Fallbacks: video-only, then audio-only.
      try {
        const videoOnly = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        finalize(videoOnly);
        toast.warning("Microphone unavailable. Using camera only.");
        return videoOnly;
      } catch {
        try {
          const audioOnly = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
          await applyMicHints(audioOnly);
          finalize(audioOnly);
          toast.warning("Camera unavailable. Using microphone only.");
          return audioOnly;
        } catch (e2: any) {
          let msg = "Could not access camera or microphone";
          switch (error?.name) {
            case "NotAllowedError":
              msg = "Permission denied for camera/microphone. Please allow access.";
              break;
            case "NotFoundError":
            case "DevicesNotFoundError":
              msg = "No camera or microphone found.";
              break;
            case "NotReadableError":
              msg = "Your camera/microphone is already in use by another app.";
              break;
            case "OverconstrainedError":
              msg = "Device cannot satisfy requested media constraints.";
              break;
            default:
              if (error?.name) msg = `Media error: ${error.name}`;
          }
          console.error("Error accessing media devices:", error, e2);
          toast.error(msg);
          setMainVideoError(msg);
          setIsLocalMediaReady(false);
          return null;
        }
      }
    }
  };

  /**
   * Idempotent local-media acquisition. Reuses a live stream or an in-flight
   * acquisition so React StrictMode's double-mount can't open two cameras, and
   * stops the stream if the component unmounted before it resolved.
   */
  const initializeMedia = async (opts?: { force?: boolean }): Promise<MediaStream | null> => {
    if (!opts?.force) {
      if (hasActiveLocalMedia()) return localStreamRef.current;
      if (localMediaPromiseRef.current) return localMediaPromiseRef.current;
    }
    const p = acquireMedia();
    localMediaPromiseRef.current = p;
    const result = await p;
    if (!result) {
      localMediaPromiseRef.current = null; // allow a retry after failure
      return null;
    }
    if (!isMountedRef.current) {
      result.getTracks().forEach((t) => t.stop());
      return null;
    }
    return result;
  };

  // Debounced, minimal recovery — only when there is genuinely no live media.
  const recoverLocalMediaAndRenegotiate = async (targetPeerId?: string) => {
    const now = Date.now();
    if (now - lastRecoverAtRef.current < 10000) return;
    lastRecoverAtRef.current = now;
    try {
      if (!hasActiveLocalMedia()) await initializeMedia({ force: true });
    } catch (e) {
      console.warn("Recovery: initializeMedia failed", e);
    }
    try {
      const targets = targetPeerId ? [targetPeerId] : Array.from(peerConnectionsRef.current.keys());
      for (const peerId of targets) await createOfferTo(peerId, true);
    } catch (e) {
      console.warn("Recovery: renegotiation failed", e);
    }
  };

  // ─── Device switching (Settings dialog) ──────────────────────────────────
  const switchCamera = async (deviceId: string) => {
    try {
      const ns = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId } }, audio: false });
      const newTrack = ns.getVideoTracks()[0];
      if (!newTrack) return;
      newTrack.enabled = isVideoOnRef.current;
      const stream = localStreamRef.current;
      if (stream) {
        const old = stream.getVideoTracks()[0];
        if (old) {
          stream.removeTrack(old);
          old.stop();
        }
        stream.addTrack(newTrack);
      }
      // Don't disturb the outgoing feed while a screen share owns the video sender.
      if (!isScreenSharingRef.current) replaceOutgoingVideoTrack(newTrack);
      setCurrentCameraId(deviceId);
      toast.success("Camera switched");
    } catch (e) {
      console.warn("switchCamera failed", e);
      toast.error("Couldn't switch camera");
    }
  };

  const switchMic = async (deviceId: string) => {
    try {
      const ns = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } }, video: false });
      const newTrack = ns.getAudioTracks()[0];
      if (!newTrack) return;
      newTrack.enabled = isAudioOnRef.current;
      const stream = localStreamRef.current;
      if (stream) {
        const old = stream.getAudioTracks()[0];
        if (old) {
          stream.removeTrack(old);
          old.stop();
        }
        stream.addTrack(newTrack);
      }
      for (const pc of peerConnectionsRef.current.values()) {
        const sender = pc.getSenders().find((s) => s.track && s.track.kind === "audio");
        if (sender) sender.replaceTrack(newTrack).catch(() => {});
      }
      setCurrentMicId(deviceId);
      toast.success("Microphone switched");
    } catch (e) {
      console.warn("switchMic failed", e);
      toast.error("Couldn't switch microphone");
    }
  };

  // ─── Toggles ─────────────────────────────────────────────────────────────
  const toggleVideo = async () => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      isVideoOnRef.current = track.enabled;
      setIsVideoOn(track.enabled);
      broadcastState();
      return;
    }
    // No camera track (audio-only fallback). Try to acquire one.
    toast.info("Turning your camera on…");
    const stream = await initializeMedia({ force: true });
    const ok = !!stream?.getVideoTracks()[0];
    isVideoOnRef.current = ok;
    setIsVideoOn(ok);
    if (ok) broadcastState();
    else toast.error("No camera available.");
  };

  const toggleAudio = async () => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      isAudioOnRef.current = track.enabled;
      setIsAudioOn(track.enabled);
      broadcastState();
      return;
    }
    // No mic track (video-only fallback). Try to acquire one so Mute isn't a no-op.
    toast.info("Turning your microphone on…");
    try {
      const ns = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
      const newTrack = ns.getAudioTracks()[0];
      if (!newTrack) throw new Error("no mic");
      const stream = localStreamRef.current;
      if (stream) stream.addTrack(newTrack);
      else {
        localStreamRef.current = ns;
        setLocalStream(ns);
      }
      for (const pc of peerConnectionsRef.current.values()) {
        const sender = pc.getSenders().find((s) => s.track && s.track.kind === "audio");
        if (sender) sender.replaceTrack(newTrack).catch(() => {});
        else pc.addTrack(newTrack, localStreamRef.current as MediaStream);
      }
      isAudioOnRef.current = true;
      setIsAudioOn(true);
      broadcastState();
    } catch {
      toast.error("No microphone available.");
    }
  };

  const toggleScreenShare = async () => {
    try {
      if (!isScreenSharing) {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        screenStreamRef.current = stream;
        setScreenStream(stream);

        // Mute mic while sharing system audio to avoid echo.
        const screenHasAudio = stream.getAudioTracks().length > 0;
        const localMic = localStreamRef.current?.getAudioTracks()[0] || null;
        if (screenHasAudio && localMic) {
          wasMicEnabledRef.current = localMic.enabled;
          localMic.enabled = false;
          isAudioOnRef.current = false;
          setIsAudioOn(false);
          toast.info("Mic muted while sharing system audio");
        }

        const screenTrack = stream.getVideoTracks()[0] || null;
        replaceOutgoingVideoTrack(screenTrack);

        if (screenTrack) {
          screenTrack.onended = () => {
            void stopScreenShare();
          };
        }
        isScreenSharingRef.current = true;
        setIsScreenSharing(true);
        broadcastState();
        toast.success("Screen sharing started");
      } else {
        await stopScreenShare();
      }
    } catch (error) {
      console.error("Error with screen sharing:", error);
      toast.error("Could not start screen sharing");
    }
  };

  // Revert to the camera track that has been kept alive on localStreamRef — an
  // instant replaceTrack, no fresh getUserMedia and no re-prompt.
  const stopScreenShare = async () => {
    try {
      const camTrack = localStreamRef.current?.getVideoTracks()[0] || null;
      if (camTrack && camTrack.readyState === "live") {
        camTrack.enabled = isVideoOnRef.current;
        replaceOutgoingVideoTrack(camTrack);
      } else {
        await initializeMedia({ force: true });
        replaceOutgoingVideoTrack(localStreamRef.current?.getVideoTracks()[0] || null);
      }
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
      setScreenStream(null);

      const mic = localStreamRef.current?.getAudioTracks()[0];
      if (mic) {
        mic.enabled = wasMicEnabledRef.current;
        isAudioOnRef.current = mic.enabled;
        setIsAudioOn(mic.enabled);
      }
      isScreenSharingRef.current = false;
      setIsScreenSharing(false);
      broadcastState();
      toast.success("Screen sharing stopped");
    } catch (e) {
      console.warn("stopScreenShare failed", e);
      isScreenSharingRef.current = false;
      setIsScreenSharing(false);
    }
  };

  // ─── Signal processing (drain loop, exactly-once) ────────────────────────
  const processSignals = async (batch: any[]) => {
    const ackIds: string[] = [];
    for (const s of batch) {
      const sigId = String((s as any)._id);
      const fromId = String((s as any).fromUserId);
      const polite = isPoliteWith(fromId);
      try {
        if (s.kind === "offer") {
          if (!s.payload?.sdp) continue;
          const incomingSdp = s.payload.sdp as string;
          const lastSdp = lastOfferByPeerRef.current.get(fromId);
          if (lastSdp && lastSdp === incomingSdp) {
            processedIdsRef.current.add(sigId);
            ackIds.push(sigId);
            continue;
          }
          if (!localStreamRef.current && localMediaPromiseRef.current) {
            await localMediaPromiseRef.current.catch(() => {});
          }
          const pc = ensurePeerConnection(fromId);
          attachLocalTracksToPc(pc);
          const isCollision = makingOfferRef.current.get(fromId) || pc.signalingState !== "stable";
          if (isCollision) {
            if (!polite) {
              processedIdsRef.current.add(sigId);
              ackIds.push(sigId);
              continue;
            }
            try {
              await pc.setLocalDescription({ type: "rollback" } as any);
            } catch {
              // ignore
            }
          }
          const remoteDesc = new RTCSessionDescription({ type: "offer", sdp: incomingSdp });
          try {
            await pc.setRemoteDescription(remoteDesc);
          } catch (e: any) {
            if (e?.name === "InvalidStateError" || String(e?.message || "").includes("InvalidState")) {
              try {
                await pc.setLocalDescription({ type: "rollback" } as any);
              } catch {
                // ignore
              }
              await pc.setRemoteDescription(remoteDesc);
            } else {
              throw e;
            }
          }
          const queued = pendingCandidatesRef.current.get(fromId) || [];
          for (const cand of queued) {
            try {
              await pc.addIceCandidate(cand);
            } catch (ee) {
              console.warn("Failed to add queued ICE candidate", ee);
            }
          }
          pendingCandidatesRef.current.delete(fromId);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await sendSignal({
            roomId: roomId as any,
            fromUserId: (user as any)._id,
            toUserId: fromId as any,
            kind: "answer",
            payload: { sdp: answer.sdp || "", type: answer.type },
          });
          lastOfferByPeerRef.current.set(fromId, incomingSdp);
          broadcastState(fromId);
        } else if (s.kind === "answer") {
          const pc = peerConnectionsRef.current.get(fromId);
          if (pc && pc.signalingState === "have-local-offer") {
            await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: s.payload?.sdp || "" }));
            const queued = pendingCandidatesRef.current.get(fromId) || [];
            for (const cand of queued) {
              try {
                await pc.addIceCandidate(cand);
              } catch (e) {
                console.warn("Failed to add queued ICE candidate", e);
              }
            }
            pendingCandidatesRef.current.delete(fromId);
          }
        } else if (s.kind === "candidate") {
          const payload = s.payload;
          if (payload?.candidate) {
            const cand: RTCIceCandidateInit = {
              candidate: payload.candidate,
              sdpMid: payload.sdpMid,
              sdpMLineIndex: payload.sdpMLineIndex,
            };
            const pc = ensurePeerConnection(fromId);
            try {
              if (!pc.remoteDescription) {
                const arr = pendingCandidatesRef.current.get(fromId) || [];
                arr.push(cand);
                pendingCandidatesRef.current.set(fromId, arr);
              } else {
                await pc.addIceCandidate(cand);
              }
            } catch (e) {
              console.warn("Failed to add ICE candidate", e);
            }
          }
        } else if (s.kind === "state") {
          const p = s.payload || {};
          setRemoteStates((prev) => ({
            ...prev,
            [fromId]: {
              audioEnabled: p.audioEnabled ?? true,
              videoEnabled: p.videoEnabled ?? true,
              screenSharing: p.screenSharing ?? false,
            },
          }));
        } else if (s.kind === "leave") {
          forgetPeer(fromId);
        }
      } catch (e) {
        console.error("Signal handling error", e);
      } finally {
        processedIdsRef.current.add(sigId);
        ackIds.push(sigId);
      }
    }

    if (ackIds.length) {
      try {
        await acknowledgeSignals({ signalIds: ackIds as any });
        // Acked rows are deleted server-side, so drop them from the dedupe set.
        ackIds.forEach((id) => processedIdsRef.current.delete(id));
      } catch (e) {
        console.error("Failed to acknowledge signals", e);
      }
    }
  };

  const drainSignals = async () => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;
    try {
      for (let i = 0; i < 100; i++) {
        if (!isMountedRef.current) break;
        const batch = signalsRef.current || [];
        const unprocessed = batch.filter((s: any) => !processedIdsRef.current.has(String(s._id)));
        if (unprocessed.length === 0) break;
        await processSignals(unprocessed);
      }
    } finally {
      isProcessingRef.current = false;
    }
  };

  // ─── Effects ─────────────────────────────────────────────────────────────
  // Mount: mark mounted, join room, acquire media. StrictMode-safe.
  useEffect(() => {
    if (!roomId || !user?._id) return;
    isMountedRef.current = true;

    (async () => {
      try {
        await joinRoom({ roomId: roomId as any });
      } catch (e) {
        const { code, message } = parseApiError(e);
        setApiError({ code, message });
        toast.error(`${code}: ${message}`);
      }
    })();

    initializeMedia().catch(() => {});

    return () => {
      isMountedRef.current = false;
      try {
        peerConnectionsRef.current.forEach((pc) => pc.close());
        peerConnectionsRef.current.clear();
        remoteStreamsRef.current.clear();
        localStreamRef.current?.getTracks().forEach((t) => t.stop());
        screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, user?._id]);

  // Drive the signal drain whenever new signals arrive.
  useEffect(() => {
    if (!signals || !roomId || !user?._id) return;
    void drainSignals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signals, roomId, user?._id]);

  // Deterministic caller initiates offers once local media is ready.
  useEffect(() => {
    if (!participants || !roomId || !user?._id || !isLocalMediaReady) return;
    const others = participants
      .map((p: any) => p.user?._id)
      .filter((uid: any) => uid && String(uid) !== String((user as any)._id)) as string[];
    for (const otherId of others) {
      if (isCallerFor(otherId) && !peerConnectionsRef.current.has(otherId)) {
        createOfferTo(otherId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participants, roomId, user?._id, isLocalMediaReady]);

  // Drop peers who have left the room so their tiles disappear.
  useEffect(() => {
    if (!participants || !user?._id) return;
    const active = new Set(
      participants
        .map((p: any) => String(p.user?._id))
        .filter((id: string) => id && id !== String((user as any)._id)),
    );
    for (const uid of Array.from(peerConnectionsRef.current.keys())) {
      if (!active.has(uid)) forgetPeer(uid);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participants, user?._id]);

  // Reactive permission detection (kept lightweight).
  useEffect(() => {
    let cleanupFns: Array<() => void> = [];
    const check = async () => {
      try {
        if (hasActiveLocalMedia()) {
          setNeedsPermissionPrompt(false);
          return;
        }
        const perms = (navigator as any).permissions;
        if (!perms?.query) return;
        const [cam, mic] = await Promise.all([
          perms.query({ name: "camera" as PermissionName }).catch(() => null),
          perms.query({ name: "microphone" as PermissionName }).catch(() => null),
        ]);
        const states = [cam?.state, mic?.state].filter(Boolean) as Array<PermissionState>;
        if (states.some((s) => s === "denied" || s === "prompt") && !hasActiveLocalMedia()) {
          setNeedsPermissionPrompt(true);
        }
        [cam, mic].forEach((status) => {
          if (status) {
            const handler = () => {
              const show = (status.state === "denied" || status.state === "prompt") && !hasActiveLocalMedia();
              setNeedsPermissionPrompt(show);
            };
            status.addEventListener("change", handler);
            cleanupFns.push(() => status.removeEventListener("change", handler));
          }
        });
      } catch {
        // ignore
      }
    };
    check();
    return () => cleanupFns.forEach((fn) => fn());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Handlers: leave, chat, invite ───────────────────────────────────────
  const handleLeaveRoom = async () => {
    try {
      if (roomId) {
        if (user?._id) {
          for (const peerId of peerConnectionsRef.current.keys()) {
            try {
              await sendSignal({ roomId: roomId as any, fromUserId: (user as any)._id, toUserId: peerId as any, kind: "leave", payload: {} });
            } catch {
              // ignore
            }
          }
        }
        await leaveRoom({ roomId: roomId as any });
      }
      peerConnectionsRef.current.forEach((pc) => pc.close());
      peerConnectionsRef.current.clear();
      remoteStreamsRef.current.clear();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      navigate("/dashboard");
      toast.success("Left the room");
    } catch (error) {
      console.error("Error leaving room:", error);
      toast.error("Failed to leave room");
    }
  };

  const retryJoin = async () => {
    if (!roomId) return;
    try {
      await joinRoom({ roomId: roomId as any });
      toast.success("Joined room");
      setApiError(null);
    } catch (e) {
      const { code, message } = parseApiError(e);
      setApiError({ code, message });
      toast.error(`${code}: ${message}`);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || !roomId) return;
    try {
      await sendMessage({ roomId: roomId as any, content: message, messageType: "text" });
      setMessage("");
    } catch (error) {
      const { code, message: msg } = parseApiError(error);
      toast.error(`${code}: ${msg}`);
    }
  };

  const handleInvite = async () => {
    if (!roomId || !inviteEmail.trim()) return;
    setInviting(true);
    setInviteError(null);
    try {
      const result = await inviteUser({
        roomId: roomId as any,
        email: inviteEmail.trim(),
        note: inviteNote.trim() || undefined,
        origin: window.location.origin,
      });
      setSentInvite({ id: result.inviteId, email: result.email, joinUrl: result.joinUrl });
      setInviteEmail("");
      setInviteNote("");
    } catch (e) {
      const { message: msg } = parseApiError(e);
      setInviteError(msg);
    } finally {
      setInviting(false);
    }
  };

  const copyInviteLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Invite link copied");
    } catch {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = url;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
        toast.success("Invite link copied");
      } catch {
        toast.error("Couldn't copy — select the link and copy it manually");
      }
    }
  };

  const resetInviteDialog = () => {
    setSentInvite(null);
    setInviteError(null);
    setInviteEmail("");
    setInviteNote("");
  };

  // ─── Layout computation ──────────────────────────────────────────────────
  const nRemote = peerIds.length;
  const someoneRemoteSharing = peerIds.find((id) => remoteStates[id]?.screenSharing) ?? null;

  let stage: { kind: "local-screen" | "remote"; id: string } | null = null;
  if (isScreenSharing && screenStream) {
    stage = { kind: "local-screen", id: "local-screen" };
  } else if (someoneRemoteSharing) {
    stage = { kind: "remote", id: someoneRemoteSharing };
  } else if (selectedPeerId && peerIds.includes(selectedPeerId)) {
    stage = { kind: "remote", id: selectedPeerId };
  }

  const twoPerson = nRemote === 1 && !isScreenSharing && !someoneRemoteSharing && !selectedPeerId;
  const useGrid = !stage && !twoPerson && nRemote >= 1;
  const solo = nRemote === 0 && !isScreenSharing;

  const localTile = (extra?: { className?: string; compact?: boolean }) => (
    <VideoTile
      stream={localStream}
      displayName={user?.name || user?.email || "You"}
      initials={getInitials(user?.name, user?.email)}
      avatarUrl={user?.image}
      isLocal
      mirror
      audioOff={!isAudioOn}
      videoOff={!isVideoOn}
      onFullscreen={handleFullscreen}
      className={extra?.className}
      compact={extra?.compact}
    />
  );

  const localScreenTile = (extra?: { className?: string }) => (
    <VideoTile
      stream={screenStream}
      displayName="Your screen"
      initials={getInitials(user?.name, user?.email)}
      avatarUrl={user?.image}
      isLocal
      screenSharing
      onFullscreen={handleFullscreen}
      className={extra?.className}
    />
  );

  const remoteTile = (uid: string, extra?: { className?: string; compact?: boolean }) => (
    <VideoTile
      key={uid}
      tileId={uid}
      stream={remoteStreams[uid] ?? null}
      displayName={getDisplayName(uid)}
      initials={getInitials(getDisplayName(uid), undefined)}
      avatarUrl={getAvatarImage(uid)}
      audioOff={remoteStates[uid]?.audioEnabled === false}
      videoOff={remoteStates[uid]?.videoEnabled === false}
      screenSharing={remoteStates[uid]?.screenSharing}
      connection={peerStatus[uid]}
      pinned={selectedPeerId === uid}
      onSelect={handleSelectTile}
      onFullscreen={handleFullscreen}
      showVolume
      initialVolume={remoteVolumeRef.current.get(uid) ?? 1}
      onVolumeChange={setPeerVolume}
      className={extra?.className}
      compact={extra?.compact}
    />
  );

  const gridTiles = [
    <div key="local" className="min-h-0">{localTile({ className: "h-full w-full" })}</div>,
    ...peerIds.map((uid) => (
      <div key={uid} className="min-h-0">{remoteTile(uid, { className: "h-full w-full" })}</div>
    )),
  ];
  const gridCount = gridTiles.length;
  const gridColsClass =
    gridCount <= 1
      ? "grid-cols-1"
      : gridCount === 2
        ? "grid-cols-1 sm:grid-cols-2"
        : gridCount <= 4
          ? "grid-cols-2"
          : gridCount <= 6
            ? "grid-cols-2 sm:grid-cols-3"
            : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4";

  // Filmstrip = everyone not on the main stage.
  const filmstrip: Array<{ key: string; node: React.ReactNode }> = [];
  if (stage) {
    filmstrip.push({ key: "local", node: localTile({ className: "h-full aspect-video", compact: true }) });
    for (const uid of peerIds) {
      if (stage.kind === "remote" && stage.id === uid) continue;
      filmstrip.push({ key: uid, node: remoteTile(uid, { className: "h-full aspect-video", compact: true }) });
    }
  }

  const renderStage = () => {
    if (solo) {
      return localTile({ className: "h-full w-full" });
    }
    if (twoPerson) {
      const uid = peerIds[0]!;
      return (
        <div className="relative h-full w-full">
          {remoteTile(uid, { className: "h-full w-full" })}
          <div className="absolute bottom-3 right-3 h-28 w-40 overflow-hidden rounded-xl shadow-2xl sm:h-32 sm:w-52">
            {localTile({ className: "h-full w-full", compact: true })}
          </div>
        </div>
      );
    }
    if (useGrid) {
      return (
        <div className={`grid h-full auto-rows-fr gap-3 ${gridColsClass}`}>{gridTiles}</div>
      );
    }
    // stage + filmstrip
    return (
      <div className="flex h-full flex-col gap-3">
        <div className="min-h-0 flex-1">
          {stage!.kind === "local-screen" ? localScreenTile({ className: "h-full w-full" }) : remoteTile(stage!.id, { className: "h-full w-full" })}
        </div>
        {filmstrip.length > 0 && (
          <div className="flex h-24 shrink-0 gap-3 overflow-x-auto pb-1 sm:h-28">
            {filmstrip.map((t) => (
              <div key={t.key} className="aspect-video h-full shrink-0">
                {t.node}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  if (!room) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-900 text-white">
        <div className="text-center">
          <h2 className="mb-2 text-xl font-semibold">Room not found</h2>
          <Button onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-gray-900 text-white">
      {/* Header */}
      <header className="shrink-0 border-b border-gray-800 bg-gray-900/80 px-4 py-3 backdrop-blur sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")} className="shrink-0 text-gray-300 hover:text-white">
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              <span className="hidden sm:inline">Leave</span>
            </Button>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold">{room.name}</h1>
              {room.description && <p className="hidden truncate text-xs text-gray-400 sm:block">{room.description}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="whitespace-nowrap bg-green-600/90">
              {(participants?.length || 0)} in room
            </Badge>
            <Button variant="ghost" size="sm" onClick={() => setShowInvite(true)} className="text-gray-300 hover:text-white">
              <Users className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Add member</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Backend error banner */}
      {apiError && (
        <div className="shrink-0 border-b border-red-500/30 bg-red-600/10 px-6 py-2">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-2">
              <Badge className="truncate bg-red-600/80">{apiError.code}</Badge>
              <p className="truncate text-sm text-red-200">{apiError.message}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="ghost" size="sm" onClick={retryJoin} className="text-red-200 hover:text-white">Retry join</Button>
              <Button variant="ghost" size="sm" onClick={() => setApiError(null)} className="text-red-200 hover:text-white">Dismiss</Button>
            </div>
          </div>
        </div>
      )}

      {/* Body: stage + controls, with chat as a sibling column */}
      <div ref={mainContainerRef} className="relative flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Hidden remote audio sinks — position-independent so audio never drops */}
          {peerIds.map((uid) =>
            remoteStreams[uid] ? (
              <RemoteAudio
                key={uid}
                uid={uid}
                stream={remoteStreams[uid]}
                initialVolume={remoteVolumeRef.current.get(uid) ?? 1}
                sinkId={currentSpeakerId}
                registerEl={registerAudioEl}
              />
            ) : null,
          )}

          {/* Video stage */}
          <div className="relative min-h-0 flex-1 p-3 sm:p-4">
            {renderStage()}

            {/* Waiting-for-others card */}
            {solo && (
              <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center">
                <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-white/10 bg-gray-900/85 px-4 py-3 shadow-xl backdrop-blur">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-500/20 text-blue-400">
                    <Users className="h-4 w-4 animate-pulse" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Waiting for family to join</p>
                    <p className="text-xs text-gray-400">Share the invite link to connect</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setShowInvite(true)} className="ml-1 h-8 border-gray-700 px-3 text-xs text-white hover:bg-gray-800">
                    Invite
                  </Button>
                </div>
              </div>
            )}

            {/* Video health banner */}
            {mainVideoError && (
              <div className="absolute left-1/2 top-4 z-40 -translate-x-1/2">
                <div className="flex max-w-[92vw] items-center gap-3 rounded-xl border border-yellow-400/30 bg-yellow-500/10 px-4 py-2 text-yellow-200 shadow-lg backdrop-blur sm:max-w-xl">
                  <span className="truncate text-xs sm:text-sm">{mainVideoError}</span>
                  <Button size="sm" variant="ghost" onClick={() => recoverLocalMediaAndRenegotiate()} className="h-8 bg-yellow-400/20 px-3 text-yellow-100 hover:bg-yellow-400/30">
                    Retry
                  </Button>
                </div>
              </div>
            )}

            {/* Permission prompt */}
            {needsPermissionPrompt && (
              <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
                <div className="w-full max-w-md rounded-2xl border border-white/10 bg-gray-800/90 p-6 shadow-2xl">
                  <h3 className="mb-3 text-lg font-semibold">Enable Camera & Microphone</h3>
                  <p className="mb-3 text-sm text-gray-300">
                    {permissionDetail || "We need access to your camera and microphone to start the call."}
                  </p>
                  <ul className="mb-4 list-disc space-y-1 pl-5 text-xs text-gray-400">
                    <li>Click the button below to re-request access.</li>
                    <li>If blocked, click the lock icon in the address bar and allow Camera and Microphone.</li>
                  </ul>
                  <Button className="w-full bg-blue-600 hover:bg-blue-700" onClick={() => initializeMedia({ force: true }).catch(() => {})}>
                    Enable Camera & Mic
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Control bar — its own row, never overlapping the video */}
          <div className="shrink-0 border-t border-gray-800 bg-gray-900/80 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
            <CallControls
              isAudioOn={isAudioOn}
              isVideoOn={isVideoOn}
              isScreenSharing={isScreenSharing}
              onToggleAudio={toggleAudio}
              onToggleVideo={toggleVideo}
              onToggleScreenShare={toggleScreenShare}
              onToggleChat={() => setShowChat((s) => !s)}
              onOpenSettings={() => setShowSettings(true)}
              onToggleFullscreen={() => toggleFullscreen()}
              onRetry={() => recoverLocalMediaAndRenegotiate()}
              onLeave={handleLeaveRoom}
            />
          </div>
        </div>

        {/* Chat sidebar */}
        <AnimatePresence>
          {showChat && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 340, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex shrink-0 flex-col overflow-hidden border-l border-gray-800 bg-gray-900"
            >
              <div className="flex items-center justify-between border-b border-gray-800 p-4">
                <h3 className="font-semibold">Chat</h3>
                <Button variant="ghost" size="sm" onClick={() => setShowChat(false)} className="text-gray-400 hover:text-white">×</Button>
              </div>
              <ScrollArea className="flex-1 p-4">
                <div className="space-y-4">
                  {messages?.map((msg: any) => (
                    <div key={msg._id} className="flex gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={msg.sender?.image} />
                        <AvatarFallback className="text-xs">{getInitials(msg.sender?.name, msg.sender?.email)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium">{msg.sender?.name || msg.sender?.email}</p>
                          <p className="shrink-0 text-xs text-gray-400">{new Date(msg.timestamp).toLocaleTimeString()}</p>
                        </div>
                        <p className="mt-1 break-words text-sm text-gray-300">{msg.content}</p>
                      </div>
                    </div>
                  ))}
                  {(!messages || messages.length === 0) && (
                    <p className="text-center text-sm text-gray-500">No messages yet. Say hello 👋</p>
                  )}
                </div>
              </ScrollArea>
              <div className="border-t border-gray-800 p-4">
                <form onSubmit={handleSendMessage} className="flex gap-2">
                  <Input
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Type a message…"
                    className="flex-1 border-gray-700 bg-gray-800 text-white placeholder-gray-500"
                  />
                  <Button type="submit" size="sm" disabled={!message.trim()}>
                    <Send className="h-4 w-4" />
                  </Button>
                </form>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>

      {/* Settings dialog */}
      <DeviceSettingsDialog
        open={showSettings}
        onOpenChange={setShowSettings}
        currentCameraId={currentCameraId}
        currentMicId={currentMicId}
        currentSpeakerId={currentSpeakerId}
        onSelectCamera={switchCamera}
        onSelectMic={switchMic}
        onSelectSpeaker={setCurrentSpeakerId}
      />

      {/* Invite dialog */}
      <Dialog
        open={showInvite}
        onOpenChange={(open) => {
          setShowInvite(open);
          if (!open) resetInviteDialog();
        }}
      >
        <DialogContent className="border border-gray-700 bg-gray-800 text-white">
          <DialogHeader>
            <DialogTitle>{sentInvite ? "Invitation created" : "Invite someone to this call"}</DialogTitle>
          </DialogHeader>

          {sentInvite ? (
            <div className="space-y-4">
              <p className="text-sm text-gray-300">
                Invitation for <span className="font-medium text-white">{sentInvite.email}</span>.
              </p>
              {sentInviteStatus?.emailDelivered === true ? (
                <div className="rounded-lg border border-green-700/60 bg-green-950/40 p-3">
                  <p className="text-sm font-medium text-green-300">Email sent.</p>
                  <p className="mt-1 text-xs text-green-200/80">The link takes them straight into this call — no account needed.</p>
                </div>
              ) : sentInviteStatus?.emailDelivered === false ? (
                <div className="rounded-lg border border-amber-700/60 bg-amber-950/40 p-3">
                  <p className="text-sm font-medium text-amber-300">The email didn't go out.</p>
                  <p className="mt-1 text-xs text-amber-200/80">{sentInviteStatus.emailError ?? "Delivery failed. Share the link below instead."}</p>
                </div>
              ) : (
                <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3">
                  <p className="flex items-center gap-2 text-sm text-gray-300">
                    <RefreshCcw className="h-3.5 w-3.5 animate-spin" />
                    Sending the email…
                  </p>
                </div>
              )}
              <div className="space-y-2">
                <Label className="text-gray-300">Invite link</Label>
                <div className="flex gap-2">
                  <Input readOnly value={sentInvite.joinUrl} onFocus={(e) => e.currentTarget.select()} className="border-gray-600 bg-gray-700 font-mono text-xs text-white" />
                  <Button variant="outline" className="shrink-0 border-gray-600 bg-gray-700 text-white hover:bg-gray-600" onClick={() => void copyInviteLink(sentInvite.joinUrl)}>
                    Copy
                  </Button>
                </div>
                <p className="text-xs text-gray-400">Single-use, and expires with this call. Treat it like a key to the room.</p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="inviteEmail" className="text-gray-300">Email address</Label>
                <Input
                  id="inviteEmail"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="user@example.com"
                  value={inviteEmail}
                  onChange={(e) => {
                    setInviteEmail(e.target.value);
                    if (inviteError) setInviteError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && inviteEmail.trim() && !inviting) void handleInvite();
                  }}
                  className="border-gray-600 bg-gray-700 text-white placeholder-gray-400"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="inviteNote" className="text-gray-300">Add a note <span className="text-gray-500">(optional)</span></Label>
                <Input
                  id="inviteNote"
                  placeholder="Joining for Dad's check-up"
                  value={inviteNote}
                  onChange={(e) => setInviteNote(e.target.value)}
                  maxLength={200}
                  className="border-gray-600 bg-gray-700 text-white placeholder-gray-400"
                />
              </div>
              <p className="text-xs text-gray-400">We'll email them a link that opens this call directly. They don't need an account — they can join as a guest.</p>
              {inviteError && <p className="text-sm text-red-400">{inviteError}</p>}
            </div>
          )}

          <DialogFooter>
            {sentInvite ? (
              <>
                <Button variant="ghost" className="text-gray-300 hover:text-white" onClick={resetInviteDialog}>Invite someone else</Button>
                <Button onClick={() => setShowInvite(false)} className="bg-blue-600 hover:bg-blue-700">Done</Button>
              </>
            ) : (
              <>
                <Button variant="ghost" className="text-gray-300 hover:text-white" onClick={() => setShowInvite(false)} disabled={inviting}>Cancel</Button>
                <Button onClick={handleInvite} disabled={!inviteEmail.trim() || inviting} className="bg-blue-600 hover:bg-blue-700">
                  {inviting ? "Sending…" : "Send invitation"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
