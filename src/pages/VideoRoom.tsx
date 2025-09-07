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
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

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

  const ensurePeerConnection = (peerUserId: string) => {
    let pc = peerConnectionsRef.current.get(peerUserId);
    if (pc) return pc;

    pc = new RTCPeerConnection(rtcConfig);

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
        }
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc && (pc.connectionState === "disconnected" || pc.connectionState === "failed")) {
        // Cleanup on disconnect
        pc.close();
        peerConnectionsRef.current.delete(peerUserId);
        remoteStreamsRef.current.delete(peerUserId);
        forceRender((n) => n + 1);
      }
    };

    peerConnectionsRef.current.set(peerUserId, pc);
    return pc;
  };

  const createOfferTo = async (peerUserId: string) => {
    if (!roomId || !user?._id) return;
    const pc = ensurePeerConnection(peerUserId);
    // Attach tracks in case they weren't present yet
    attachLocalTracksToPc(pc);
    // Only create an offer if stable to avoid glare/state issues
    if (pc.signalingState !== "stable") {
      return;
    }
    try {
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

  // Update initializeMedia to also attach tracks to existing PCs
  const initializeMedia = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });
      
      localStreamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      // Attach tracks to any existing peer connections
      for (const pc of peerConnectionsRef.current.values()) {
        attachLocalTracksToPc(pc);
      }
    } catch (error) {
      console.error("Error accessing media devices:", error);
      toast.error("Could not access camera or microphone");
    }
  };

  // Enhance screen share to replace outgoing tracks to all peers and revert cleanly
  const toggleScreenShare = async () => {
    try {
      if (!isScreenSharing) {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true
        });

        const screenVideoTrack = screenStream.getVideoTracks()[0] || null;

        if (videoRef.current) {
          videoRef.current.srcObject = screenStream;
        }

        // Replace outgoing video to peers
        replaceOutgoingVideoTrack(screenVideoTrack);

        // When user stops sharing using browser UI, revert to camera
        if (screenVideoTrack) {
          screenVideoTrack.onended = async () => {
            await initializeMedia();
            const camTrack = localStreamRef.current?.getVideoTracks()[0] || null;
            replaceOutgoingVideoTrack(camTrack);
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
          if (s.kind === "offer") {
            const pc = ensurePeerConnection(fromId);
            const remoteDesc = new RTCSessionDescription({ type: "offer", sdp: s.payload.sdp! });
            try {
              if (pc.signalingState !== "stable") {
                // Try rollback if we've created an offer already
                try {
                  await pc.setLocalDescription({ type: "rollback" } as any);
                } catch (e) {
                  // If rollback fails, ignore this offer to avoid state errors
                  console.warn("Rollback failed; ignoring offer", e);
                  continue;
                }
              }
              await pc.setRemoteDescription(remoteDesc);
              // Only answer if we're in the correct state
              if (pc.signalingState !== "have-remote-offer") {
                continue;
              }
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              await sendSignal({
                roomId: roomId as any,
                fromUserId: (user as any)._id,
                toUserId: fromId as any,
                kind: "answer",
                payload: { sdp: answer.sdp || "", type: answer.type },
              });
            } catch (e) {
              console.error("Error handling offer", e);
            }
          } else if (s.kind === "answer") {
            const pc = ensurePeerConnection(fromId);
            try {
              // Only set remote answer if we actually have a local offer outstanding
              if (pc.signalingState !== "have-local-offer") {
                continue;
              }
              const remoteDesc = new RTCSessionDescription({ type: "answer", sdp: s.payload.sdp! });
              await pc.setRemoteDescription(remoteDesc);
            } catch (e) {
              console.error("Error handling answer", e);
            }
          } else if (s.kind === "candidate") {
            const pc = ensurePeerConnection(fromId);
            if (s.payload.candidate) {
              try {
                await pc.addIceCandidate({
                  candidate: s.payload.candidate,
                  sdpMid: s.payload.sdpMid,
                  sdpMLineIndex: s.payload.sdpMLineIndex,
                } as RTCIceCandidateInit);
              } catch (e) {
                console.warn("Failed to add ICE candidate", e);
              }
            }
          } else if (s.kind === "leave") {
            // Remote peer left
            const pc = peerConnectionsRef.current.get(fromId);
            pc?.close();
            peerConnectionsRef.current.delete(fromId);
            remoteStreamsRef.current.delete(fromId);
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

  const RemoteVideos = () => {
    const entries = Array.from(remoteStreamsRef.current.entries());
    return (
      <div className="absolute top-4 right-4 flex flex-col gap-2 max-h-[60vh] overflow-y-auto">
        {entries.map(([uid, stream]) => (
          <motion.div
            key={uid}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-40 h-28 bg-gray-700 rounded-lg overflow-hidden relative"
          >
            <video
              autoPlay
              playsInline
              className="w-full h-full object-cover"
              ref={(el) => {
                if (el && el.srcObject !== stream) {
                  el.srcObject = stream;
                }
              }}
              muted={false}
            />
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
              className="w-full h-full object-cover"
            />
            
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