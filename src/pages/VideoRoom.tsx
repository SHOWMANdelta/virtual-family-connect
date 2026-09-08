import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { parseApiError } from "@/lib/errors";
import { api } from "@/convex/_generated/api";
import { useQuery, useMutation } from "convex/react";
import { motion } from "framer-motion";
import { 
  Video, 
  VideoOff, 
  Mic, 
  MicOff, 
  Phone, 
  PhoneOff,
  MessageCircle,
  Users,
  Settings,
  Monitor,
  Share,
  MoreVertical,
  ArrowLeft,
  Send,
  RefreshCcw
} from "lucide-react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { useState, useEffect, useRef } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Volume2, VolumeX } from "lucide-react";

export default function VideoRoom() {
  const { roomId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [isAudioOn, setIsAudioOn] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [message, setMessage] = useState("");
  const [needsPermissionPrompt, setNeedsPermissionPrompt] = useState(false);
  const [permissionDetail, setPermissionDetail] = useState<string>("");
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteNote, setInviteNote] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  /**
   * The invitation just created, so the dialog can show its link and live
   * delivery status. Creating the row and delivering the email are two separate
   * steps — the mutation only schedules the send — so the UI has to wait for the
   * outcome rather than claim success the moment the mutation returns.
   */
  const [sentInvite, setSentInvite] = useState<{
    id: string;
    email: string;
    joinUrl: string;
  } | null>(null);
  // Add: API error state for backend failures
  const [apiError, setApiError] = useState<{ code: string; message: string } | null>(null);
  
  // Add: main video health state
  const [mainVideoReady, setMainVideoReady] = useState(false);
  const [mainVideoError, setMainVideoError] = useState<string | null>(null);
  const [selectedPeerId, setSelectedPeerId] = useState<string | null>(null);
  const [isLocalMediaReady, setIsLocalMediaReady] = useState(false);
  const localMediaPromiseRef = useRef<Promise<MediaStream | null> | null>(null);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  // Add: container ref for fullscreen
  const mainContainerRef = useRef<HTMLDivElement>(null);
  // Add: main stage video ref (shows admin/host if available, else fallback to local)
  const mainVideoRef = useRef<HTMLVideoElement>(null);

  // Add: remember mic enabled state to prevent echo when sharing system audio
  const wasMicEnabledRef = useRef<boolean>(true);

  // Track which peers we've already alerted for connection issues
  const connectionAlertsRef = useRef<Set<string>>(new Set());

  // Add: local video error counter
  const localVideoErrorCountRef = useRef<number>(0);

  // Add: remember last processed offer SDP per peer to avoid reprocessing duplicates
  const lastOfferByPeerRef = useRef<Map<string, string>>(new Map()); // De-dup incoming offers per peer

  // Helper: emit a one-time toast using a unique key
  const toastOnce = (key: string, fn: () => void) => {
    if (connectionAlertsRef.current.has(key)) return;
    connectionAlertsRef.current.add(key);
    fn();
  };

  // Helper: parse structured API errors "CODE: message"
  // Shared with the auth + invite pages so Convex's multi-line error framing is
  // stripped consistently (see src/lib/errors.ts).

  // Retry joining the room if a backend error occurred
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

  // NEW: timers for ICE gathering and media watchdogs per peer
  const iceGatheringTimersRef = useRef<Map<string, number>>(new Map());
  const mediaWatchdogRef = useRef<Map<string, number>>(new Map());

  // NEW: per‑peer ICE restart debouncer
  const iceRestartTimersRef = useRef<Map<string, number>>(new Map());

  // Helper: detect if we already have live local media (works across browsers)
  const hasActiveLocalMedia = () => {
    const s = localStreamRef.current;
    if (s && s.getTracks().some((t) => t.readyState === "live")) return true;
    const el = videoRef.current as HTMLVideoElement | null;
    const so = (el?.srcObject as MediaStream | null) || null;
    return !!(so && so.getTracks().some((t) => t.readyState === "live"));
  };

  const room = useQuery(api.rooms.getRoom, roomId ? { roomId: roomId as any } : "skip");
  const participants = useQuery(api.rooms.getRoomParticipants, roomId ? { roomId: roomId as any } : "skip");
  // Only query messages when both roomId and user are available to avoid AUTH_REQUIRED
  const messages = useQuery(
    api.messages.getRoomMessages,
    roomId && user?._id ? { roomId: roomId as any } : "skip"
  );
  
  const leaveRoom = useMutation(api.rooms.leaveRoom);
  const sendMessage = useMutation(api.messages.sendMessage);
  const joinRoom = useMutation(api.rooms.joinRoom);
  const inviteUser = useMutation(api.invites.sendRoomInvite);

  // Live delivery status for invitations, so the dialog can report what actually
  // happened to the email rather than assuming it arrived. Only subscribed while
  // the dialog is showing a result.
  const roomInvites = useQuery(
    api.invites.listRoomInvites,
    roomId && sentInvite ? { roomId: roomId as any } : "skip",
  );
  const sentInviteStatus = sentInvite
    ? roomInvites?.find((invite) => invite._id === sentInvite.id)
    : undefined;

  // WebRTC: peer connections and streams
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map());
  const [, forceRender] = useState(0); // trigger re-render when remote streams change

  // Add: per-peer flags and candidate buffering
  const makingOfferRef = useRef<Map<string, boolean>>(new Map()); // prevents concurrent offers
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map()); // buffer ICE until remoteDesc set

  const acknowledgeSignals = useMutation(api.signaling.acknowledgeSignals);
  const sendSignal = useMutation(api.signaling.sendSignal);

  // Subscribe to signaling for this user in this room
  const signals = useQuery(
    api.signaling.getSignals,
    roomId && user?._id ? { roomId: roomId as any, forUserId: (user as any)._id } : "skip"
  );

  const rtcConfig: RTCConfiguration = {
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

  // Helper: deterministic caller (higher ID makes offer) to completely prevent glare collisions
  const isCallerFor = (peerUserId: string) => {
    if (!user?._id) return false;
    return String((user as any)._id) > String(peerUserId);
  };

  // Helper: establish polite role to resolve glare deterministically
  const isPoliteWith = (peerUserId: string) => {
    if (!user?._id) return true;
    return String((user as any)._id) < String(peerUserId);
  };

  const ensurePeerConnection = (peerUserId: string) => {
    let pc = peerConnectionsRef.current.get(peerUserId);
    if (pc && pc.signalingState !== "closed") return pc;
    if (pc) {
      try {
        pc.close();
      } catch {}
    }

    pc = new RTCPeerConnection(rtcConfig);

    // Proactively attach local tracks if already available
    attachLocalTracksToPc(pc);

    // When remote track arrives: handle browsers that don't populate event.streams
    pc.ontrack = (event) => {
      let stream = remoteStreamsRef.current.get(peerUserId);
      if (!stream) {
        stream = new MediaStream();
        remoteStreamsRef.current.set(peerUserId, stream);
      }

      // Add the incoming track (avoid duplicates)
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

      // If event.streams has a stream, merge its tracks as well (covers Chrome)
      if (event.streams && event.streams[0]) {
        const s0 = event.streams[0];
        s0.getTracks().forEach((t) => {
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

      // Save and re-render
      remoteStreamsRef.current.set(peerUserId, stream);

      // Imperatively sync audio element so audio always plays even when
      // the MediaStream object is mutated rather than replaced
      const audioEl = document.getElementById(`audio-remote-${peerUserId}`) as HTMLAudioElement | null;
      if (audioEl) {
        if (audioEl.srcObject !== stream) {
          audioEl.srcObject = stream;
        }
        audioEl.volume = remoteVolumeRef.current.get(peerUserId) ?? 1;
        audioEl.play().catch(() => {});
      }

      // Imperatively sync the remote video tile element too
      const videoEl = remoteVideoElsRef.current.get(peerUserId);
      if (videoEl && videoEl.srcObject !== stream) {
        videoEl.srcObject = stream;
        videoEl.play().catch(() => {});
      }
      forceRender((n) => n + 1);
    };

    // ICE candidates
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

    // Surface ICE candidate errors with diagnostics
    pc.onicecandidateerror = (event: any) => {
      try {
        const code = event?.errorCode;
        const text = event?.errorText;
        const url = event?.url || event?.urlCandidate;
        const host = event?.hostCandidate;
        const details = [url, host].filter(Boolean).join(" • ");
        const key = `${peerUserId}:icecandidateerror:${code}:${host || ""}`;
        if (!connectionAlertsRef.current.has(key)) {
          connectionAlertsRef.current.add(key);
          console.warn(`ICE candidate issue with ${getDisplayName(peerUserId)}: ${text || code} [${details}]`);
        }
      } catch (err) {
        console.warn("onicecandidateerror handling failed", err);
      }
    };

    // ICE connection state handler with recovery logic
    pc.oniceconnectionstatechange = () => {
      const state = pc?.iceConnectionState;
      if (state === "connected" || state === "completed") {
        setMainVideoReady(true);
        setMainVideoError(null);
        toastOnce(`${peerUserId}:connected`, () => {
          toast.success(`Connected with ${getDisplayName(peerUserId)}`);
        });
      } else if (state === "failed" || state === "disconnected") {
        const key = `${peerUserId}:ice:${state}`;
        if (!connectionAlertsRef.current.has(key)) {
          connectionAlertsRef.current.add(key);
          if (state === "failed") {
            toast.warning(`Connection with ${getDisplayName(peerUserId)} was interrupted. Attempting to recover...`);
          }
        }

        // Debounced ICE restart + gentle renegotiation for caller
        const prev = iceRestartTimersRef.current.get(peerUserId);
        if (prev) clearTimeout(prev);
        const t = window.setTimeout(async () => {
          try {
            if (isCallerFor(peerUserId) && pc.signalingState === "stable") {
              await createOfferTo(peerUserId, true);
            }
          } catch (e) {
            console.warn("ICE restart/renegotiation attempt failed", e);
          } finally {
            iceRestartTimersRef.current.delete(peerUserId);
          }
        }, 3000);
        iceRestartTimersRef.current.set(peerUserId, t);
      }
      forceRender((n) => n + 1);
    };

    pc.onsignalingstatechange = () => {
      if (pc.signalingState === "closed") {
        const iceTimer = iceGatheringTimersRef.current.get(peerUserId);
        if (iceTimer) {
          clearTimeout(iceTimer);
          iceGatheringTimersRef.current.delete(peerUserId);
        }
        const mediaTimer = mediaWatchdogRef.current.get(peerUserId);
        if (mediaTimer) {
          clearTimeout(mediaTimer);
          mediaWatchdogRef.current.delete(peerUserId);
        }
      }
    };

    peerConnectionsRef.current.set(peerUserId, pc);
    return pc;
  };

  const createOfferTo = async (peerUserId: string, iceRestart = false) => {
    if (!roomId || !user?._id) return;

    // Await local media if still initializing so offer always includes local audio and video tracks
    if (!localStreamRef.current && localMediaPromiseRef.current) {
      await localMediaPromiseRef.current.catch(() => {});
    }

    const pc = ensurePeerConnection(peerUserId);
    attachLocalTracksToPc(pc);

    // Guard against concurrent offers and invalid states
    if (pc.signalingState !== "stable" && !iceRestart) {
      return;
    }
    if (makingOfferRef.current.get(peerUserId)) {
      return;
    }
    try {
      makingOfferRef.current.set(peerUserId, true);
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
        iceRestart,
      });
      await pc.setLocalDescription(offer);
      await sendSignal({
        roomId: roomId as any,
        fromUserId: (user as any)._id,
        toUserId: peerUserId as any,
        kind: "offer",
        payload: {
          sdp: offer.sdp || "",
          type: offer.type,
        },
      });
    } catch (e) {
      console.error("createOffer error", e);
    } finally {
      makingOfferRef.current.set(peerUserId, false);
    }
  };

  // Helper to add local tracks to an existing RTCPeerConnection (or update if track changed)
  const attachLocalTracksToPc = (pc: RTCPeerConnection) => {
    if (!localStreamRef.current) return;
    const senders = pc.getSenders();

    localStreamRef.current.getTracks().forEach((track) => {
      const existingSender = senders.find(
        (s) => s.track?.kind === track.kind || (!s.track && (s as any).trackKind === track.kind)
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

  // Replace outgoing video track in all peer connections
  const replaceOutgoingVideoTrack = (newTrack: MediaStreamTrack | null) => {
    for (const pc of peerConnectionsRef.current.values()) {
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
      if (sender) {
        sender.replaceTrack(newTrack).catch((e) => console.warn("replaceTrack failed", e));
      } else if (newTrack && localStreamRef.current) {
        // If no sender yet (e.g., connection created before tracks), add track
        pc.addTrack(newTrack, localStreamRef.current);
      }
    }
  };

  // Add: targeted recovery helpers
  const recoverLocalMediaAndRenegotiate = async (targetPeerId?: string) => {
    try {
      // Re-acquire local media (handles permissions and fallbacks)
      await initializeMedia();
    } catch (e) {
      console.warn("Recovery: initializeMedia failed", e);
    }

    // Renegotiate either a single peer or all current peers
    try {
      if (targetPeerId) {
        await createOfferTo(targetPeerId);
      } else {
        for (const peerId of peerConnectionsRef.current.keys()) {
          await createOfferTo(peerId);
        }
      }
      toast.success("Connection recovery attempted");
    } catch (e) {
      console.warn("Recovery: renegotiation failed", e);
      toast.error("Recovery failed. Try again or reload the page.");
    }
  };

  // Add: quick handler to retry main video playback and renegotiate
  const handleVideoRetry = async () => {
    try {
      setMainVideoError(null);
      await initializeMedia();
      await recoverLocalMediaAndRenegotiate();
      // Attempt to play main element if present
      const el = mainVideoRef.current;
      if (el && el.paused) {
        await el.play().catch(() => {});
      }
      setMainVideoReady(true);
      toast.success("Video reinitialized");
    } catch (e) {
      setMainVideoError("Retry failed. Please check permissions/devices.");
      toast.error("Retry failed. Check camera/mic permissions.");
    }
  };

  // On mount: initialize media and join room
  useEffect(() => {
    if (!roomId || !user?._id) return;

    // Join the room for presence so others can connect to you
    (async () => {
      try {
        await joinRoom({ roomId: roomId as any });
      } catch (e) {
        const { code, message } = parseApiError(e);
        setApiError({ code, message });
        console.error("Failed to join room", e);
        toast.error(`${code}: ${message}`);
      }
    })();

    // Initialize local media
    initializeMedia().catch(() => {});

    // Cleanup on unmount
    return () => {
      try {
        peerConnectionsRef.current.forEach((pc) => pc.close());
        peerConnectionsRef.current.clear();
        remoteStreamsRef.current.clear();
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach((t) => t.stop());
        }
      } catch {}
    };
  }, [roomId, user?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Add: detect camera/mic permissions reactively (where supported)
  useEffect(() => {
    let cleanupFns: Array<() => void> = [];
    const check = async () => {
      try {
        const hasMedia = hasActiveLocalMedia();

        // Fallback path for Safari/older browsers: infer permission via device labels
        let devices: MediaDeviceInfo[] = [];
        try {
          devices = await navigator.mediaDevices.enumerateDevices();
        } catch {
          // ignore
        }
        const hasInputs =
          devices.some((d) => d.kind === "videoinput") &&
          devices.some((d) => d.kind === "audioinput");
        const labelsVisible = devices.some((d) => (d.label || "").length > 0);

        // If we already have live media or labels are visible, do not prompt
        if (hasMedia || labelsVisible) {
          setNeedsPermissionPrompt(false);
          setPermissionDetail("");
        }

        const perms = (navigator as any).permissions;
        if (!perms?.query) {
          // No Permissions API: decide based on devices and media presence
          if (!hasMedia && !labelsVisible) {
            setNeedsPermissionPrompt(true);
            setPermissionDetail(
              "We couldn't confirm access. Click below to grant camera and microphone."
            );
          }
          return;
        }

        const queries = [
          perms.query({ name: "camera" as PermissionName }).catch(() => null),
          perms.query({ name: "microphone" as PermissionName }).catch(() => null),
        ];
        const [cam, mic] = await Promise.all(queries);

        const states = [cam?.state, mic?.state].filter(Boolean) as Array<PermissionState>;
        if (states.length) {
          const wantsPrompt = states.some((s) => s === "denied" || s === "prompt");
          // Only show prompt if we truly don't have access nor confirmed labels
          if (wantsPrompt && !hasMedia && !labelsVisible) {
            setNeedsPermissionPrompt(true);
            setPermissionDetail(
              "Camera and microphone access is required. Click below to enable. If already granted, use the lock icon in the address bar to allow camera & microphone."
            );
          } else {
            setNeedsPermissionPrompt(false);
            setPermissionDetail("");
          }

          // Track permission changes
          [cam, mic].forEach((status) => {
            if (status) {
              const handler = () => {
                const s = status.state;
                const show = (s === "denied" || s === "prompt") && !hasActiveLocalMedia();
                setNeedsPermissionPrompt(show && !labelsVisible);
              };
              status.addEventListener("change", handler);
              cleanupFns.push(() => status.removeEventListener("change", handler));
            }
          });
        }
      } catch {
        // Silently ignore if not supported
      }
    };

    check();

    // Also re-check and re-request when tab becomes visible (user may change permissions)
    const visHandler = () => {
      if (document.visibilityState === "visible") {
        check();
        if (!hasActiveLocalMedia()) {
          // Proactively try to acquire media again under user-visible state
          initializeMedia().catch(() => {
            // initializeMedia already handles toasts and state
          });
        }
      }
    };
    document.addEventListener("visibilitychange", visHandler);
    cleanupFns.push(() => document.removeEventListener("visibilitychange", visHandler));

    return () => {
      cleanupFns.forEach((fn) => fn());
    };
  }, []);

  // Update initializeMedia to track localMediaPromiseRef and attach tracks to existing PCs
  const initializeMedia = async () => {
    const acquire = async () => {
      const tryGet = async (constraints: MediaStreamConstraints) => {
        try {
          return await navigator.mediaDevices.getUserMedia(constraints);
        } catch (err: any) {
          throw err;
        }
      };

      try {
        // Primary constraints (stronger echo suppression)
        let stream = await tryGet({
          video: { facingMode: "user" },
          audio: {
            echoCancellation: { ideal: true } as any,
            noiseSuppression: { ideal: true } as any,
            autoGainControl: { ideal: true } as any,
            channelCount: { ideal: 1 } as any,
          } as any,
        });

        // Success: hide prompt if visible
        setNeedsPermissionPrompt(false);
        setPermissionDetail("");

        localStreamRef.current = stream;

        // Apply track-level hints and constraints
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
          } catch (e) {
            console.debug("Mic track constraints not fully supported", e);
          }
        }

        // Notify if tracks end (e.g., device unplugged, permission revoked)
        stream.getTracks().forEach((t) => {
          t.onended = () => {
            toast.warning(`${t.kind === "video" ? "Camera" : "Microphone"} stopped`);
          };
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          const p = (videoRef.current as HTMLVideoElement).play();
          if (p && typeof p.then === "function") {
            p.catch(() => {});
          }
        }

        // Attach to existing PCs
        for (const pc of peerConnectionsRef.current.values()) {
          attachLocalTracksToPc(pc);
        }

        // Set main video ready state
        setMainVideoReady(true);
        setMainVideoError(null);
        setIsLocalMediaReady(true);
        return stream;
      } catch (error: any) {
        // If permission denied, show prompt and guidance
        if (error && typeof error.name === "string" && error.name === "NotAllowedError") {
          setNeedsPermissionPrompt(true);
          setPermissionDetail(
            "Permission was blocked. Click 'Enable Camera & Mic'. If it doesn't prompt, click the lock icon in your browser's address bar and allow camera & microphone."
          );
        }

        // Try fallbacks: video-only, then audio-only
        console.warn("Primary getUserMedia failed, trying fallbacks", error);
        try {
          const videoOnly = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          localStreamRef.current = videoOnly;
          if (videoRef.current) {
            videoRef.current.srcObject = videoOnly;
            videoRef.current.play().catch(() => {});
          }
          for (const pc of peerConnectionsRef.current.values()) attachLocalTracksToPc(pc);
          toast.warning("Microphone unavailable. Using camera only.");
          setMainVideoReady(true);
          setMainVideoError(null);
          setIsLocalMediaReady(true);
          return videoOnly;
        } catch (e1: any) {
          try {
            const audioOnly = await navigator.mediaDevices.getUserMedia({
              video: false,
              audio: {
                echoCancellation: { ideal: true } as any,
                noiseSuppression: { ideal: true } as any,
                autoGainControl: { ideal: true } as any,
                channelCount: { ideal: 1 } as any,
              } as any,
            });
            const mic = audioOnly.getAudioTracks()[0];
            if (mic) {
              try {
                mic.contentHint = "speech";
                await mic.applyConstraints({
                  echoCancellation: true,
                  noiseSuppression: true,
                  autoGainControl: true,
                  channelCount: 1,
                } as any);
              } catch {}
            }
            localStreamRef.current = audioOnly;
            if (videoRef.current) {
              videoRef.current.srcObject = audioOnly;
            }
            for (const pc of peerConnectionsRef.current.values()) attachLocalTracksToPc(pc);
            toast.warning("Camera unavailable. Using microphone only.");
            setMainVideoReady(true);
            setMainVideoError(null);
            setIsLocalMediaReady(true);
            return audioOnly;
          } catch (e2: any) {
            let msg = "Could not access camera or microphone";
            if (error && typeof error.name === "string") {
              switch (error.name) {
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
                  msg = `Media error: ${error.name}`;
              }
            }
            console.error("Error accessing media devices:", error, e1, e2);
            toast.error(msg);
            setMainVideoError(msg || "Could not access camera or microphone");
            setMainVideoReady(false);
            setIsLocalMediaReady(false);
            return null;
          }
        }
      }
    };

    const p = acquire();
    localMediaPromiseRef.current = p;
    return await p;
  };

  // Enhance screen share to replace outgoing tracks to all peers and revert cleanly
  const toggleScreenShare = async () => {
    try {
      if (!isScreenSharing) {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          // If system audio is captured, mute local mic to avoid echo
          audio: true,
        });

        // If system audio is captured, auto-mute local mic and remember prior state
        const screenHasAudio = screenStream.getAudioTracks().length > 0;
        const localMic = localStreamRef.current?.getAudioTracks()[0] || null;
        if (screenHasAudio && localMic) {
          wasMicEnabledRef.current = localMic.enabled;
          localMic.enabled = false;
          setIsAudioOn(false);
          toast.info("Mic muted while sharing system audio to prevent echo");
        }

        const screenVideoTrack = screenStream.getVideoTracks()[0] || null;

        if (videoRef.current) {
          videoRef.current.srcObject = screenStream;
        }

        // Replace outgoing video to peers
        replaceOutgoingVideoTrack(screenVideoTrack);

        // When user stops sharing using browser UI, revert to camera and restore mic state
        if (screenVideoTrack) {
          screenVideoTrack.onended = async () => {
            await initializeMedia();
            const camTrack = localStreamRef.current?.getVideoTracks()[0] || null;
            replaceOutgoingVideoTrack(camTrack);

            // Restore mic enabled state if we muted it
            const mic = localStreamRef.current?.getAudioTracks()[0];
            if (mic && screenHasAudio) {
              mic.enabled = wasMicEnabledRef.current;
              setIsAudioOn(mic.enabled);
            }

            setIsScreenSharing(false);
          };
        }

        setIsScreenSharing(true);
        toast.success("Screen sharing started");
      } else {
        // Revert to camera
        await initializeMedia();
        const camTrack = localStreamRef.current?.getVideoTracks()[0] || null;
        replaceOutgoingVideoTrack(camTrack);

        // Restore mic state if it was changed
        const mic = localStreamRef.current?.getAudioTracks()[0];
        if (mic) {
          mic.enabled = wasMicEnabledRef.current;
          setIsAudioOn(mic.enabled);
        }

        setIsScreenSharing(false);
        toast.success("Screen sharing stopped");
      }
    } catch (error) {
      console.error("Error with screen sharing:", error);
      toast.error("Could not start screen sharing");
    }
  };

  // Add: per-remote element and volume refs
  const remoteVideoElsRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const remoteVolumeRef = useRef<Map<string, number>>(new Map()); // uid -> volume (0..1)
  const remotePrevVolRef = useRef<Map<string, number>>(new Map()); // uid -> last nonzero

  // Add: helpers to control remote volumes
  const setRemoteVolume = (uid: string, vol: number) => {
    if (vol > 0) {
      remotePrevVolRef.current.set(uid, vol);
    }
    remoteVolumeRef.current.set(uid, vol);
    const el = remoteVideoElsRef.current.get(uid);
    if (el) el.volume = vol;
    const audioEl = document.getElementById(`audio-remote-${uid}`) as HTMLAudioElement | null;
    if (audioEl) audioEl.volume = vol;
    forceRender((n) => n + 1);
  };

  const toggleRemoteMute = (uid: string) => {
    const cur = remoteVolumeRef.current.get(uid) ?? 1;
    if (cur === 0) {
      const prev = remotePrevVolRef.current.get(uid) ?? 1;
      setRemoteVolume(uid, prev);
    } else {
      setRemoteVolume(uid, 0);
    }
  };

  /**
   * Handle incoming signaling messages robustly:
   * - Deduplicate offers
   * - Glare handling via rollback for polite peers
   * - Buffer ICE candidates until remote description is set
   * - Hard recovery by rebuilding PC on unexpected errors
   * - Acknowledge processed signals after loop
   */
  useEffect(() => {
    if (!signals || !roomId || !user?._id) return;

    const process = async () => {
      const ackIds: string[] = [];

      for (const s of signals) {
        const fromId = String((s as any).fromUserId);
        const polite = isPoliteWith(fromId);

        try {
          if (s.kind === "offer") {
            if (!s.payload?.sdp) {
              console.warn("Received offer without SDP from", fromId);
              continue;
            }

            const incomingSdp = s.payload.sdp as string;

            // De-duplicate identical offers from the same peer
            const lastSdp = lastOfferByPeerRef.current.get(fromId);
            if (lastSdp && lastSdp === incomingSdp) {
              continue;
            }

            // Ensure callee's local media is ready before answering so answer includes camera and mic
            if (!localStreamRef.current && localMediaPromiseRef.current) {
              await localMediaPromiseRef.current.catch(() => {});
            }

            const pc = ensurePeerConnection(fromId);
            attachLocalTracksToPc(pc);

            // Glare handling: if collision occurs
            const isCollision = makingOfferRef.current.get(fromId) || pc.signalingState !== "stable";
            if (isCollision) {
              if (!polite) {
                // Impolite peer ignores colliding offer
                continue;
              }
              try {
                await pc.setLocalDescription({ type: "rollback" } as any);
              } catch {
                // ignore rollback errors
              }
            }

            const remoteDesc = new RTCSessionDescription({ type: "offer", sdp: incomingSdp });
            try {
              await pc.setRemoteDescription(remoteDesc);
            } catch (e: any) {
              if (e?.name === "InvalidStateError" || String(e?.message || "").includes("InvalidState")) {
                try {
                  try {
                    await pc.setLocalDescription({ type: "rollback" } as any);
                  } catch {}
                  await pc.setRemoteDescription(remoteDesc);
                } catch (retryErr) {
                  console.error("Retry after rollback failed", retryErr);
                  throw retryErr;
                }
              } else {
                throw e;
              }
            }

            // Flush buffered ICE candidates
            const queued = pendingCandidatesRef.current.get(fromId) || [];
            for (const cand of queued) {
              try {
                await pc.addIceCandidate(cand);
              } catch (ee) {
                console.warn("Failed to add queued ICE candidate", ee);
              }
            }
            pendingCandidatesRef.current.delete(fromId);

            // Answer
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await sendSignal({
              roomId: roomId as any,
              fromUserId: (user as any)._id,
              toUserId: fromId as any,
              kind: "answer",
              payload: { sdp: answer.sdp || "", type: answer.type },
            });

            // Mark this offer as processed
            lastOfferByPeerRef.current.set(fromId, incomingSdp);
          } else if (s.kind === "answer") {
            const pc = peerConnectionsRef.current.get(fromId);
            if (pc && pc.signalingState === "have-local-offer") {
              const remoteDesc = new RTCSessionDescription({
                type: "answer",
                sdp: s.payload?.sdp || "",
              });
              await pc.setRemoteDescription(remoteDesc);

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
          } else if (s.kind === "leave") {
            const leavingPc = peerConnectionsRef.current.get(fromId);
            try {
              leavingPc?.close();
            } catch {}
            peerConnectionsRef.current.delete(fromId);
            remoteStreamsRef.current.delete(fromId);
            makingOfferRef.current.delete(fromId);
            pendingCandidatesRef.current.delete(fromId);
            lastOfferByPeerRef.current.delete(fromId);
            setSelectedPeerId((prev) => (prev === fromId ? null : prev));
            forceRender((n) => n + 1);
          }
        } catch (e) {
          console.error("Signal handling error", e);
        } finally {
          ackIds.push((s as any)._id);
        }
      }

      if (ackIds.length) {
        try {
          await acknowledgeSignals({ signalIds: ackIds as any });
        } catch (e) {
          console.error("Failed to acknowledge signals", e);
        }
      }
    };

    process();
  }, [signals, roomId, user?._id]);

  // After local media and participants are loaded, caller initiates offer
  useEffect(() => {
    if (!participants || !roomId || !user?._id || !isLocalMediaReady) return;
    const others = participants
      .map((p: any) => p.user?._id)
      .filter((uid: any) => uid && String(uid) !== String((user as any)._id)) as string[];

    for (const otherId of others) {
      // Deterministic caller initiates offer (prevents glare collisions)
      if (isCallerFor(otherId) && !peerConnectionsRef.current.has(otherId)) {
        createOfferTo(otherId);
      }
    }
  }, [participants, roomId, user?._id, isLocalMediaReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLeaveRoom = async () => {
    try {
      if (roomId) {
        // Notify peers
        if (user?._id) {
          for (const peerId of peerConnectionsRef.current.keys()) {
            try {
              await sendSignal({
                roomId: roomId as any,
                fromUserId: (user as any)._id,
                toUserId: peerId as any,
                kind: "leave",
                payload: {},
              });
            } catch {}
          }
        }
        await leaveRoom({ roomId: roomId as any });
      }

      peerConnectionsRef.current.forEach((pc) => pc.close());
      peerConnectionsRef.current.clear();
      remoteStreamsRef.current.clear();

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
      }

      navigate("/dashboard");
      toast.success("Left the room");
    } catch (error) {
      console.error("Error leaving room:", error);
      toast.error("Failed to leave room");
    }
  };

  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOn(videoTrack.enabled);
      }
    }
  };

  const toggleAudio = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioOn(audioTrack.enabled);
      }
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || !roomId) return;

    try {
      await sendMessage({
        roomId: roomId as any,
        content: message,
        messageType: "text"
      });
      setMessage("");
    } catch (error) {
      const { code, message } = parseApiError(error);
      toast.error(`${code}: ${message}`);
    }
  };

  const handleShareLink = async () => {
    try {
      if (!roomId) return;
      const url = `${window.location.origin}/room/${roomId}`;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        // Fallback for older browsers
        const textarea = document.createElement("textarea");
        textarea.value = url;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      toast.success("Share link copied to clipboard");
    } catch (error) {
      toast.error("Failed to copy share link");
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
        // Only used as a local-dev fallback; the server prefers SITE_URL.
        origin: window.location.origin,
      });

      // Deliberately not "Invitation emailed to X" — at this point the row exists
      // and the send is queued, nothing more. The dialog now shows the real
      // outcome as it lands, along with the link to share by hand if it doesn't.
      setSentInvite({
        id: result.inviteId,
        email: result.email,
        joinUrl: result.joinUrl,
      });
      setInviteEmail("");
      setInviteNote("");
    } catch (e) {
      const { message } = parseApiError(e);
      setInviteError(message);
    } finally {
      setInviting(false);
    }
  };

  const copyInviteLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Invite link copied");
    } catch {
      // Same clipboard-blocked fallback the share button uses.
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

  const getInitials = (name?: string, email?: string) => {
    if (name) {
      return name.split(' ').map(n => n[0]).join('').toUpperCase();
    }
    if (email) {
      return email.substring(0, 2).toUpperCase();
    }
    return "U";
  };

  // Add: helpers to show participant info on tiles
  const getDisplayName = (uid: string) => {
    const p = participants?.find((x: any) => String(x.user?._id) === String(uid));
    return p?.user?.name || p?.user?.email || "Participant";
  };

  const getAvatarImage = (uid: string) => {
    const p = participants?.find((x: any) => String(x.user?._id) === String(uid));
    return p?.user?.image;
  };

  // Add: Fullscreen toggle helper
  const toggleFullscreen = (el?: HTMLElement | null) => {
    const target = el ?? mainContainerRef.current;
    if (!target) return;
    const docAny = document as any;
    const elemAny = target as any;

    const isFs = !!(document.fullscreenElement || docAny.webkitFullscreenElement || docAny.msFullscreenElement);
    if (!isFs) {
      (elemAny.requestFullscreen ||
        elemAny.webkitRequestFullscreen ||
        elemAny.msRequestFullscreen ||
        elemAny.mozRequestFullScreen)?.call(elemAny);
    } else {
      (document.exitFullscreen ||
        docAny.webkitExitFullscreen ||
        docAny.msExitFullscreen)?.call(document);
    }
  };

  // Active remote streams for main stage & participant panels
  const remotePeerEntries = Array.from(remoteStreamsRef.current.entries()).filter(
    ([, stream]) => stream && stream.getTracks().length > 0
  );

  const activeMainPeerId = (() => {
    if (selectedPeerId && remoteStreamsRef.current.has(selectedPeerId)) {
      return selectedPeerId;
    }
    // Prefer remote peer with a live video track
    const withLiveVideo = remotePeerEntries.find(([, stream]) =>
      stream.getVideoTracks().some((t) => t.readyState === "live")
    );
    if (withLiveVideo) return withLiveVideo[0];
    if (remotePeerEntries.length > 0 && remotePeerEntries[0]) return remotePeerEntries[0][0];
    return null;
  })();

  const activeMainStream = activeMainPeerId
    ? remoteStreamsRef.current.get(activeMainPeerId) || null
    : null;

  // Synchronize main video element and PiP video element with active streams
  useEffect(() => {
    const mainEl = mainVideoRef.current;
    if (mainEl) {
      const targetStream = activeMainStream || localStreamRef.current;
      if (targetStream) {
        if (mainEl.srcObject !== targetStream) {
          mainEl.srcObject = targetStream;
        }
        mainEl.muted = true;
        mainEl.play().catch(() => {});
      } else if (mainEl.srcObject) {
        mainEl.srcObject = null;
      }
    }

    const pipEl = videoRef.current;
    if (pipEl && localStreamRef.current) {
      if (pipEl.srcObject !== localStreamRef.current) {
        pipEl.srcObject = localStreamRef.current;
      }
      pipEl.muted = true;
      pipEl.play().catch(() => {});
    }
  }, [activeMainStream, isLocalMediaReady, remotePeerEntries.length]);

  const RemoteVideos = () => {
    if (remotePeerEntries.length === 0) return null;

    return (
      <div
        className={`
          absolute z-20
          ${remotePeerEntries.length === 1
            ? "inset-x-4 bottom-36 pb-[env(safe-area-inset-bottom)] flex gap-3 overflow-x-auto p-3 rounded-2xl bg-black/45 backdrop-blur-xl border border-white/10 shadow-2xl md:inset-auto md:top-20 md:right-4 md:bottom-28 md:w-80 lg:w-96 md:flex-col md:gap-4 md:overflow-y-auto md:overflow-x-hidden md:max-h-[60vh]"
            : "inset-x-2 bottom-36 pb-[env(safe-area-inset-bottom)] flex gap-2 overflow-x-auto p-2 rounded-2xl bg-black/50 backdrop-blur-xl border border-white/10 shadow-2xl md:inset-auto md:top-16 md:right-4 md:bottom-24 md:w-72 lg:w-80 md:flex-col md:gap-3 md:overflow-y-auto md:overflow-x-hidden md:max-h-[70vh]"
          }
        `}
        aria-label="Participants video panel"
      >
        {/* Panel header */}
        <div className="flex items-center justify-between px-1 shrink-0">
          <p className="text-xs font-semibold tracking-wide text-white/90">
            Participants ({remotePeerEntries.length})
          </p>
          <span className="text-[10px] text-blue-300">Click tile to focus</span>
        </div>

        {remotePeerEntries.map(([uid, stream]) => {
          const isMain = activeMainPeerId === uid;
          const vol = remoteVolumeRef.current.get(uid) ?? 1;
          const hasLiveVideo = stream.getVideoTracks().some((t) => t.readyState === "live");
          // Include track count in key so React resyncs the element when tracks are added
          const tileKey = `${uid}-${stream.getTracks().length}`;

          return (
            <motion.div
              key={tileKey}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              onClick={() => setSelectedPeerId(uid)}
              className={`
                group relative
                shrink-0 cursor-pointer
                ${remotePeerEntries.length === 1
                  ? "w-40 h-28 xs:w-44 xs:h-32 sm:w-48 sm:h-36 md:w-full md:h-44 lg:h-48"
                  : "w-36 h-24 sm:w-40 sm:h-28 md:w-full md:h-36 lg:h-40"
                }
                rounded-xl overflow-hidden
                ring-2 ${isMain ? "ring-blue-500" : "ring-white/15 hover:ring-white/30"} transition-all duration-200
                shadow-xl bg-gray-900/80
                flex
              `}
            >
              {/* Video tile — or avatar if camera is off */}
              {hasLiveVideo ? (
                <video
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-contain sm:object-cover"
                  ref={(el) => {
                    if (!el) return;
                    remoteVideoElsRef.current.set(uid, el);
                    if (el.srcObject !== stream) {
                      el.srcObject = stream;
                    }
                    el.muted = true; // Video element muted; audio played by dedicated audio element
                    el.play().catch(() => {});
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    const container = e.currentTarget.parentElement as HTMLElement | null;
                    toggleFullscreen(container);
                  }}
                  aria-label={`Remote video from ${getDisplayName(uid)}`}
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center bg-gray-800 gap-1.5">
                  <Avatar className="w-10 h-10 ring-1 ring-white/20">
                    <AvatarImage src={getAvatarImage(uid)} />
                    <AvatarFallback className="text-sm">
                      {getInitials(getDisplayName(uid), undefined)}
                    </AvatarFallback>
                  </Avatar>
                  <p className="text-[10px] text-gray-400">Camera off</p>
                </div>
              )}
              {/* top gradient and live badge */}
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/20" />
              <div className="absolute top-2 left-2 flex items-center gap-1.5 pointer-events-none">
                <span className={`text-[10px] font-semibold tracking-wide px-2 py-0.5 rounded-full text-white shadow ${hasLiveVideo ? "bg-red-500" : "bg-gray-600"}`}>
                  {hasLiveVideo ? "Live" : "Audio"}
                </span>
                {isMain && (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-600 text-white shadow">
                    On Stage
                  </span>
                )}
              </div>
              {/* Controls bar: name + volume */}
              <div
                className="absolute bottom-1 left-1 right-1 flex items-center gap-1.5 rounded-md px-2 py-1.5 bg-black/65 backdrop-blur-sm"
                onClick={(e) => e.stopPropagation()}
              >
                <Avatar className="w-5 h-5 shrink-0 ring-1 ring-white/25">
                  <AvatarImage src={getAvatarImage(uid)} />
                  <AvatarFallback className="text-[9px]">
                    {getInitials(getDisplayName(uid), undefined)}
                  </AvatarFallback>
                </Avatar>
                <p className="text-[10px] leading-tight text-white/95 truncate flex-1 font-medium">
                  {getDisplayName(uid)}
                </p>
                <button
                  type="button"
                  onClick={() => toggleRemoteMute(uid)}
                  className="text-white/90 hover:text-white transition-colors shrink-0"
                  aria-label={vol === 0 ? "Unmute participant" : "Mute participant"}
                  title={vol === 0 ? "Unmute" : "Mute"}
                >
                  {vol === 0 ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
                </button>
                <div className="w-12 sm:w-16 pl-0.5">
                  <Slider
                    value={[vol]}
                    min={0}
                    max={1}
                    step={0.01}
                    onValueChange={(vals) => setRemoteVolume(uid, vals[0] ?? 0)}
                    aria-label="Participant volume"
                  />
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    );
  };


  if (!room) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-2">Room not found</h2>
          <Button onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/dashboard")}
              className="text-gray-300 hover:text-white shrink-0"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              <span className="hidden xs:inline">Back</span>
            </Button>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold truncate">{room.name}</h1>
              <p className="text-sm text-gray-400 hidden sm:block truncate">
                {room.description}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 sm:space-x-4 mt-1 sm:mt-0">
            <Badge className="bg-green-600 whitespace-nowrap">
              {participants?.length || 0} participants
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleShareLink}
              className="text-gray-300 hover:text-white hidden xs:flex"
              aria-label="Share room link"
            >
              <Users className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Connect Family</span>
              <span className="sm:hidden">Invite</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowChat(!showChat)}
              className="text-gray-300 hover:text-white"
              aria-label="Toggle chat"
            >
              <MessageCircle className="h-4 w-4" />
            </Button>
            {/* Add Member Button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowInvite(true)}
              className="text-gray-300 hover:text-white"
              aria-label="Add member"
            >
              <Users className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Add Member</span>
              <span className="sm:hidden">Add</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Backend error banner */}
      {apiError && (
        <div className="px-6 py-3 bg-red-600/10 border-b border-red-500/30">
          <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 min-w-0">
              <Badge className="bg-red-600/80 truncate">{apiError.code}</Badge>
              <p className="text-sm text-red-200 truncate">{apiError.message}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={retryJoin}
                className="text-red-200 hover:text-white"
              >
                Retry join
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setApiError(null)}
                className="text-red-200 hover:text-white"
              >
                Dismiss
              </Button>
            </div>
          </div>
        </div>
      )}

      <Dialog
        open={showInvite}
        onOpenChange={(open) => {
          setShowInvite(open);
          if (!open) resetInviteDialog();
        }}
      >
        <DialogContent className="bg-gray-800 text-white border border-gray-700 rounded-2xl shadow-xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 duration-200">
          <DialogHeader>
            <DialogTitle>
              {sentInvite ? "Invitation created" : "Invite someone to this call"}
            </DialogTitle>
          </DialogHeader>

          {sentInvite ? (
            <div className="space-y-4">
              <p className="text-sm text-gray-300">
                Invitation for{" "}
                <span className="font-medium text-white">{sentInvite.email}</span>.
              </p>

              {/* Delivery outcome. `emailDelivered` is undefined until the send
                  action reports back, so that state is "in progress", not
                  "failed". */}
              {sentInviteStatus?.emailDelivered === true ? (
                <div className="rounded-lg border border-green-700/60 bg-green-950/40 p-3">
                  <p className="text-sm font-medium text-green-300">
                    Email sent.
                  </p>
                  <p className="mt-1 text-xs text-green-200/80">
                    The link takes them straight into this call — no account
                    needed.
                  </p>
                </div>
              ) : sentInviteStatus?.emailDelivered === false ? (
                <div className="rounded-lg border border-amber-700/60 bg-amber-950/40 p-3">
                  <p className="text-sm font-medium text-amber-300">
                    The email didn't go out.
                  </p>
                  <p className="mt-1 text-xs text-amber-200/80">
                    {sentInviteStatus.emailError ??
                      "Delivery failed. Share the link below instead."}
                  </p>
                </div>
              ) : (
                <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3">
                  <p className="flex items-center gap-2 text-sm text-gray-300">
                    <RefreshCcw className="h-3.5 w-3.5 animate-spin" />
                    Sending the email…
                  </p>
                </div>
              )}

              {/* Always available, whatever happened to the email: the link is
                  the invitation, and the row is valid either way. */}
              <div className="space-y-2">
                <Label className="text-gray-300">Invite link</Label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={sentInvite.joinUrl}
                    onFocus={(e) => e.currentTarget.select()}
                    className="bg-gray-700 border-gray-600 text-white font-mono text-xs"
                  />
                  <Button
                    variant="outline"
                    className="shrink-0 border-gray-600 bg-gray-700 text-white hover:bg-gray-600"
                    onClick={() => void copyInviteLink(sentInvite.joinUrl)}
                  >
                    Copy
                  </Button>
                </div>
                <p className="text-xs text-gray-400">
                  Single-use, and expires with this call. Treat it like a key to
                  the room.
                </p>
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
                    if (e.key === "Enter" && inviteEmail.trim() && !inviting) {
                      void handleInvite();
                    }
                  }}
                  className="bg-gray-700 border-gray-600 text-white placeholder-gray-400"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="inviteNote" className="text-gray-300">
                  Add a note <span className="text-gray-500">(optional)</span>
                </Label>
                <Input
                  id="inviteNote"
                  placeholder="Joining for Dad's check-up"
                  value={inviteNote}
                  onChange={(e) => setInviteNote(e.target.value)}
                  maxLength={200}
                  className="bg-gray-700 border-gray-600 text-white placeholder-gray-400"
                />
              </div>
              <p className="text-xs text-gray-400">
                We'll email them a link that opens this call directly. They don't need
                an account — they can join as a guest.
              </p>
              {inviteError && (
                <p className="text-sm text-red-400">{inviteError}</p>
              )}
            </div>
          )}

          <DialogFooter>
            {sentInvite ? (
              <>
                <Button
                  variant="ghost"
                  className="text-gray-300 hover:text-white"
                  onClick={resetInviteDialog}
                >
                  Invite someone else
                </Button>
                <Button
                  onClick={() => setShowInvite(false)}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  Done
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="ghost"
                  className="text-gray-300 hover:text-white"
                  onClick={() => setShowInvite(false)}
                  disabled={inviting}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleInvite}
                  disabled={!inviteEmail.trim() || inviting}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {inviting ? "Sending..." : "Send invitation"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex h-[calc(100vh-80px)]">
        {/* Main Video Area */}
        <div className="flex-1 relative" ref={mainContainerRef}>
          {/* Main Video */}
          <div className="h-full bg-gray-950 flex items-center justify-center relative overflow-hidden">
            {/* Background Audio Elements for Remote Participants */}
            {remotePeerEntries.map(([uid, stream]) => (
              <audio
                key={uid}
                id={`audio-remote-${uid}`}
                autoPlay
                playsInline
                ref={(el) => {
                  if (el) {
                    if (el.srcObject !== stream) {
                      el.srcObject = stream;
                    }
                    el.volume = remoteVolumeRef.current.get(uid) ?? 1;
                    el.play().catch((err) => {
                      console.debug("Audio autoplay deferred for peer", uid, err);
                    });
                  }
                }}
              />
            ))}

            {/* Main Stage Video */}
            <video
              ref={(el) => {
                mainVideoRef.current = el;
                if (!el) return;
                const targetStream = activeMainStream || localStreamRef.current;
                if (targetStream) {
                  if (el.srcObject !== targetStream) {
                    el.srcObject = targetStream;
                  }
                  el.muted = true; // Video muted; audio handled by <audio> elements
                  el.play().catch(() => {});
                } else if (el.srcObject) {
                  el.srcObject = null;
                }
              }}
              autoPlay
              muted
              playsInline
              onDoubleClick={() => toggleFullscreen(mainContainerRef.current)}
              onLoadedMetadata={(e) => {
                const el = e.currentTarget;
                if (el.paused) {
                  el.play().catch(() => {});
                }
              }}
              onPlaying={() => {
                setMainVideoReady(true);
                setMainVideoError(null);
              }}
              onCanPlay={() => {
                setMainVideoError(null);
                // Also mark ready when canplay fires (covers cases where onPlaying is skipped)
                setMainVideoReady(true);
              }}
              onStalled={() =>
                toastOnce(`main:stalled`, () =>
                  toast.warning("Video stalled. Attempting to recover…")
                )
              }
              onWaiting={() =>
                toastOnce(`main:waiting`, () =>
                  toast.info("Waiting for video…")
                )
              }
              onEmptied={() =>
                toastOnce(`main:emptied`, () =>
                  toast.warning("Video stream was interrupted")
                )
              }
              onSuspend={() =>
                toastOnce(`main:suspend`, () =>
                  toast.info("Video is temporarily suspended")
                )
              }
              onError={(e) => {
                const errMsg = (e?.currentTarget?.error as any)?.message || "Video failed to render";
                setMainVideoError(errMsg);
                setMainVideoReady(false);
                recoverLocalMediaAndRenegotiate().catch(() => {});
              }}
              className="w-full h-full object-cover"
            />

            {/* Active remote participant badge on main stage */}
            {activeMainPeerId && (
              <div className="absolute top-4 left-4 z-20 flex items-center gap-2 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 shadow-lg">
                <span className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" />
                <span className="text-xs font-semibold text-white/95">
                  {getDisplayName(activeMainPeerId)}
                </span>
                <span className="text-[10px] text-gray-400 bg-white/10 px-1.5 py-0.5 rounded">
                  Main Stage
                </span>
              </div>
            )}

            {/* Self preview (PiP) - visible when remote participant is on main stage */}
            <div
              className={`
                absolute bottom-28 sm:bottom-24 left-4 z-30 transition-all duration-300
                ${activeMainStream ? "opacity-100 scale-100 pointer-events-auto" : "opacity-0 scale-95 pointer-events-none"}
              `}
            >
              <div className="w-40 h-28 sm:w-52 sm:h-36 rounded-xl overflow-hidden ring-2 ring-white/20 shadow-[0_8px_24px_rgba(0,0,0,0.5)] bg-black/60 backdrop-blur relative">
                <video
                  ref={(el) => {
                    videoRef.current = el;
                    if (el && localStreamRef.current && el.srcObject !== localStreamRef.current) {
                      el.srcObject = localStreamRef.current;
                      el.muted = true;
                      el.play().catch(() => {});
                    }
                  }}
                  autoPlay
                  muted
                  playsInline
                  className={`w-full h-full object-cover ${isVideoOn ? "" : "hidden"}`}
                  aria-label="Your camera preview"
                />
                {!isVideoOn && (
                  <div className="w-full h-full flex flex-col items-center justify-center bg-gray-800 text-center p-2">
                    <Avatar className="w-10 h-10 mb-1 ring-1 ring-white/20">
                      <AvatarImage src={user?.image} />
                      <AvatarFallback className="text-xs">
                        {getInitials(user?.name, user?.email)}
                      </AvatarFallback>
                    </Avatar>
                    <p className="text-[10px] text-gray-400">Camera off</p>
                  </div>
                )}
              </div>
              <div className="mt-1 text-[10px] font-medium text-white/90 px-2 py-0.5 rounded bg-black/60 backdrop-blur inline-block border border-white/10">
                You
              </div>
            </div>

            {/* Video health banner */}
            {(mainVideoError || (!mainVideoReady && !activeMainStream && !localStreamRef.current)) && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40">
                <div className="flex items-center gap-3 max-w-[92vw] sm:max-w-xl rounded-xl border border-yellow-400/30 bg-yellow-500/10 text-yellow-200 px-4 py-2 backdrop-blur shadow-lg">
                  <span className="text-xs sm:text-sm truncate">
                    {mainVideoError || "Video not ready yet. If this takes long, retry."}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleVideoRetry}
                    className="h-8 px-3 bg-yellow-400/20 hover:bg-yellow-400/30 text-yellow-100"
                  >
                    Retry video
                  </Button>
                </div>
              </div>
            )}

            {/* Camera off overlay on main stage when user is alone and has camera off */}
            {!activeMainStream && !isVideoOn && (
              <div className="absolute inset-0 bg-gray-900 flex items-center justify-center z-10">
                <div className="text-center">
                  <Avatar className="w-24 h-24 mx-auto mb-4 ring-2 ring-white/20 shadow-xl">
                    <AvatarImage src={user?.image} />
                    <AvatarFallback className="text-2xl">
                      {getInitials(user?.name, user?.email)}
                    </AvatarFallback>
                  </Avatar>
                  <p className="text-gray-200 font-medium text-lg">{user?.name || user?.email}</p>
                  <p className="text-sm text-gray-400 mt-1">Your camera is turned off</p>
                  <Button
                    size="sm"
                    onClick={toggleVideo}
                    className="mt-4 bg-blue-600 hover:bg-blue-700"
                  >
                    Turn Camera On
                  </Button>
                </div>
              </div>
            )}

            {/* Waiting for others indicator when user is alone in the room */}
            {remotePeerEntries.length === 0 && (
              <div className="absolute top-4 right-4 z-20">
                <div className="bg-gray-900/80 border border-white/10 px-4 py-3 rounded-xl shadow-xl backdrop-blur-md flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center shrink-0">
                    <Users className="w-4 h-4 animate-pulse" />
                  </div>
                  <div className="text-left">
                    <p className="text-xs font-semibold text-white">Waiting for family to join</p>
                    <p className="text-[11px] text-gray-400">Share invite link to connect</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowInvite(true)}
                    className="border-gray-700 hover:bg-gray-800 text-xs h-7 px-2.5 ml-1 text-white"
                  >
                    Invite
                  </Button>
                </div>
              </div>
            )}

            {needsPermissionPrompt && (
              <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
                <div className="max-w-md w-full bg-gray-800/90 border border-white/10 rounded-2xl p-6 shadow-2xl">
                  <div className="space-y-3">
                    <h3 className="text-lg font-semibold">Enable Camera & Microphone</h3>
                    <p className="text-sm text-gray-300">
                      {permissionDetail || "We need access to your camera and microphone to start the call."}
                    </p>
                    <ul className="text-xs text-gray-400 list-disc pl-5 space-y-1">
                      <li>Click the button below to re-request access.</li>
                      <li>If blocked, click the lock icon in the address bar and allow Camera and Microphone.</li>
                      <li>Ensure you're using HTTPS and no other app is using your devices.</li>
                    </ul>
                    <div className="pt-2">
                      <Button
                        className="w-full bg-blue-600 hover:bg-blue-700"
                        onClick={() => {
                          initializeMedia().catch(() => {});
                        }}
                      >
                        Enable Camera & Mic
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Video Controls Overlay */}
            <div className="absolute inset-x-4 bottom-4 sm:bottom-5 z-50 pb-[env(safe-area-inset-bottom)]">
              <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4 bg-gray-900/95 backdrop-blur-md rounded-xl px-4 py-3 sm:rounded-full sm:px-7 sm:py-4 shadow-2xl ring-1 ring-white/10">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={toggleAudio}
                  className={`rounded-full p-3 sm:p-3.5 ${
                    isAudioOn 
                      ? "bg-gray-700 hover:bg-gray-600" 
                      : "bg-red-600 hover:bg-red-700"
                  }`}
                >
                  {isAudioOn ? (
                    <Mic className="h-5 w-5 sm:h-5 sm:w-5" />
                  ) : (
                    <MicOff className="h-5 w-5 sm:h-5 sm:w-5" />
                  )}
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={toggleVideo}
                  className={`rounded-full p-3 sm:p-3.5 ${
                    isVideoOn 
                      ? "bg-gray-700 hover:bg-gray-600" 
                      : "bg-red-600 hover:bg-red-700"
                  }`}
                >
                  {isVideoOn ? (
                    <Video className="h-5 w-5 sm:h-5 sm:w-5" />
                  ) : (
                    <VideoOff className="h-5 w-5 sm:h-5 sm:w-5" />
                  )}
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={toggleScreenShare}
                  className={`rounded-full p-3 sm:p-3.5 ${
                    isScreenSharing 
                      ? "bg-blue-600 hover:bg-blue-700" 
                      : "bg-gray-700 hover:bg-gray-600"
                  }`}
                >
                  <Share className="h-5 w-5 sm:h-5 sm:w-5" />
                </Button>

                {/* Add: Fullscreen toggle button */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleFullscreen()}
                  className="rounded-full p-3 sm:p-3.5 bg-gray-700 hover:bg-gray-600"
                  aria-label="Toggle fullscreen"
                >
                  <Monitor className="h-5 w-5 sm:h-5 sm:w-5" />
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-full p-3 sm:p-3.5 bg-gray-700 hover:bg-gray-600"
                >
                  <Settings className="h-5 w-5 sm:h-5 sm:w-5" />
                </Button>

                {/* Add: Retry connection button */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => recoverLocalMediaAndRenegotiate()}
                  className="rounded-full p-3 sm:p-3.5 bg-gray-700 hover:bg-gray-600"
                  aria-label="Retry connection"
                >
                  <RefreshCcw className="h-5 w-5 sm:h-5 sm:w-5" />
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleLeaveRoom}
                  className="rounded-full p-3 sm:p-3.5 bg-red-600 hover:bg-red-700"
                >
                  <PhoneOff className="h-5 w-5 sm:h-5 sm:w-5" />
                </Button>
              </div>
            </div>
          </div>

          {/* Remote video tiles */}
          <RemoteVideos />
        </div>

        {/* Chat Sidebar */}
        {showChat && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 320, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            className="bg-gray-800 border-l border-gray-700 flex flex-col"
          >
            <div className="p-4 border-b border-gray-700">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Chat</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowChat(false)}
                  className="text-gray-400 hover:text-white"
                >
                  ×
                </Button>
              </div>
            </div>

            <ScrollArea className="flex-1 p-4">
              <div className="space-y-4">
                {messages?.map((msg: any) => (
                  <div key={msg._id} className="flex space-x-3">
                    <Avatar className="w-8 h-8">
                      <AvatarImage src={msg.sender?.image} />
                      <AvatarFallback className="text-xs">
                        {getInitials(msg.sender?.name, msg.sender?.email)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <div className="flex items-center space-x-2">
                        <p className="text-sm font-medium">
                          {msg.sender?.name || msg.sender?.email}
                        </p>
                        <p className="text-xs text-gray-400">
                          {new Date(msg.timestamp).toLocaleTimeString()}
                        </p>
                      </div>
                      <p className="text-sm text-gray-300 mt-1">{msg.content}</p>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>

            <div className="p-4 border-t border-gray-700">
              <form onSubmit={handleSendMessage} className="flex space-x-2">
                <Input
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Type a message..."
                  className="flex-1 bg-gray-700 border-gray-600 text-white placeholder-gray-400"
                />
                <Button type="submit" size="sm" disabled={!message.trim()}>
                  <Send className="h-4 w-4" />
                </Button>
              </form>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}