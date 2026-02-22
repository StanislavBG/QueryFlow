import { useEffect } from "react";
import { useAnalysisContext, type ContextBlock } from "@/hooks/use-sql-queries";
import { MODEL } from "@/lib/models";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Eye,
  ChevronRight,
  Code2,
  Database,
  MessageSquare,
  FileText,
  Tags,
  Activity,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

/** Map block keys to icons. Unknown keys get a generic icon. */
const blockIconMap: Record<string, LucideIcon> = {
  system_prompt: MessageSquare,
  query: Code2,
  dialect: Database,
  categories: Tags,
  schemas: Database,
  documents: FileText,
  feedback_accepted: CheckCircle2,
  feedback_dismissed: XCircle,
  feedback_unresolved: AlertCircle,
  llm_status: Activity,
};

/** Map block keys to color classes. */
const blockColorMap: Record<string, string> = {
  system_prompt: "text-muted-foreground",
  query: "text-primary",
  dialect: "text-muted-foreground",
  categories: "text-muted-foreground",
  schemas: "text-blue-500",
  documents: "text-amber-500",
  feedback_accepted: "text-emerald-500",
  feedback_dismissed: "text-destructive",
  feedback_unresolved: "text-amber-500",
  llm_status: "text-muted-foreground",
};


/** Rough token estimate: ~4 chars per token for English/SQL text */
function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(tokens);
}

function ContextBlockRow({ block }: { block: ContextBlock }) {
  const [open, setOpen] = useState(false);
  const Icon = blockIconMap[block.key] || Activity;
  const color = blockColorMap[block.key] || "text-muted-foreground";
  const description = block.description;
  const isShort = block.content.length < 100 && !block.content.includes("\n");
  const tokens = block.charCount ? estimateTokens(block.charCount) : estimateTokens(block.content.length);

  // Short blocks (dialect, status) render inline without collapsible
  if (isShort) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-card">
        <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${color}`} />
        <span className="text-xs font-medium text-foreground">{block.label}</span>
        {block.itemCount !== undefined && (
          <Badge variant="secondary" className="text-[9px] h-4 px-1.5">{block.itemCount}</Badge>
        )}
        <Badge variant="outline" className="text-[9px] h-4 px-1.5 font-mono ml-auto">
          ~{formatTokens(tokens)} tok
        </Badge>
        <span className="text-xs text-muted-foreground font-mono truncate max-w-[40%] text-right">
          {block.content}
        </span>
      </div>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button className="w-full flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-card hover:bg-accent/50 transition-colors text-left">
          <ChevronRight className={`w-3 h-3 flex-shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
          <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${color}`} />
          <span className="text-xs font-medium text-foreground">{block.label}</span>
          {block.itemCount !== undefined && (
            <Badge variant="secondary" className="text-[9px] h-4 px-1.5">{block.itemCount}</Badge>
          )}
          <div className="flex items-center gap-2 ml-auto">
            <Badge variant="outline" className="text-[9px] h-4 px-1.5 font-mono">
              ~{formatTokens(tokens)} tok
            </Badge>
            <span className="text-[10px] text-muted-foreground">
              {block.charCount?.toLocaleString() || block.content.length.toLocaleString()} chars
            </span>
          </div>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-3 mt-1 mb-2 pl-4 border-l-2 border-border">
          {description && (
            <p className="text-[10px] text-muted-foreground italic mb-1.5">{description}</p>
          )}
          <pre className="text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap font-mono p-2 rounded bg-muted/30 max-h-48 overflow-auto">
            {block.content}
          </pre>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

interface ContextPlanDialogProps {
  queryId: number | null;
  dialect?: string;
  queryContent?: string;
}

export function ContextPlanDialog({ queryId, dialect, queryContent }: ContextPlanDialogProps) {
  const contextMutation = useAnalysisContext();
  const [dialogOpen, setDialogOpen] = useState(false);

  // Fetch context whenever dialog opens or inputs change while open
  useEffect(() => {
    if (dialogOpen && queryId) {
      contextMutation.mutate({ queryId, dialect, content: queryContent });
    }
  }, [dialogOpen, queryId, dialect, queryContent]);

  const blocks = contextMutation.data;
  const totalBlocks = blocks?.length || 0;

  // Calculate total estimated tokens across all context blocks
  const totalChars = blocks?.reduce((sum, b) => sum + (b.charCount || b.content.length), 0) || 0;
  const totalTokens = estimateTokens(totalChars);
  const contextLimit = MODEL.contextTokens; // 1M for GPT-4.1
  const isOverLimit = totalTokens > contextLimit;

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={!queryId}>
          <Eye className="w-4 h-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-sm">Analysis Context Plan</DialogTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px] h-5">
                {totalBlocks} block{totalBlocks !== 1 ? "s" : ""}
              </Badge>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0"
                disabled={contextMutation.isPending || !queryId}
                onClick={() => {
                  if (queryId) contextMutation.mutate({ queryId, dialect, content: queryContent });
                }}
              >
                <RefreshCw className={`w-3 h-3 ${contextMutation.isPending ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Live preview of what the analyzer LLM will receive. Changes to your query, feedback actions, and schema updates are reflected here.
          </p>
        </DialogHeader>

        {/* Token usage summary bar */}
        {blocks && blocks.length > 0 && (
          <div className={`flex items-center justify-between px-3 py-2 rounded-md border text-xs ${
            isOverLimit
              ? "bg-destructive/10 border-destructive/30 text-destructive"
              : "bg-muted/50 border-border text-muted-foreground"
          }`}>
            <span className="font-medium">
              Estimated context: <span className="font-mono font-bold">{formatTokens(totalTokens)}</span> tokens
              <span className="opacity-60 ml-1">({totalChars.toLocaleString()} chars)</span>
            </span>
            <span className="font-mono text-[10px]">
              {MODEL.name} context: {formatTokens(contextLimit)}
            </span>
          </div>
        )}

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-1.5 py-2">
            {contextMutation.isPending && !blocks ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : contextMutation.isError ? (
              <div className="text-center py-8">
                <p className="text-xs text-destructive">Failed to load context</p>
              </div>
            ) : blocks && blocks.length > 0 ? (
              blocks.map((block) => (
                <ContextBlockRow key={block.key} block={block} />
              ))
            ) : (
              <div className="text-center py-8">
                <p className="text-xs text-muted-foreground">No context available. Select a query first.</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
