import { useQueryFeedback, useAnalyzeQuery, useResolveFeedback } from "@/hooks/use-sql-queries";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2,
  Sparkles,
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
} from "lucide-react";
import { useState } from "react";
import type { QueryFeedbackRow } from "@shared/schema";

const severityConfig = {
  error: {
    icon: AlertCircle,
    color: "text-red-400",
    bg: "bg-red-500/10",
    border: "border-red-500/20",
    label: "Error",
  },
  warning: {
    icon: AlertTriangle,
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
    label: "Warning",
  },
  info: {
    icon: Info,
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
    label: "Info",
  },
  success: {
    icon: CheckCircle2,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
    label: "Good",
  },
};

const agentConfig = {
  structure: { icon: Search, label: "Structure", color: "text-cyan-400" },
  optimization: { icon: Zap, label: "Optimization", color: "text-amber-400" },
  error: { icon: Bug, label: "Error Detection", color: "text-red-400" },
  style: { icon: Palette, label: "Style", color: "text-purple-400" },
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
      className={`rounded-lg border ${severity.border} ${severity.bg} ${
        feedback.isResolved ? "opacity-50" : ""
      } transition-all`}
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
              <Badge variant="outline" className="text-[10px] h-4 bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                Resolved
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] h-4 border-white/10">
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
            <div className="ml-6.5 p-2 rounded-md bg-background/50 border border-white/5">
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
                className="h-6 text-[10px] text-muted-foreground hover:text-emerald-400"
              >
                <Check className="w-3 h-3 mr-1" />
                Mark as resolved
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
}

export function FeedbackPanel({ queryId }: FeedbackPanelProps) {
  const { data: feedback, isLoading: isFeedbackLoading } = useQueryFeedback(queryId);
  const analyzeMutation = useAnalyzeQuery();
  const [filter, setFilter] = useState<string | null>(null);

  const handleAnalyze = () => {
    if (queryId) {
      analyzeMutation.mutate(queryId);
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
        <Sparkles className="w-8 h-8 mb-3 opacity-30" />
        <p className="text-sm text-center">Select a query to see feedback from the analysis agents.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-white/10 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Agent Feedback</h3>
          <Button
            size="sm"
            onClick={handleAnalyze}
            disabled={analyzeMutation.isPending}
            className="h-7 text-xs bg-gradient-to-r from-primary to-purple-600 hover:opacity-90"
          >
            {analyzeMutation.isPending ? (
              <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
            ) : (
              <Sparkles className="w-3 h-3 mr-1.5" />
            )}
            Analyze
          </Button>
        </div>

        {/* Summary badges */}
        {feedback && feedback.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setFilter(null)}
              className={`px-2 py-0.5 rounded-full text-[10px] border transition-colors ${
                !filter ? "bg-white/10 border-white/20" : "border-white/5 hover:border-white/10"
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
                  className={`px-2 py-0.5 rounded-full text-[10px] border transition-colors flex items-center gap-1 ${
                    filter === key ? "bg-white/10 border-white/20" : "border-white/5 hover:border-white/10"
                  }`}
                >
                  <AgentIcon className={`w-2.5 h-2.5 ${config.color}`} />
                  {count}
                </button>
              );
            })}
          </div>
        )}

        {/* Status summary */}
        {unresolvedCount > 0 && (
          <div className="flex items-center gap-2 text-[10px]">
            {errorCount > 0 && (
              <span className="text-red-400">{errorCount} error{errorCount > 1 ? "s" : ""}</span>
            )}
            {warningCount > 0 && (
              <span className="text-amber-400">{warningCount} warning{warningCount > 1 ? "s" : ""}</span>
            )}
            <span className="text-muted-foreground">{unresolvedCount} unresolved</span>
          </div>
        )}
      </div>

      {/* Feedback list */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {isFeedbackLoading || analyzeMutation.isPending ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-primary mb-3" />
              <p className="text-xs text-muted-foreground">
                {analyzeMutation.isPending ? "Running agents..." : "Loading feedback..."}
              </p>
            </div>
          ) : !filteredFeedback || filteredFeedback.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4">
              <CheckCircle2 className="w-8 h-8 mb-3 text-emerald-400/30" />
              <p className="text-sm text-muted-foreground text-center">
                {feedback && feedback.length > 0
                  ? "No feedback matches the current filter."
                  : 'Click "Analyze" to get feedback from the specialized agents.'}
              </p>
            </div>
          ) : (
            filteredFeedback
              .sort((a, b) => {
                // Sort: unresolved first, then by severity
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
