import { useQueryFeedback, useAnalyzeQuery, useResolveFeedback } from "@/hooks/use-sql-queries";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2,
  MessageSquare,
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Check,
  Search,
  Zap,
  Bug,
  Palette,
  PlayCircle,
  BookOpen,
} from "lucide-react";
import { useState } from "react";
import type { QueryFeedbackRow } from "@shared/schema";

const severityConfig = {
  error: {
    icon: AlertCircle,
    color: "text-destructive",
    bg: "bg-destructive/5",
    border: "border-destructive/20",
    label: "Needs attention",
  },
  warning: {
    icon: AlertTriangle,
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-500/5",
    border: "border-amber-500/20",
    label: "Consider reviewing",
  },
  info: {
    icon: Info,
    color: "text-primary",
    bg: "bg-primary/5",
    border: "border-primary/20",
    label: "Observation",
  },
  success: {
    icon: CheckCircle2,
    color: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-500/5",
    border: "border-emerald-500/20",
    label: "Looks good",
  },
};

const agentConfig = {
  structure: { icon: Search, label: "Structure", color: "text-muted-foreground" },
  optimization: { icon: Zap, label: "Performance", color: "text-muted-foreground" },
  error: { icon: Bug, label: "Correctness", color: "text-muted-foreground" },
  style: { icon: Palette, label: "Style", color: "text-muted-foreground" },
  documentation: { icon: BookOpen, label: "Documentation", color: "text-primary" },
};

function FeedbackCard({
  feedback,
  queryId,
}: {
  feedback: QueryFeedbackRow;
  queryId: number;
}) {
  const [expanded, setExpanded] = useState(!feedback.isResolved);
  const resolveMutation = useResolveFeedback();
  const severity = severityConfig[feedback.severity as keyof typeof severityConfig] || severityConfig.info;
  const agent = agentConfig[feedback.agentType as keyof typeof agentConfig] || agentConfig.structure;
  const SeverityIcon = severity.icon;
  const AgentIcon = agent.icon;

  return (
    <div
      className={`rounded-md border ${severity.border} ${severity.bg} ${
        feedback.isResolved ? "opacity-50" : ""
      }`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-start gap-2.5 p-3 text-left"
      >
        <SeverityIcon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${severity.color}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-medium">{feedback.title}</span>
            {feedback.isResolved && (
              <Badge variant="outline" className="text-[10px] h-4">
                Addressed
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] h-4">
              <AgentIcon className={`w-2.5 h-2.5 mr-1 ${agent.color}`} />
              {agent.label}
            </Badge>
            {feedback.lineNumber && (
              <span className="text-[10px] text-muted-foreground">Line {feedback.lineNumber}</span>
            )}
          </div>
        </div>
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          <p className="text-xs text-muted-foreground leading-relaxed pl-6.5">
            {feedback.message}
          </p>
          {feedback.suggestion && (
            <div className="ml-6.5 p-2 rounded-md bg-muted/50 border border-border">
              <p className="text-xs text-foreground/80 leading-relaxed">
                <span className="font-medium text-primary">Suggestion:</span> {feedback.suggestion}
              </p>
            </div>
          )}
          {!feedback.isResolved && (
            <div className="pl-6.5">
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  resolveMutation.mutate({ id: feedback.id, queryId });
                }}
                disabled={resolveMutation.isPending}
                className="h-6 text-[10px] text-muted-foreground"
              >
                <Check className="w-3 h-3 mr-1" />
                Mark as addressed
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface FeedbackPanelProps {
  queryId: number | null;
  dialect?: string;
}

export function FeedbackPanel({ queryId, dialect }: FeedbackPanelProps) {
  const { data: feedback, isLoading: isFeedbackLoading } = useQueryFeedback(queryId);
  const analyzeMutation = useAnalyzeQuery();
  const [filter, setFilter] = useState<string | null>(null);

  const handleAnalyze = () => {
    if (queryId) {
      analyzeMutation.mutate({ queryId, dialect });
    }
  };

  const filteredFeedback = feedback?.filter((f) => {
    if (!filter) return true;
    return f.agentType === filter;
  });

  const unresolvedCount = feedback?.filter(f => !f.isResolved).length || 0;
  const errorCount = feedback?.filter(f => f.severity === "error" && !f.isResolved).length || 0;
  const warningCount = feedback?.filter(f => f.severity === "warning" && !f.isResolved).length || 0;

  if (!queryId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground px-4">
        <MessageSquare className="w-8 h-8 mb-3 opacity-30" />
        <p className="text-sm text-center">Select a query to view analysis feedback.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-border space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Analysis</h3>
          <Button
            size="sm"
            onClick={handleAnalyze}
            disabled={analyzeMutation.isPending}
            className="h-7 text-xs"
          >
            {analyzeMutation.isPending ? (
              <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
            ) : (
              <PlayCircle className="w-3 h-3 mr-1.5" />
            )}
            Analyze
          </Button>
        </div>

        {/* Filter badges */}
        {feedback && feedback.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setFilter(null)}
              className={`px-2 py-0.5 rounded text-[10px] border ${
                !filter ? "bg-accent border-border" : "border-transparent hover:border-border"
              }`}
            >
              All ({feedback.length})
            </button>
            {Object.entries(agentConfig).map(([key, config]) => {
              const count = feedback.filter(f => f.agentType === key).length;
              if (count === 0) return null;
              const AgentIcon = config.icon;
              return (
                <button
                  key={key}
                  onClick={() => setFilter(filter === key ? null : key)}
                  className={`px-2 py-0.5 rounded text-[10px] border flex items-center gap-1 ${
                    filter === key ? "bg-accent border-border" : "border-transparent hover:border-border"
                  }`}
                >
                  <AgentIcon className="w-2.5 h-2.5" />
                  {count}
                </button>
              );
            })}
          </div>
        )}

        {/* Status summary */}
        {unresolvedCount > 0 && (
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            {errorCount > 0 && (
              <span>{errorCount} need{errorCount > 1 ? "" : "s"} attention</span>
            )}
            {warningCount > 0 && (
              <span>{warningCount} to review</span>
            )}
            <span>{unresolvedCount} open</span>
          </div>
        )}
      </div>

      {/* Feedback list */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {isFeedbackLoading || analyzeMutation.isPending ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mb-3" />
              <p className="text-xs text-muted-foreground">
                {analyzeMutation.isPending ? "Analyzing query..." : "Loading..."}
              </p>
            </div>
          ) : !filteredFeedback || filteredFeedback.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4">
              <CheckCircle2 className="w-8 h-8 mb-3 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground text-center">
                {feedback && feedback.length > 0
                  ? "No results match the current filter."
                  : "Click Analyze to get constructive feedback on your query."}
              </p>
            </div>
          ) : (
            filteredFeedback
              .sort((a, b) => {
                if (a.isResolved !== b.isResolved) return a.isResolved ? 1 : -1;
                const severityOrder: Record<string, number> = { error: 0, warning: 1, info: 2, success: 3 };
                return (severityOrder[a.severity] || 2) - (severityOrder[b.severity] || 2);
              })
              .map((item) => (
                <FeedbackCard key={item.id} feedback={item} queryId={queryId} />
              ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
