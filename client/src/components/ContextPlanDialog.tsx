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

function getBlockTokens(block: ContextBlock): number {
  return block.charCount ? estimateTokens(block.charCount) : estimateTokens(block.content.length);
}

interface BillLineItemProps {
  block: ContextBlock;
  totalTokens: number;
}

function BillLineItem({ block, totalTokens }: BillLineItemProps) {
  const [open, setOpen] = useState(false);
  const Icon = blockIconMap[block.key] || Activity;
  const color = blockColorMap[block.key] || "text-muted-foreground";
  const description = block.description;
  const tokens = getBlockTokens(block);
  const pct = totalTokens > 0 ? (tokens / totalTokens) * 100 : 0;
  const chars = block.charCount || block.content.length;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button className="w-full flex items-center gap-2 px-3 py-2 border-b border-border/40 hover:bg-accent/30 transition-colors text-left group">
          <ChevronRight className={`w-3 h-3 flex-shrink-0 text-muted-foreground/50 transition-transform ${open ? "rotate-90" : ""}`} />
          <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${color}`} />
          <span className="text-xs font-medium text-foreground truncate">
            {block.label}
          </span>
          {block.itemCount !== undefined && (
            <Badge variant="secondary" className="text-[9px] h-4 px-1.5 flex-shrink-0">{block.itemCount}</Badge>
          )}
          {/* Right-aligned numeric columns */}
          <div className="flex items-center gap-0 ml-auto flex-shrink-0 font-mono tabular-nums">
            <span className="text-[10px] text-muted-foreground/60 w-[70px] text-right">
              {chars.toLocaleString()}
            </span>
            <span className="text-xs font-medium text-foreground w-[70px] text-right">
              {formatTokens(tokens)}
            </span>
            <span className="text-[10px] text-muted-foreground w-[48px] text-right">
              {pct < 0.1 && pct > 0 ? "<0.1" : pct.toFixed(1)}%
            </span>
          </div>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-8 mr-3 mt-1 mb-2 pl-3 border-l-2 border-border/60">
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

  // Calculate total estimated tokens across all context blocks
  const totalChars = blocks?.reduce((sum, b) => sum + (b.charCount || b.content.length), 0) || 0;
  const totalTokens = estimateTokens(totalChars);
  const contextLimit = MODEL.contextTokens; // 1M for GPT-4.1
  const isOverLimit = totalTokens > contextLimit;

  // Sort blocks by token count descending (highest cost first)
  const sortedBlocks = blocks
    ? [...blocks].sort((a, b) => getBlockTokens(b) - getBlockTokens(a))
    : null;

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
                {sortedBlocks?.length || 0} item{(sortedBlocks?.length || 0) !== 1 ? "s" : ""}
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

        {/* Column headers */}
        {sortedBlocks && sortedBlocks.length > 0 && (
          <div className="flex items-center gap-2 px-3 pt-1 pb-1.5 border-b border-border text-[10px] text-muted-foreground/70 uppercase tracking-wider font-medium">
            {/* Spacer for chevron + icon */}
            <div className="w-[22px] flex-shrink-0" />
            <span className="truncate">Context Block</span>
            <div className="flex items-center gap-0 ml-auto flex-shrink-0 font-mono">
              <span className="w-[70px] text-right">Chars</span>
              <span className="w-[70px] text-right">Tokens</span>
              <span className="w-[48px] text-right">%</span>
            </div>
          </div>
        )}

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="py-0">
            {contextMutation.isPending && !blocks ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : contextMutation.isError ? (
              <div className="text-center py-8">
                <p className="text-xs text-destructive">Failed to load context</p>
              </div>
            ) : sortedBlocks && sortedBlocks.length > 0 ? (
              sortedBlocks.map((block) => (
                <BillLineItem key={block.key} block={block} totalTokens={totalTokens} />
              ))
            ) : (
              <div className="text-center py-8">
                <p className="text-xs text-muted-foreground">No context available. Select a query first.</p>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Bill total footer */}
        {sortedBlocks && sortedBlocks.length > 0 && (
          <div className={`rounded-md border px-3 py-2 ${
            isOverLimit
              ? "bg-destructive/10 border-destructive/30"
              : "bg-muted/40 border-border"
          }`}>
            {/* Total row */}
            <div className="flex items-center gap-2">
              <span className={`text-xs font-bold uppercase tracking-wide ${
                isOverLimit ? "text-destructive" : "text-foreground"
              }`}>
                Total
              </span>
              <div className="flex items-center gap-0 ml-auto flex-shrink-0 font-mono tabular-nums">
                <span className={`text-[10px] w-[70px] text-right ${
                  isOverLimit ? "text-destructive/70" : "text-muted-foreground"
                }`}>
                  {totalChars.toLocaleString()}
                </span>
                <span className={`text-sm font-bold w-[70px] text-right ${
                  isOverLimit ? "text-destructive" : "text-foreground"
                }`}>
                  {formatTokens(totalTokens)}
                </span>
                <span className={`text-[10px] font-medium w-[48px] text-right ${
                  isOverLimit ? "text-destructive/70" : "text-muted-foreground"
                }`}>
                  100%
                </span>
              </div>
            </div>
            {/* Context limit line */}
            <div className="flex items-center justify-between mt-1 pt-1 border-t border-border/40">
              <span className="text-[10px] text-muted-foreground">
                {MODEL.name} context window
              </span>
              <span className={`text-[10px] font-mono tabular-nums ${
                isOverLimit ? "text-destructive font-medium" : "text-muted-foreground"
              }`}>
                {formatTokens(totalTokens)} / {formatTokens(contextLimit)} tokens
                {isOverLimit && " — over limit"}
              </span>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
