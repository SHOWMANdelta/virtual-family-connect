import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
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
  Send
} from "lucide-react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { useState, useEffect, useRef } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

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
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  // Add: remember mic enabled state to prevent echo when sharing system audio
  const wasMicEnabledRef = useRef<boolean>(true);

  // Track which peers we've already alerted for connection issues
  const connectionAlertsRef = useRef<Set<string>>(new Set());

  // NEW: timers for ICE gathering and media watchdogs per peer
  const iceGatheringTimersRef = useRef<Map<string, number>>(new Map());
  const mediaWatchdogRef = useRef<Map<string, number>>(new Map());

  const room = useQuery(api.rooms.getRoom, roomId ? { roomId: roomId as any } : "skip");
  const participants = useQuery(api.rooms.getRoomParticipants, roomId ? { roomId: roomId as any } : "skip");
  const messages = useQuery(api.messages.getRoomMessages, roomId ? { roomId: roomId as any } : "skip");
  
  const leaveRoom = useMutation(api.rooms.leaveRoom);
  const sendMessage = useMutation(api.messages.sendMessage);
  const joinRoom = useMutation(api.rooms.joinRoom);

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
      { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
    ],
  };

  // Helper: establish polite role to resolve glare deterministically
  const isPoliteWith = (peerUserId: string) => {
    if (!user?._id) return true;
    return String((user as any)._id) < String(peerUserId);
  };

  const ensurePeerConnection = (peerUserId: string) => {
    let pc = peerConnectionsRef.current.get(peerUserId);
    if (pc) return pc;

    pc = new RTCPeerConnection(rtcConfig);

    // If local media isn't ready yet, proactively add recvonly transceivers
    // so we can still receive remote tracks immediately.
    if (!localStreamRef.current) {
      try {
        pc.addTransceiver("video", { direction: "recvonly" });
        pc.addTransceiver("audio", { direction: "recvonly" });
      } catch (e) {
        console.warn("Failed to add recvonly transceivers", e);
      }
    }

    // Add local tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc!.addTrack(track, localStreamRef.current as MediaStream);
      });
    }

    // When remote track arrives
    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (!stream) return;
      remoteStreamsRef.current.set(peerUserId, stream);
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
          // One-time toast per peer to avoid spam
          const key = `${peerUserId}:signal:candidate:sendfail`;
          if (!connectionAlertsRef.current.has(key)) {
            connectionAlertsRef.current.add(key);
            toast.warning(
              `Network signal issue while sending connection info to ${getDisplayName(
                peerUserId
              )}. If this persists, check VPN/firewall and try switching networks.`
            );
          }
        }
      }
    };

    // Surface ICE candidate errors with diagnostics
    pc.onicecandidateerror = (event: any) => {
      try {
        const code = event?.errorCode;
        const text = event?.errorText;
        const url = event?.url;
        const host = event?.hostCandidate;
        const srv = event?.url || event?.urlCandidate;
        const details = [url || srv, host].filter(Boolean).join(" • ");
        const key = `${peerUserId}:icecandidateerror:${code}:${host || ""}`;
        if (!connectionAlertsRef.current.has(key)) {
          connectionAlertsRef.current.add(key);
          toast.error(
            `Connection routing error with ${getDisplayName(
              peerUserId
            )}${code ? ` (code ${code})` : ""}. ${
              text ? text + ". " : ""
            }Try disabling VPN, allowing WebRTC in your firewall, or switching networks.${details ? ` [${details}]` : ""}`
          );
        }
      } catch (err) {
        console.warn("onicecandidateerror handling failed", err);
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "disconnected") {
        const key = `${peerUserId}:ice:${pc.iceConnectionState}`;
        if (!connectionAlertsRef.current.has(key)) {
          connectionAlertsRef.current.add(key);
          toast.warning(
            pc.iceConnectionState === "failed"
              ? `Couldn't establish a stable path to ${getDisplayName(
                  peerUserId
                )}. Tips: disable VPN, check firewall, ensure both sides use HTTPS, or switch networks/Wi‑Fi bands.`
              : `Connection to ${getDisplayName(
                  peerUserId
                )} looks unstable. Check your Wi‑Fi/cellular signal or switch networks.`
          );
        }
      }
    };

    // NEW: observe ICE gathering; warn if it takes too long
    pc.onicegatheringstatechange = () => {
      // Clear stale timer if any
      const oldTimer = iceGatheringTimersRef.current.get(peerUserId);
      if (oldTimer) {
        clearTimeout(oldTimer);
        iceGatheringTimersRef.current.delete(peerUserId);
      }

      if (pc.iceGatheringState === "gathering") {
        const timer = window.setTimeout(() => {
          toast.warning(
            `Finding network routes to ${getDisplayName(peerUserId)} is taking longer than usual. Check network/firewall or switch networks.`
          );
          iceGatheringTimersRef.current.delete(peerUserId);
        }, 10000);
        iceGatheringTimersRef.current.set(peerUserId, timer);
      }
      if (pc.iceGatheringState === "complete") {
        // Done gathering: clear timer if present
        const t = iceGatheringTimersRef.current.get(peerUserId);
        if (t) {
          clearTimeout(t);
          iceGatheringTimersRef.current.delete(peerUserId);
        }
      }
    };

    // NEW: basic signaling state observer for debugging/problem surfacing
    pc.onsignalingstatechange = () => {
      if (pc.signalingState === "closed") {
        // Clean up timers when closed
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

  const createOfferTo = async (peerUserId: string) => {
    if (!roomId || !user?._id) return;
    const pc = ensurePeerConnection(peerUserId);
    attachLocalTracksToPc(pc);

    // Guard against concurrent offers and invalid states
    if (pc.signalingState !== "stable") {
      return;
    }
    if (makingOfferRef.current.get(peerUserId)) {
      return;
    }
    try {
      makingOfferRef.current.set(peerUserId, true);
      const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
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

  // Helper to add local tracks to an existing RTCPeerConnection (if not already added)
  const attachLocalTracksToPc = (pc: RTCPeerConnection) => {
    if (!localStreamRef.current) return;
    const senders = pc.getSenders();
    const haveVideo = senders.some((s) => s.track && s.track.kind === "video");
    const haveAudio = senders.some((s) => s.track && s.track.kind === "audio");

    localStreamRef.current.getTracks().forEach((track) => {
      if (track.kind === "video" && !haveVideo) {
        pc.addTrack(track, localStreamRef.current as MediaStream);
      }
      if (track.kind === "audio" && !haveAudio) {
        pc.addTrack(track, localStreamRef.current as MediaStream);
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

  // On mount: initialize media and join room
  useEffect(() => {
    if (!roomId || !user?._id) return;

    // Join the room for presence so others can connect to you
    (async () => {
      try {
        await joinRoom({ roomId: roomId as any });
      } catch (e) {
        console.error("Failed to join room", e);
      }
    })();

    // Initialize local media
    (async () => {
      await initializeMedia();
      // Attach local tracks to any already-created peer connections
      for (const pc of peerConnectionsRef.current.values()) {
        attachLocalTracksToPc(pc);
      }
    })();

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
        // Some browsers support these permission names
        const perms = navigator.permissions as any;
        if (!perms?.query) return;

        const queries = [
          perms.query({ name: "camera" as PermissionName }).catch(() => null),
          perms.query({ name: "microphone" as PermissionName }).catch(() => null),
        ];
        const [cam, mic] = await Promise.all(queries);

        const states = [cam?.state, mic?.state].filter(Boolean) as Array<PermissionState>;
        if (states.length) {
          const showPrompt = states.some((s) => s === "denied" || s === "prompt");
          setNeedsPermissionPrompt(showPrompt);
          setPermissionDetail(
            showPrompt
              ? "Camera and microphone access is required. Click below to enable. If already granted, use the browser's address bar lock icon to allow."
              : ""
          );

          // Track changes
          [cam, mic].forEach((status) => {
            if (status) {
              const handler = () => {
                const s = status.state;
                const show = s === "denied" || s === "prompt";
                setNeedsPermissionPrompt(show);
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

    // Also re-check when tab becomes visible (user may change permissions)
    const visHandler = () => {
      if (document.visibilityState === "visible") {
        check();
      }
    };
    document.addEventListener("visibilitychange", visHandler);
    cleanupFns.push(() => document.removeEventListener("visibilitychange", visHandler));

    return () => {
      cleanupFns.forEach((fn) => fn());
    };
  }, []);

  // Update initializeMedia to also attach tracks to existing PCs
  const initializeMedia = async () => {
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
        t.onmute = () => {
          // Avoid noisy toasts; log instead
          console.debug(`${t.kind} track muted`);
        };
        t.onunmute = () => {
          console.debug(`${t.kind} track unmuted`);
        };
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        const p = (videoRef.current as HTMLVideoElement).play();
        if (p && typeof p.then === "function") {
          p.catch(() => {
            // Some browsers block autoplay until user gesture
            toast.info("Tap to start local video playback");
          });
        }
      }

      // Attach to existing PCs
      for (const pc of peerConnectionsRef.current.values()) {
        attachLocalTracksToPc(pc);
      }
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
          videoRef.current.play().catch(() => toast.info("Tap to start local video playback"));
        }
        for (const pc of peerConnectionsRef.current.values()) attachLocalTracksToPc(pc);
        toast.warning("Microphone unavailable. Using camera only.");
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
          // Apply track-level constraints if possible
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
        }
      }
    }
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

  // Handle incoming signals
  useEffect(() => {
    if (!signals || !roomId || !user?._id) return;

    (async () => {
      const ackIds: string[] = [];
      for (const s of signals) {
        try {
          const fromId = (s.fromUserId as any) as string;
          const pc = ensurePeerConnection(fromId);
          const polite = isPoliteWith(fromId);

          if (s.kind === "offer") {
            // Glare handling: if not stable and we're impolite, ignore this offer
            if (pc.signalingState !== "stable") {
              if (!polite) {
                // Ignore and let the other side proceed
                continue;
              }
              // Polite peer rolls back if needed
              try {
                await pc.setLocalDescription({ type: "rollback" } as any);
              } catch (e) {
                console.warn("Rollback failed; ignoring offer", e);
                continue;
              }
            }

            const remoteDesc = new RTCSessionDescription({ type: "offer", sdp: s.payload.sdp! });
            try {
              await pc.setRemoteDescription(remoteDesc);
              // Flush any buffered ICE candidates now that remote description is set
              const queued = pendingCandidatesRef.current.get(fromId) || [];
              for (const cand of queued) {
                try {
                  await pc.addIceCandidate(cand);
                } catch (e) {
                  console.warn("Failed to add queued ICE candidate", e);
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
            } catch (e: any) {
              // NEW: additional glare/invalid-state handling safeguard
              if (e?.name === "InvalidStateError" || e?.message?.includes("InvalidState")) {
                try {
                  await pc.setLocalDescription({ type: "rollback" } as any);
                } catch {}
                // Best-effort retry once
                try {
                  await pc.setRemoteDescription(remoteDesc);
                  const queued = pendingCandidatesRef.current.get(fromId) || [];
                  for (const cand of queued) {
                    try {
                      await pc.addIceCandidate(cand);
                    } catch (ee) {
                      console.warn("Failed to add queued ICE after retry", ee);
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
                } catch (retryErr) {
                  console.error("Retry after rollback failed", retryErr);
                  toast.error(`Negotiation failed with ${getDisplayName(fromId)}. Retrying may help.`);
                }
              } else {
                console.error("Error handling offer", e);
                toast.error(`Failed to process offer from ${getDisplayName(fromId)}.`);
              }
            }
          } else if (s.kind === "answer") {
            try {
              // Only set remote answer if we actually have a local offer outstanding
              if (pc.signalingState !== "have-local-offer") {
                continue;
              }
              const remoteDesc = new RTCSessionDescription({ type: "answer", sdp: s.payload.sdp! });
              await pc.setRemoteDescription(remoteDesc);
              // Flush buffered ICE candidates once remote desc is present
              const queued = pendingCandidatesRef.current.get(fromId) || [];
              for (const cand of queued) {
                try {
                  await pc.addIceCandidate(cand);
                } catch (e) {
                  console.warn("Failed to add queued ICE candidate", e);
                }
              }
              pendingCandidatesRef.current.delete(fromId);
            } catch (e) {
              console.error("Error handling answer", e);
            }
          } else if (s.kind === "candidate") {
            if (s.payload.candidate) {
              const cand: RTCIceCandidateInit = {
                candidate: s.payload.candidate,
                sdpMid: s.payload.sdpMid,
                sdpMLineIndex: s.payload.sdpMLineIndex,
              };
              try {
                // Buffer ICE if remoteDescription not set yet; else apply immediately
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
            // Remote peer left
            const leavingPc = peerConnectionsRef.current.get(fromId);
            leavingPc?.close();
            peerConnectionsRef.current.delete(fromId);
            remoteStreamsRef.current.delete(fromId);
            makingOfferRef.current.delete(fromId);
            pendingCandidatesRef.current.delete(fromId);
            forceRender((n) => n + 1);
          }
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
    })();
  }, [signals, roomId, user?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  // After local media and participants are loaded, call others
  useEffect(() => {
    if (!participants || !roomId || !user?._id) return;
    // Initiate offers to all others (mesh)
    const others = participants
      .map((p: any) => p.user?._id)
      .filter((uid: any) => uid && uid !== (user as any)._id) as string[];

    for (const otherId of others) {
      // Only create offer if not already connected
      if (!peerConnectionsRef.current.has(otherId)) {
        createOfferTo(otherId);
      }
    }
  }, [participants, roomId, user?._id]); // eslint-disable-line react-hooks/exhaustive-deps

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
      toast.error("Failed to send message");
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

  const RemoteVideos = () => {
    const entries = Array.from(remoteStreamsRef.current.entries());
    return (
      <div
        className="
          absolute bottom-4 right-0 left-0 md:left-auto md:right-6 md:bottom-6
          flex md:grid md:grid-cols-2 lg:grid-cols-3
          gap-3
          max-h-[28vh] md:max-h-[40vh]
          overflow-x-auto md:overflow-y-auto
          px-3 md:p-2
          rounded-2xl bg-black/20 backdrop-blur-md border border-white/10 shadow-2xl
        "
      >
        {entries.map(([uid, stream]) => (
          <motion.div
            key={uid}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="
              relative
              flex-none
              w-40 h-24 xs:w-48 xs:h-28 sm:w-56 sm:h-32 md:w-44 md:h-28 lg:w-52 lg:h-32
              rounded-xl overflow-hidden ring-1 ring-white/15 shadow-lg bg-gray-800
            "
          >
            <video
              autoPlay
              playsInline
              className="w-full h-full object-cover"
              ref={(el) => {
                if (el && el.srcObject !== stream) {
                  el.srcObject = stream;
                  el.muted = true; // Start muted to satisfy autoplay policies
                  el.play().catch((err) => {
                    console.warn("Auto-play failed for remote video; will rely on user gesture", err);
                    toast.info(`Tap video to play for ${getDisplayName(uid)}`);
                  });
                }
              }}
              onClick={(e) => {
                const el = e.currentTarget;
                if (el.muted) {
                  el.muted = false;
                  el.play().catch((err) => {
                    console.warn("Play after unmute failed", err);
                    toast.info(`Tap again to play ${getDisplayName(uid)}`);
                  });
                }
              }}
              onError={() => toast.error(`Remote video failed to render for ${getDisplayName(uid)}`)}
              muted
              aria-label={`Remote video from ${getDisplayName(uid)}. Tap to toggle audio.`}
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/10" />
            <div className="absolute bottom-1 left-1 right-1 flex items-center gap-2 rounded-md p-1.5 bg-black/40 backdrop-blur-sm">
              <Avatar className="w-6 h-6 shrink-0 ring-1 ring-white/20">
                <AvatarImage src={getAvatarImage(uid)} />
                <AvatarFallback className="text-[10px]">
                  {getInitials(getDisplayName(uid), undefined)}
                </AvatarFallback>
              </Avatar>
              <p className="text-[11px] leading-tight text-white/90 truncate">
                {getDisplayName(uid)}
              </p>
            </div>
          </motion.div>
        ))}
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
              onClick={handleShareLink}
              className="text-gray-300 hover:text-white xs:hidden"
              aria-label="Share room link"
            >
              <Users className="h-4 w-4" />
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
          </div>
        </div>
      </header>

      <div className="flex h-[calc(100vh-80px)]">
        {/* Main Video Area */}
        <div className="flex-1 relative">
          {/* Main Video */}
          <div className="h-full bg-gray-800 flex items-center justify-center relative">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              onError={() => toast.error("Local video failed to render")}
              className="w-full h-full object-cover"
            />
            {needsPermissionPrompt && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
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
                          // Force re-prompt by attempting to acquire both tracks under user gesture
                          initializeMedia().catch(() => {
                            // Swallow here; initializeMedia handles toasts and state
                          });
                        }}
                      >
                        Enable Camera & Mic
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {!isVideoOn && (
              <div className="absolute inset-0 bg-gray-700 flex items-center justify-center">
                <div className="text-center">
                  <Avatar className="w-24 h-24 mx-auto mb-4">
                    <AvatarImage src={user?.image} />
                    <AvatarFallback className="text-2xl">
                      {getInitials(user?.name, user?.email)}
                    </AvatarFallback>
                  </Avatar>
                  <p className="text-gray-300">{user?.name || user?.email}</p>
                  <p className="text-sm text-gray-500">Camera is off</p>
                </div>
              </div>
            )}

            {/* Video Controls Overlay */}
            <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2">
              <div className="flex items-center space-x-4 bg-gray-800/80 backdrop-blur-sm rounded-full px-6 py-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={toggleAudio}
                  className={`rounded-full p-3 ${
                    isAudioOn 
                      ? "bg-gray-700 hover:bg-gray-600" 
                      : "bg-red-600 hover:bg-red-700"
                  }`}
                >
                  {isAudioOn ? (
                    <Mic className="h-5 w-5" />
                  ) : (
                    <MicOff className="h-5 w-5" />
                  )}
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={toggleVideo}
                  className={`rounded-full p-3 ${
                    isVideoOn 
                      ? "bg-gray-700 hover:bg-gray-600" 
                      : "bg-red-600 hover:bg-red-700"
                  }`}
                >
                  {isVideoOn ? (
                    <Video className="h-5 w-5" />
                  ) : (
                    <VideoOff className="h-5 w-5" />
                  )}
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={toggleScreenShare}
                  className={`rounded-full p-3 ${
                    isScreenSharing 
                      ? "bg-blue-600 hover:bg-blue-700" 
                      : "bg-gray-700 hover:bg-gray-600"
                  }`}
                >
                  <Share className="h-5 w-5" />
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-full p-3 bg-gray-700 hover:bg-gray-600"
                >
                  <Settings className="h-5 w-5" />
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleLeaveRoom}
                  className="rounded-full p-3 bg-red-600 hover:bg-red-700"
                >
                  <PhoneOff className="h-5 w-5" />
                </Button>
              </div>
            </div>
          </div>

          {/* Participants Grid */}
          {participants && participants.length > 1 && (
            <div className="absolute top-4 right-4 space-y-2">
              {participants
                .filter(p => p.user?._id !== user?._id)
                .slice(0, 3)
                .map((participant) => (
                  <motion.div
                    key={participant._id}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="w-32 h-24 bg-gray-700 rounded-lg overflow-hidden relative"
                  >
                    <div className="w-full h-full flex items-center justify-center">
                      <Avatar className="w-12 h-12">
                        <AvatarImage src={participant.user?.image} />
                        <AvatarFallback>
                          {getInitials(participant.user?.name, participant.user?.email)}
                        </AvatarFallback>
                      </Avatar>
                    </div>
                    <div className="absolute bottom-1 left-1 right-1">
                      <p className="text-xs text-white truncate bg-black/50 px-1 rounded">
                        {participant.user?.name || participant.user?.email}
                      </p>
                    </div>
                  </motion.div>
                ))}
            </div>
          )}

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
                {messages?.map((msg) => (
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