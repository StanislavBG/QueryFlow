import { useState, useRef, useCallback } from "react";
import { Mic, MicOff, Loader2, Save, Trash2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useUpsertSchemaVoiceContext, useDeleteSchemaVoiceContext, useTranscribeAudio } from "@/hooks/use-sql-queries";
import { useToast } from "@/hooks/use-toast";
import type { SchemaVoiceContext } from "@shared/schema";

type RecordingState = "idle" | "recording" | "stopped";

interface VoiceContextButtonProps {
  schemaId: number;
  targetType: "schema" | "table" | "column";
  targetTable?: string;
  targetColumn?: string;
  existingContext?: SchemaVoiceContext;
  onSaved?: () => void;
  size?: "sm" | "lg";
}

export function VoiceContextButton({
  schemaId,
  targetType,
  targetTable,
  targetColumn,
  existingContext,
  onSaved,
  size = "sm",
}: VoiceContextButtonProps) {
  const [open, setOpen] = useState(false);
  const [transcript, setTranscript] = useState(existingContext?.transcript ?? "");
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const upsertMutation = useUpsertSchemaVoiceContext();
  const deleteMutation = useDeleteSchemaVoiceContext();
  const transcribeMutation = useTranscribeAudio();
  const { toast } = useToast();

  const hasContext = !!existingContext && !!existingContext.transcript;
  const isSmall = size === "sm";

  // Sync transcript when popover opens
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen) {
      setTranscript(existingContext?.transcript ?? "");
    }
    setOpen(nextOpen);
  }, [existingContext?.transcript]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
      });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.start(100);
      setRecordingState("recording");
    } catch {
      toast({ title: "Microphone access denied", variant: "destructive" });
    }
  }, [toast]);

  const stopRecording = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "recording") return;

    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        const b = new Blob(chunksRef.current, { type: "audio/webm" });
        recorder.stream.getTracks().forEach((t) => t.stop());
        resolve(b);
      };
      recorder.stop();
    });

    setRecordingState("stopped");

    if (blob.size === 0) return;

    // Convert to base64 and transcribe
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(",")[1];
      transcribeMutation.mutate(
        { schemaId, audio: base64 },
        {
          onSuccess: (data) => {
            setTranscript((prev) => (prev ? prev + "\n" + data.transcript : data.transcript));
          },
          onError: () => {
            toast({ title: "Transcription failed", variant: "destructive" });
          },
        }
      );
    };
    reader.readAsDataURL(blob);
  }, [schemaId, transcribeMutation, toast]);

  const handleSave = useCallback(() => {
    upsertMutation.mutate(
      {
        schemaId,
        targetType,
        targetTable: targetTable ?? null,
        targetColumn: targetColumn ?? null,
        transcript: transcript.trim(),
      },
      {
        onSuccess: () => {
          toast({ title: "Context saved" });
          setOpen(false);
          onSaved?.();
        },
        onError: () => {
          toast({ title: "Failed to save context", variant: "destructive" });
        },
      }
    );
  }, [schemaId, targetType, targetTable, targetColumn, transcript, upsertMutation, toast, onSaved]);

  const handleDelete = useCallback(() => {
    if (!existingContext) return;
    deleteMutation.mutate(
      { schemaId, id: existingContext.id },
      {
        onSuccess: () => {
          toast({ title: "Context removed" });
          setTranscript("");
          setOpen(false);
          onSaved?.();
        },
        onError: () => {
          toast({ title: "Failed to delete context", variant: "destructive" });
        },
      }
    );
  }, [existingContext, schemaId, deleteMutation, toast, onSaved]);

  const targetLabel =
    targetType === "column" ? `${targetTable}.${targetColumn}` :
    targetType === "table" ? targetTable :
    "schema";

  const iconSize = isSmall ? "w-3 h-3" : "w-5 h-5";
  const btnSize = isSmall ? "h-5 w-5 p-0" : "h-8 w-8 p-0";

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className={`${btnSize} inline-flex items-center justify-center rounded flex-shrink-0 transition-colors hover:bg-accent/50`}
              onClick={(e) => e.stopPropagation()}
            >
              <Mic className={`${iconSize} ${hasContext ? "text-muted-foreground" : "text-red-500"}`} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p className="text-xs">{hasContext ? "Edit context" : "Add context"} for {targetLabel}</p>
          </TooltipContent>
        </Tooltip>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 p-3"
        side="right"
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-2">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Context for {targetLabel}
          </p>

          <Textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder="Type or record context about this item..."
            className="text-xs min-h-[60px] max-h-[120px]"
          />

          {/* Recording controls */}
          <div className="flex items-center gap-1.5">
            {recordingState === "recording" ? (
              <Button
                size="sm"
                variant="destructive"
                className="h-7 text-[10px] gap-1"
                onClick={stopRecording}
              >
                <Square className="w-3 h-3" />
                Stop
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[10px] gap-1"
                onClick={startRecording}
                disabled={transcribeMutation.isPending}
              >
                {transcribeMutation.isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Mic className="w-3 h-3" />
                )}
                Record
              </Button>
            )}

            {recordingState === "recording" && (
              <span className="text-[10px] text-red-500 animate-pulse">Recording...</span>
            )}
            {transcribeMutation.isPending && (
              <span className="text-[10px] text-muted-foreground">Transcribing...</span>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1.5 pt-1 border-t border-border">
            <Button
              size="sm"
              className="h-7 text-[10px] gap-1 flex-1"
              onClick={handleSave}
              disabled={!transcript.trim() || upsertMutation.isPending}
            >
              {upsertMutation.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Save className="w-3 h-3" />
              )}
              Save
            </Button>

            {hasContext && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-[10px] gap-1 text-destructive hover:text-destructive"
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Trash2 className="w-3 h-3" />
                )}
                Remove
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
