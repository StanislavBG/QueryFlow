import { useQueryFeedback, useResolveFeedback, useDismissFeedback, useDeleteFeedbackItem, type AnalysisProgress } from "@/hooks/use-sql-queries";
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
  X,
  Trash2,
  Search,
  Zap,
  Bug,
  Palette,
  BookOpen,
  AlignLeft,
  Shield,
  Scale,
  Database,
  Lightbulb,
  Tag,
} from "lucide-react";
import { useState, useCallback, useMemo, useEffect } from "react";
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

// Known category icons/labels, with a fallback for dynamic LLM categories
const knownAgentConfig: Record<string, { icon: typeof Search; label: string }> = {
  structure: { icon: Search, label: "Structure" },
  optimization: { icon: Zap, label: "Performance" },
  error: { icon: Bug, label: "Correctness" },
  style: { icon: Palette, label: "Style" },
  formatting: { icon: AlignLeft, label: "Formatting" },
  documentation: { icon: BookOpen, label: "Documentation" },
  security: { icon: Shield, label: "Security" },
  compliance: { icon: Scale, label: "Compliance" },
  schema_design: { icon: Database, label: "Schema Design" },
  alternative_design: { icon: Lightbulb, label: "Alternative" },
};

function getAgentConfig(agentType: string): { icon: typeof Search; label: string } {
  if (knownAgentConfig[agentType]) return knownAgentConfig[agentType];
  // Dynamic fallback: humanize the slug
  const label = agentType
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return { icon: Tag, label };
}

/** Render a side-by-side before/after SQL comparison. */
function SqlBeforeAfter({ before, after }: { before: string; after: string }) {
  return (
    <div className="ml-6.5 grid grid-cols-2 gap-1.5">
      <div className="rounded-md border border-destructive/20 bg-destructive/5 p-2 overflow-x-auto min-w-0">
        <div className="flex items-center gap-1 mb-1">
          <span className="text-[9px] font-semibold text-destructive uppercase tracking-wide">Before</span>
        </div>
        <pre className="text-[11px] leading-relaxed text-foreground/70 whitespace-pre-wrap font-mono break-words">{before}</pre>
      </div>
      <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-2 overflow-x-auto min-w-0">
        <div className="flex items-center gap-1 mb-1">
          <span className="text-[9px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide">After</span>
        </div>
        <pre className="text-[11px] leading-relaxed text-foreground/70 whitespace-pre-wrap font-mono break-words">{after}</pre>
      </div>
    </div>
  );
}

function FeedbackCard({
  feedback,
  queryId,
  isHighlighted,
  isActiveLineMatch,
  onHover,
  onApplySuggestion,
  onScrollToLine,
}: {
  feedback: QueryFeedbackRow;
  queryId: number;
  isHighlighted?: boolean;
  isActiveLineMatch?: boolean;
  onHover?: (feedbackId: number | null) => void;
  onApplySuggestion?: (beforeSql: string, afterSql: string) => void;
  onScrollToLine?: (line: number) => void;
}) {
  const [expanded, setExpanded] = useState(!feedback.isResolved);
  const resolveMutation = useResolveFeedback();
  const dismissMutation = useDismissFeedback();
  const deleteMutation = useDeleteFeedbackItem();

  const severity = severityConfig[feedback.severity as keyof typeof severityConfig] || severityConfig.info;
  const agent = getAgentConfig(feedback.agentType);
  const SeverityIcon = severity.icon;
  const AgentIcon = agent.icon;

  // Extract structured fields from metadata
  const meta = (feedback.metadata || {}) as Record<string, unknown>;
  const beforeSql = typeof meta.beforeSql === "string" ? meta.beforeSql : null;
  const afterSql = typeof meta.afterSql === "string" ? meta.afterSql : null;
  const hasBeforeAfter = beforeSql && afterSql;
  const reason = typeof meta.reason === "string" ? meta.reason : null;
  const bestPractice = typeof meta.bestPractice === "string" ? meta.bestPractice : null;
  const hasStructuredFields = reason || bestPractice;

  const isAccepted = feedback.isResolved && !feedback.isDismissed;
  const isDismissed = feedback.isResolved && feedback.isDismissed;
  const isOpen = !feedback.isResolved;
  const isActionPending = resolveMutation.isPending || dismissMutation.isPending || deleteMutation.isPending;

  return (
    <div
      className={`rounded-md border ${severity.border} ${severity.bg} ${
        feedback.isResolved ? "opacity-60" : ""
      } ${
        isHighlighted
          ? "ring-2 ring-primary ring-offset-1 ring-offset-background"
          : isActiveLineMatch
            ? "ring-1 ring-primary/50 ring-offset-1 ring-offset-background bg-primary/[0.03]"
            : ""
      } transition-all`}
      onMouseEnter={() => onHover?.(feedback.id)}
      onMouseLeave={() => onHover?.(null)}
    >
      <button
        onClick={() => {
          setExpanded(!expanded);
          if (!expanded && feedback.lineNumber) {
            onScrollToLine?.(feedback.lineNumber);
          }
        }}
        className="w-full flex items-start gap-2.5 p-3 text-left"
      >
        <SeverityIcon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${severity.color}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
            <span className="text-sm font-medium leading-tight">{feedback.title}</span>
            {isAccepted && (
              <Badge variant="outline" className="text-[9px] h-3.5 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10">
                Accepted
              </Badge>
            )}
            {isDismissed && (
              <Badge variant="outline" className="text-[9px] h-3.5 border-destructive/30 text-destructive bg-destructive/10 line-through">
                Dismissed
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className="text-[10px] h-4">
              <AgentIcon className="w-2.5 h-2.5 mr-1 text-muted-foreground" />
              {agent.label}
            </Badge>
            {feedback.lineNumber && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onScrollToLine?.(feedback.lineNumber!);
                }}
                className={`text-[10px] hover:underline cursor-pointer ${
                  isHighlighted || isActiveLineMatch
                    ? "text-primary font-semibold"
                    : "text-muted-foreground hover:text-primary"
                }`}
                title="Click to scroll editor to this line"
              >
                Line {feedback.lineNumber}
              </button>
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
        <div className="px-3 pb-3 space-y-3">
          {/* WHY section — concise reason for this finding */}
          {reason && (
            <div className="pl-6.5">
              <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">Why</span>
              <div className="mt-0.5 text-[13px] text-foreground/85 leading-[1.65]">
                {reason}
              </div>
            </div>
          )}

          {/* RECOMMENDATION section — best practice + suggestion */}
          {(bestPractice || feedback.suggestion) && (
            <div className="pl-6.5">
              {hasStructuredFields && (
                <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">Recommendation</span>
              )}
              {bestPractice && (
                <div className="mt-0.5 text-[13px] text-foreground/85 leading-[1.65]">
                  {bestPractice}
                </div>
              )}
              {feedback.suggestion && (
                <div className={`${bestPractice ? "mt-1.5" : "mt-0.5"} p-2.5 rounded-md bg-muted/50 border border-border`}>
                  <p className="text-xs text-foreground/80 leading-relaxed">
                    <span className="font-medium text-primary">Suggestion:</span> {feedback.suggestion}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Before/After SQL comparison — side-by-side */}
          {hasBeforeAfter && (
            <SqlBeforeAfter before={beforeSql!} after={afterSql!} />
          )}

          {/* ANALYSIS section — deep-dive technical details */}
          {feedback.message && (
            <div className="pl-6.5">
              {hasStructuredFields && (
                <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">Analysis</span>
              )}
              <div className="mt-0.5 text-[13px] text-foreground/85 leading-[1.65] whitespace-pre-wrap">
                {feedback.message}
              </div>
            </div>
          )}

          {/* Action buttons */}
          {isOpen && (
            <div className="pl-6.5 flex items-center gap-1">
              {/* Accept / Apply */}
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  if (hasBeforeAfter && onApplySuggestion) {
                    onApplySuggestion(beforeSql!, afterSql!);
                  }
                  resolveMutation.mutate({ id: feedback.id, queryId });
                }}
                disabled={isActionPending}
                className="h-6 text-[10px] text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 hover:bg-emerald-500/10"
              >
                <Check className="w-3 h-3 mr-1" />
                {hasBeforeAfter ? "Apply" : "Accept"}
              </Button>

              {/* Dismiss / Wrong */}
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  dismissMutation.mutate({ id: feedback.id, queryId });
                }}
                disabled={isActionPending}
                className="h-6 text-[10px] text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              >
                <X className="w-3 h-3 mr-1" />
                Wrong
              </Button>

              {/* Delete */}
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteMutation.mutate({ id: feedback.id, queryId });
                }}
                disabled={isActionPending}
                className="h-6 text-[10px] text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="w-3 h-3 mr-1" />
                Delete
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AnalysisStepTracker({ progress }: { progress: AnalysisProgress }) {
  const steps = [
    { label: "Analyzing" },
    { label: "Validating" },
  ];

  return (
    <div className="px-3 py-2 border-b border-border bg-muted/30">
      <div className="flex items-center gap-2">
        {steps.map((s, i) => {
          const stepNum = i + 1;
          const isActive = progress.step === stepNum;
          const isComplete = progress.step > stepNum;
          return (
            <div key={stepNum} className="flex items-center gap-2 flex-1">
              {i > 0 && (
                <div
                  className={`h-px flex-shrink-0 w-4 transition-colors ${
                    isComplete || isActive ? "bg-primary" : "bg-border"
                  }`}
                />
              )}
              <div className="flex items-center gap-1.5 min-w-0">
                <div
                  className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 text-[9px] font-bold transition-all ${
                    isComplete
                      ? "bg-primary text-primary-foreground"
                      : isActive
                        ? "bg-primary text-primary-foreground animate-pulse"
                        : "bg-muted-foreground/20 text-muted-foreground"
                  }`}
                >
                  {isComplete ? (
                    <Check className="w-2.5 h-2.5" />
                  ) : (
                    stepNum
                  )}
                </div>
                <span
                  className={`text-[10px] truncate ${
                    isActive
                      ? "text-primary font-medium"
                      : isComplete
                        ? "text-muted-foreground"
                        : "text-muted-foreground/60"
                  }`}
                >
                  {s.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {/* Thin animated progress bar */}
      <div className="mt-1.5 h-0.5 rounded-full bg-muted-foreground/10 overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-500 ease-out"
          style={{
            width: progress.step >= 2 ? "100%" : progress.step >= 1 ? "50%" : "0%",
          }}
        />
      </div>
    </div>
  );
}

interface FeedbackPanelProps {
  queryId: number | null;
  dialect?: string;
  queryContent?: string;
  hoveredLine?: number | null;
  activeLine?: number | null;
  onFeedbackHover?: (lineNumbers: Set<number>) => void;
  onApplySuggestion?: (beforeSql: string, afterSql: string) => void;
  onScrollToLine?: (line: number) => void;
  isAnalyzing?: boolean;
  analysisProgress?: AnalysisProgress | null;
}

export function FeedbackPanel({ queryId, dialect, queryContent, hoveredLine, activeLine, onFeedbackHover, onApplySuggestion, onScrollToLine, isAnalyzing, analysisProgress }: FeedbackPanelProps) {
  const { data: feedback, isLoading: isFeedbackLoading } = useQueryFeedback(queryId);
  const [filter, setFilter] = useState<string | null>(null);

  const handleFeedbackHover = useCallback((feedbackId: number | null) => {
    if (!feedback || !onFeedbackHover) return;
    if (feedbackId === null) {
      onFeedbackHover(new Set());
      return;
    }
    const item = feedback.find(f => f.id === feedbackId);
    if (item?.lineNumber) {
      onFeedbackHover(new Set([item.lineNumber]));
    } else {
      onFeedbackHover(new Set());
    }
  }, [feedback, onFeedbackHover]);

  const filteredFeedback = feedback?.filter((f) => {
    if (!filter) return true;
    return f.agentType === filter;
  });

  const unresolvedCount = feedback?.filter(f => !f.isResolved).length || 0;
  const errorCount = feedback?.filter(f => f.severity === "error" && !f.isResolved).length || 0;
  const warningCount = feedback?.filter(f => f.severity === "warning" && !f.isResolved).length || 0;

  // Build dynamic category list from actual feedback data
  const dynamicCategories = useMemo(() => {
    if (!feedback || feedback.length === 0) return [];
    const counts = new Map<string, number>();
    for (const f of feedback) {
      counts.set(f.agentType, (counts.get(f.agentType) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({ key, count, ...getAgentConfig(key) }));
  }, [feedback]);

  // Determine which feedback items are highlighted
  const highlightedFeedbackIds = new Set<number>();
  const activeLineFeedbackIds = new Set<number>();
  if (feedback) {
    const hoverTarget = hoveredLine ?? null;
    const cursorTarget = activeLine ?? null;
    for (const f of feedback) {
      if (f.lineNumber && hoverTarget && f.lineNumber === hoverTarget) {
        highlightedFeedbackIds.add(f.id);
      }
      if (f.lineNumber && cursorTarget && f.lineNumber === cursorTarget) {
        activeLineFeedbackIds.add(f.id);
      }
    }
  }

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
        </div>

        {/* Dynamic filter badges */}
        {dynamicCategories.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setFilter(null)}
              className={`px-2 py-0.5 rounded text-[10px] border ${
                !filter ? "bg-accent border-border" : "border-transparent hover:border-border"
              }`}
            >
              All ({feedback!.length})
            </button>
            {dynamicCategories.map(({ key, count, icon: CatIcon }) => (
              <button
                key={key}
                onClick={() => setFilter(filter === key ? null : key)}
                className={`px-2 py-0.5 rounded text-[10px] border flex items-center gap-1 ${
                  filter === key ? "bg-accent border-border" : "border-transparent hover:border-border"
                }`}
              >
                <CatIcon className="w-2.5 h-2.5" />
                {count}
              </button>
            ))}
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

      {/* Step tracker while analyzing */}
      {isAnalyzing && analysisProgress && (
        <AnalysisStepTracker progress={analysisProgress} />
      )}

      {/* Feedback list */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {isFeedbackLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mb-3" />
              <p className="text-xs text-muted-foreground">Loading...</p>
            </div>
          ) : isAnalyzing ? (
            <div className="flex flex-col items-center justify-center py-12 px-4">
              <Loader2 className="w-5 h-5 animate-spin text-primary mb-3" />
              <p className="text-xs text-muted-foreground">
                {analysisProgress?.label || "Starting analysis..."}
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
                // Open items first, then accepted, then dismissed
                const stateOrder = (f: QueryFeedbackRow) =>
                  !f.isResolved ? 0 : f.isDismissed ? 2 : 1;
                const sa = stateOrder(a), sb = stateOrder(b);
                if (sa !== sb) return sa - sb;
                const severityOrder: Record<string, number> = { error: 0, warning: 1, info: 2, success: 3 };
                return (severityOrder[a.severity] || 2) - (severityOrder[b.severity] || 2);
              })
              .map((item) => (
                <FeedbackCard
                  key={item.id}
                  feedback={item}
                  queryId={queryId}
                  isHighlighted={highlightedFeedbackIds.has(item.id)}
                  isActiveLineMatch={activeLineFeedbackIds.has(item.id)}
                  onHover={handleFeedbackHover}
                  onApplySuggestion={onApplySuggestion}
                  onScrollToLine={onScrollToLine}
                />
              ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
