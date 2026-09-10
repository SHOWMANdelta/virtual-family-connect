import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  Maximize,
  MessageCircle,
  Mic,
  MicOff,
  MonitorUp,
  MoreVertical,
  PhoneOff,
  RefreshCcw,
  Settings,
  Video,
  VideoOff,
} from "lucide-react";
import type { ReactNode } from "react";

interface ControlButtonProps {
  label: string;
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
  danger?: boolean;
  className?: string;
}

function ControlButton({ label, onClick, children, active, danger, className }: ControlButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          className={cn(
            "flex h-12 w-12 items-center justify-center rounded-full text-white transition-colors",
            danger
              ? "bg-red-600 hover:bg-red-700"
              : active
                ? "bg-gray-700 hover:bg-gray-600"
                : "bg-red-600 hover:bg-red-700",
            className,
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export interface CallControlsProps {
  isAudioOn: boolean;
  isVideoOn: boolean;
  isScreenSharing: boolean;
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onToggleScreenShare: () => void;
  onToggleChat: () => void;
  onOpenSettings: () => void;
  onToggleFullscreen: () => void;
  onRetry: () => void;
  onLeave: () => void;
}

/**
 * The in-call control bar. Lives in its own row beneath the video stage — it is
 * no longer absolutely positioned over the video, so tiles and controls can't
 * collide. Secondary actions (fullscreen, reconnect) sit behind an overflow menu
 * to keep the primary row uncluttered.
 */
export function CallControls({
  isAudioOn,
  isVideoOn,
  isScreenSharing,
  onToggleAudio,
  onToggleVideo,
  onToggleScreenShare,
  onToggleChat,
  onOpenSettings,
  onToggleFullscreen,
  onRetry,
  onLeave,
}: CallControlsProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center justify-center gap-2 sm:gap-3">
        <ControlButton
          label={isAudioOn ? "Mute microphone" : "Unmute microphone"}
          onClick={onToggleAudio}
          active={isAudioOn}
        >
          {isAudioOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
        </ControlButton>

        <ControlButton
          label={isVideoOn ? "Turn camera off" : "Turn camera on"}
          onClick={onToggleVideo}
          active={isVideoOn}
        >
          {isVideoOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
        </ControlButton>

        <ControlButton
          label={isScreenSharing ? "Stop sharing screen" : "Share screen"}
          onClick={onToggleScreenShare}
          active
          className={isScreenSharing ? "bg-blue-600 hover:bg-blue-700" : undefined}
        >
          <MonitorUp className="h-5 w-5" />
        </ControlButton>

        <ControlButton label="Toggle chat" onClick={onToggleChat} active>
          <MessageCircle className="h-5 w-5" />
        </ControlButton>

        <ControlButton label="Call settings" onClick={onOpenSettings} active>
          <Settings className="h-5 w-5" />
        </ControlButton>

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="More options"
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-700 text-white transition-colors hover:bg-gray-600"
                >
                  <MoreVertical className="h-5 w-5" />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>More options</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="center" side="top" className="mb-2">
            <DropdownMenuItem onClick={onToggleFullscreen}>
              <Maximize className="mr-2 h-4 w-4" />
              Fullscreen
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onRetry}>
              <RefreshCcw className="mr-2 h-4 w-4" />
              Reconnect
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <ControlButton label="Leave call" onClick={onLeave} danger className="ml-1 sm:ml-2">
          <PhoneOff className="h-5 w-5" />
        </ControlButton>
      </div>
    </TooltipProvider>
  );
}
