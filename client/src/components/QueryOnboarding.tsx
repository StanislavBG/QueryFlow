import { useState, useRef, useCallback } from "react";
import { useCreateSqlQuery } from "@/hooks/use-sql-queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  FileCode2,
  Upload,
  Loader2,
  ClipboardPaste,
  Plus,
  Sparkles,
  ArrowRight,
} from "lucide-react";

interface QueryOnboardingProps {
  onQueryCreated: (id: number) => void;
}

export function QueryOnboarding({ onQueryCreated }: QueryOnboardingProps) {
  const createMutation = useCreateSqlQuery();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [queryTitle, setQueryTitle] = useState("");

  const createQuery = useCallback(
    (title: string, content: string) => {
      createMutation.mutate(
        { title: title || "Untitled Query", content },
        {
          onSuccess: (query) => {
            onQueryCreated(query.id);
            toast({
              title: "Query created",
              description: content
                ? `"${query.title}" loaded with your SQL.`
                : `"${query.title}" is ready — start writing SQL.`,
            });
            setQueryTitle("");
          },
          onError: (err) => {
            toast({
              title: "Error",
              description: err.message,
              variant: "destructive",
            });
          },
        }
      );
    },
    [createMutation, onQueryCreated, toast]
  );

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      file.text().then((content) => {
        const name = queryTitle.trim() || file.name.replace(/\.[^.]+$/, "");
        createQuery(name, content);
      });
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        const file = files[0];
        file.text().then((content) => {
          const name = queryTitle.trim() || file.name.replace(/\.[^.]+$/, "");
          createQuery(name, content);
        });
      }
    },
    [queryTitle, createQuery]
  );

  const handlePaste = useCallback(() => {
    navigator.clipboard
      .readText()
      .then((text) => {
        if (!text.trim()) {
          toast({
            title: "Clipboard empty",
            description: "No SQL content found in clipboard.",
            variant: "destructive",
          });
          return;
        }
        const name = queryTitle.trim() || "Pasted Query";
        createQuery(name, text);
      })
      .catch(() => {
        toast({
          title: "Paste failed",
          description: "Allow clipboard access to paste SQL.",
          variant: "destructive",
        });
      });
  }, [queryTitle, createQuery, toast]);

  const handleNewBlank = useCallback(() => {
    const name = queryTitle.trim() || "Untitled Query";
    createQuery(name, "");
  }, [queryTitle, createQuery]);

  return (
    <div className="flex flex-col items-center justify-center h-full px-8 gap-4">
      <div className="p-3 rounded-2xl bg-gradient-to-br from-primary/10 to-purple-600/10 border border-primary/10">
        <FileCode2 className="w-10 h-10 text-primary" />
      </div>

      <div className="text-center">
        <p className="text-sm font-medium text-foreground">
          Write Your First Query
        </p>
        <p className="text-xs text-muted-foreground mt-1 max-w-xs leading-relaxed">
          Paste existing SQL, drop a .sql file, or start from scratch.
          QueryFlow will analyze your query with AI and provide instant
          feedback.
        </p>
      </div>

      <div className="w-full max-w-sm space-y-2">
        <Input
          value={queryTitle}
          onChange={(e) => setQueryTitle(e.target.value)}
          placeholder="Query name (optional)"
          className="h-8 text-xs"
        />

        {/* Drag-and-drop zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
            isDragOver
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50"
          }`}
        >
          <Upload className="w-6 h-6 mx-auto mb-2 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            Drop a .sql file or click to upload
          </p>
          <p className="text-[10px] text-muted-foreground/60 mt-1">
            SQL, TXT, or any text file
          </p>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".sql,.txt,.csv,.json"
          onChange={handleFileSelect}
          className="hidden"
        />

        {/* Action buttons */}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="flex-1 h-8 text-xs"
            onClick={handlePaste}
            disabled={createMutation.isPending}
          >
            <ClipboardPaste className="w-3 h-3 mr-1.5" />
            Paste from Clipboard
          </Button>

          <Button
            size="sm"
            variant="outline"
            className="flex-1 h-8 text-xs"
            onClick={handleNewBlank}
            disabled={createMutation.isPending}
          >
            <Plus className="w-3 h-3 mr-1.5" />
            New Blank Query
          </Button>
        </div>

        {createMutation.isPending && (
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground py-2">
            <Loader2 className="w-3 h-3 animate-spin" />
            Creating query...
          </div>
        )}
      </div>

      {/* Helpful tips */}
      <div className="w-full max-w-sm mt-2">
        <div className="rounded-lg border border-border/50 bg-card/50 p-3 space-y-2">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            What happens next
          </p>
          {[
            {
              icon: Sparkles,
              text: "AI analyzes your query for bugs, performance issues, and security risks",
              color: "text-primary",
            },
            {
              icon: ArrowRight,
              text: "Get actionable suggestions with one-click apply",
              color: "text-emerald-500",
            },
          ].map((tip) => {
            const Icon = tip.icon;
            return (
              <div key={tip.text} className="flex items-start gap-2">
                <Icon
                  className={`w-3 h-3 mt-0.5 flex-shrink-0 ${tip.color}`}
                />
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  {tip.text}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
