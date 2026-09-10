import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Camera, Mic, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";

export interface DeviceSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentCameraId?: string;
  currentMicId?: string;
  currentSpeakerId?: string;
  onSelectCamera: (deviceId: string) => void;
  onSelectMic: (deviceId: string) => void;
  onSelectSpeaker: (deviceId: string) => void;
}

/**
 * Camera / microphone / speaker picker. Enumerates devices when opened. Labels
 * are only populated once media permission has been granted, so the empty state
 * nudges the user to start the call first if the lists come back blank.
 *
 * Speaker selection depends on HTMLMediaElement.setSinkId, which not every
 * browser exposes; the row hides itself when it's unavailable.
 */
export function DeviceSettingsDialog({
  open,
  onOpenChange,
  currentCameraId,
  currentMicId,
  currentSpeakerId,
  onSelectCamera,
  onSelectMic,
  onSelectSpeaker,
}: DeviceSettingsDialogProps) {
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [speakers, setSpeakers] = useState<MediaDeviceInfo[]>([]);

  const speakerSelectionSupported =
    typeof window !== "undefined" &&
    "setSinkId" in HTMLMediaElement.prototype;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const refresh = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        setCameras(devices.filter((d) => d.kind === "videoinput"));
        setMics(devices.filter((d) => d.kind === "audioinput"));
        setSpeakers(devices.filter((d) => d.kind === "audiooutput"));
      } catch {
        // enumerateDevices can reject before permission is granted; ignore.
      }
    };

    refresh();
    navigator.mediaDevices.addEventListener?.("devicechange", refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener?.("devicechange", refresh);
    };
  }, [open]);

  const labelFor = (d: MediaDeviceInfo, fallback: string, i: number) =>
    d.label || `${fallback} ${i + 1}`;

  const nothingListed = cameras.length === 0 && mics.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border border-gray-700 bg-gray-800 text-white">
        <DialogHeader>
          <DialogTitle>Call settings</DialogTitle>
          <DialogDescription className="text-gray-400">
            Choose which camera, microphone, and speaker this call should use.
          </DialogDescription>
        </DialogHeader>

        {nothingListed ? (
          <p className="rounded-lg border border-gray-700 bg-gray-900/60 p-3 text-sm text-gray-300">
            No devices detected yet. Allow camera and microphone access, then reopen
            this dialog.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-2 text-gray-300">
                <Camera className="h-4 w-4" /> Camera
              </Label>
              <Select value={currentCameraId} onValueChange={onSelectCamera}>
                <SelectTrigger className="w-full border-gray-600 bg-gray-700 text-white">
                  <SelectValue placeholder="Select a camera" />
                </SelectTrigger>
                <SelectContent>
                  {cameras.map((d, i) => (
                    <SelectItem key={d.deviceId || i} value={d.deviceId}>
                      {labelFor(d, "Camera", i)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2 text-gray-300">
                <Mic className="h-4 w-4" /> Microphone
              </Label>
              <Select value={currentMicId} onValueChange={onSelectMic}>
                <SelectTrigger className="w-full border-gray-600 bg-gray-700 text-white">
                  <SelectValue placeholder="Select a microphone" />
                </SelectTrigger>
                <SelectContent>
                  {mics.map((d, i) => (
                    <SelectItem key={d.deviceId || i} value={d.deviceId}>
                      {labelFor(d, "Microphone", i)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {speakerSelectionSupported && speakers.length > 0 && (
              <div className="space-y-2">
                <Label className="flex items-center gap-2 text-gray-300">
                  <Volume2 className="h-4 w-4" /> Speaker
                </Label>
                <Select value={currentSpeakerId} onValueChange={onSelectSpeaker}>
                  <SelectTrigger className="w-full border-gray-600 bg-gray-700 text-white">
                    <SelectValue placeholder="Select a speaker" />
                  </SelectTrigger>
                  <SelectContent>
                    {speakers.map((d, i) => (
                      <SelectItem key={d.deviceId || i} value={d.deviceId}>
                        {labelFor(d, "Speaker", i)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} className="bg-blue-600 hover:bg-blue-700">
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
