import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  Database,
  Table2,
  Braces,
  Hash,
  Parentheses,
  Flag,
  ArrowDown,
  Loader2,
  Play,
  AlertCircle,
  Info,
  X,
} from "lucide-react";
import { useWaterfallAnalysis, useWaterfallData, useSaveWaterfallData } from "@/hooks/use-sql-queries";
import type {
  WaterfallAnalysis,
  WaterfallNode,
  WaterfallEdge,
  WaterfallEdgeType,
  WaterfallNodeType,
  MergeConflict,
} from "@shared/waterfall";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface VisualExplorerProps {
  queryContent: string;
  queryId?: number | null;
  schemas?: Array<{
    name: string;
    tables: Array<{ name: string; columns: string[] }>;
  }>;
  dialect?: string;
  onEdgeSelect?: (edge: WaterfallEdge | null) => void;
  selectedEdgeId?: string | null;
  onAnalysisComplete?: (analysis: WaterfallAnalysis | null) => void;
}

// ---------------------------------------------------------------------------
// Shadow node transformation
// ---------------------------------------------------------------------------

/**
 * For source tables that are first used far from step 0, create a shadow
 * (ghost) copy at step 0 and move the "real" display node to the step
 * where it is first referenced.  This minimizes long connection lines.
 */
function addShadowNodes(analysis: WaterfallAnalysis): WaterfallAnalysis {
  const nodeById = new Map(analysis.nodes.map((n) => [n.id, n]));
  const sourceNodes = analysis.nodes.filter(
    (n) => n.nodeType === "source_table" && n.stepIndex === 0
  );

  if (sourceNodes.length === 0) return analysis;

  const updatedNodes: WaterfallNode[] = [];
  const shadowNodes: WaterfallNode[] = [];
  let shadowIdx = 0;

  const movedIds = new Set<string>();

  for (const node of analysis.nodes) {
    if (node.nodeType !== "source_table" || node.stepIndex !== 0) {
      updatedNodes.push(node);
      continue;
    }

    // Find the minimum destination stepIndex from outgoing edges
    const outEdges = analysis.edges.filter((e) => e.fromNodeId === node.id);
    if (outEdges.length === 0) {
      updatedNodes.push(node);
      continue;
    }

    const minDestStep = Math.min(
      ...outEdges.map((e) => {
        const dest = nodeById.get(e.toNodeId);
        return dest ? dest.stepIndex : Infinity;
      })
    );

    // Only create shadow if the gap is > 1 step (avoids unnecessary shadows)
    if (minDestStep <= 1 || minDestStep === Infinity) {
      updatedNodes.push(node);
      continue;
    }

    // Create shadow copy at step 0
    const shadowId = `node_shadow_${shadowIdx++}`;
    shadowNodes.push({
      ...node,
      id: shadowId,
      isShadow: true,
      stepIndex: 0,
      displayStepIndex: 0,
    });

    // Move real node to the step just before its first consumer
    const displayStep = minDestStep;
    updatedNodes.push({
      ...node,
      stepIndex: displayStep,
      displayStepIndex: displayStep,
    });
    movedIds.add(node.id);
  }

  // If no shadows were created, return original
  if (shadowNodes.length === 0) return analysis;

  return {
    nodes: [...shadowNodes, ...updatedNodes],
    edges: analysis.edges,
    summary: analysis.summary,
  };
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

const NODE_WIDTH = 220;
const NODE_MIN_HEIGHT = 64;
const TIER_GAP_Y = 180;
const NODE_GAP_X = 40;
const TOP_PADDING = 24;

interface NodePosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

function layoutWaterfall(
  analysis: WaterfallAnalysis,
  containerWidth: number
): Map<string, NodePosition> {
  // Group nodes by stepIndex
  const tiers = new Map<number, WaterfallNode[]>();
  for (const node of analysis.nodes) {
    const tier = tiers.get(node.stepIndex) || [];
    tier.push(node);
    tiers.set(node.stepIndex, tier);
  }

  const sortedTierKeys = Array.from(tiers.keys()).sort((a, b) => a - b);
  const positions = new Map<string, NodePosition>();

  sortedTierKeys.forEach((tierKey, tierIndex) => {
    const nodesInTier = tiers.get(tierKey)!;
    const totalWidth =
      nodesInTier.length * NODE_WIDTH +
      (nodesInTier.length - 1) * NODE_GAP_X;
    const startX = Math.max(
      TOP_PADDING,
      (containerWidth - totalWidth) / 2
    );
    const y = tierIndex * (NODE_MIN_HEIGHT + TIER_GAP_Y) + TOP_PADDING;

    nodesInTier.forEach((node, nodeIndex) => {
      positions.set(node.id, {
        x: startX + nodeIndex * (NODE_WIDTH + NODE_GAP_X),
        y,
        width: NODE_WIDTH,
        height: NODE_MIN_HEIGHT,
      });
    });
  });

  return positions;
}

// ---------------------------------------------------------------------------
// Edge style config
// ---------------------------------------------------------------------------

interface EdgeStyle {
  color: string;
  hoverColor: string;
  dash: string;
  label: string;
}

const EDGE_STYLES: Record<WaterfallEdgeType, EdgeStyle> = {
  join: {
    color: "rgba(59, 130, 246, 0.5)",
    hoverColor: "rgba(59, 130, 246, 1)",
    dash: "none",
    label: "JOIN",
  },
  create_insert: {
    color: "rgba(16, 185, 129, 0.5)",
    hoverColor: "rgba(16, 185, 129, 1)",
    dash: "none",
    label: "CREATE / INSERT",
  },
  cte_definition: {
    color: "rgba(168, 85, 247, 0.5)",
    hoverColor: "rgba(168, 85, 247, 1)",
    dash: "6 3",
    label: "CTE",
  },
  subquery_ref: {
    color: "rgba(245, 158, 11, 0.5)",
    hoverColor: "rgba(245, 158, 11, 1)",
    dash: "4 4",
    label: "SUBQUERY",
  },
  select_from: {
    color: "rgba(148, 163, 184, 0.4)",
    hoverColor: "rgba(148, 163, 184, 0.8)",
    dash: "6 3",
    label: "SELECT",
  },
};

// ---------------------------------------------------------------------------
// Node style config
// ---------------------------------------------------------------------------

interface NodeStyle {
  icon: typeof Database;
  accentClass: string;
  borderClass: string;
  badgeLabel: string;
  badgeClass: string;
}

const NODE_STYLES: Record<WaterfallNodeType, NodeStyle> = {
  source_table: {
    icon: Table2,
    accentClass: "text-primary",
    borderClass: "border-border",
    badgeLabel: "SOURCE",
    badgeClass: "bg-muted text-muted-foreground",
  },
  cte: {
    icon: Braces,
    accentClass: "text-purple-500",
    borderClass: "border-purple-500/30",
    badgeLabel: "CTE",
    badgeClass: "bg-purple-500/10 text-purple-500 border-purple-500/30",
  },
  temp_table: {
    icon: Hash,
    accentClass: "text-amber-500",
    borderClass: "border-amber-500/30",
    badgeLabel: "TEMP",
    badgeClass: "bg-amber-500/10 text-amber-500 border-amber-500/30",
  },
  derived_table: {
    icon: Parentheses,
    accentClass: "text-blue-500",
    borderClass: "border-blue-500/30",
    badgeLabel: "DERIVED",
    badgeClass: "bg-blue-500/10 text-blue-500 border-blue-500/30",
  },
  final_output: {
    icon: Flag,
    accentClass: "text-emerald-500",
    borderClass: "border-emerald-500/50",
    badgeLabel: "OUTPUT",
    badgeClass: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30",
  },
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function WaterfallNodeCard({
  node,
  position,
  isHighlighted,
  registerRef,
}: {
  node: WaterfallNode;
  position: NodePosition;
  isHighlighted: boolean;
  registerRef: (id: string, el: HTMLDivElement | null) => void;
}) {
  const style = NODE_STYLES[node.nodeType] || NODE_STYLES.source_table;
  const Icon = style.icon;
  const isShadow = node.isShadow;

  return (
    <div
      ref={(el) => registerRef(node.id, el)}
      className={`absolute rounded-lg border-2 bg-card shadow-sm transition-all duration-200 ${
        isShadow
          ? "opacity-30 border-dashed border-muted-foreground/30"
          : isHighlighted
            ? `${style.borderClass} shadow-md ring-1 ring-primary/20`
            : "border-border"
      } ${node.nodeType === "final_output" && !isShadow ? "border-2" : ""}`}
      style={{
        left: position.x,
        top: position.y,
        width: position.width,
        minHeight: position.height,
        pointerEvents: isShadow ? "none" : undefined,
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/50 rounded-t-lg">
        <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${isShadow ? "text-muted-foreground/40" : style.accentClass}`} />
        <span className={`text-sm font-bold truncate ${isShadow ? "text-muted-foreground/50" : "text-foreground"}`}>
          {node.name}
        </span>
        <Badge
          variant="outline"
          className={`text-[9px] h-4 px-1.5 ml-auto ${isShadow ? "bg-muted/50 text-muted-foreground/40 border-muted-foreground/20" : style.badgeClass}`}
        >
          {isShadow ? "REF" : style.badgeLabel}
        </Badge>
      </div>

      {/* Columns — hidden for shadow nodes */}
      {!isShadow && node.columns && node.columns.length > 0 && (
        <div className="px-3 py-1.5 space-y-0.5">
          {node.columns.slice(0, 6).map((col) => (
            <div key={col} className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30 flex-shrink-0" />
              <span className="text-[11px] font-mono text-muted-foreground truncate">
                {col}
              </span>
            </div>
          ))}
          {node.columns.length > 6 && (
            <p className="text-[10px] text-muted-foreground/50 italic pl-3">
              +{node.columns.length - 6} more
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function WaterfallEdgeOverlay({
  edges,
  positions,
  nodeMap,
  hoveredEdgeId,
  selectedEdgeId,
  onHover,
  onClick,
}: {
  edges: WaterfallEdge[];
  positions: Map<string, NodePosition>;
  nodeMap: Map<string, WaterfallNode>;
  hoveredEdgeId: string | null;
  selectedEdgeId: string | null;
  onHover: (edge: WaterfallEdge | null) => void;
  onClick: (edge: WaterfallEdge) => void;
}) {
  if (edges.length === 0) return null;

  // Compute SVG bounds
  let maxY = 0;
  let maxX = 0;
  Array.from(positions.values()).forEach((pos) => {
    maxY = Math.max(maxY, pos.y + pos.height);
    maxX = Math.max(maxX, pos.x + pos.width);
  });

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 1, width: maxX + 40, height: maxY + 40 }}
    >
      {/* Arrowhead markers */}
      <defs>
        {Object.entries(EDGE_STYLES).map(([type, style]) => (
          <marker
            key={type}
            id={`arrow-${type}`}
            markerWidth="8"
            markerHeight="6"
            refX="8"
            refY="3"
            orient="auto"
          >
            <path d="M 0 0 L 8 3 L 0 6 Z" fill={style.hoverColor} />
          </marker>
        ))}
        {Object.entries(EDGE_STYLES).map(([type, style]) => (
          <marker
            key={`${type}-dim`}
            id={`arrow-${type}-dim`}
            markerWidth="8"
            markerHeight="6"
            refX="8"
            refY="3"
            orient="auto"
          >
            <path d="M 0 0 L 8 3 L 0 6 Z" fill={style.color} />
          </marker>
        ))}
      </defs>

      {edges.map((edge) => {
        const fromPos = positions.get(edge.fromNodeId);
        const toPos = positions.get(edge.toNodeId);
        if (!fromPos || !toPos) return null;

        const isActive =
          hoveredEdgeId === edge.id || selectedEdgeId === edge.id;
        const edgeStyle = EDGE_STYLES[edge.edgeType] || EDGE_STYLES.select_from;

        // Path from bottom-center of source to top-center of destination
        const x1 = fromPos.x + fromPos.width / 2;
        const y1 = fromPos.y + fromPos.height;
        const x2 = toPos.x + toPos.width / 2;
        const y2 = toPos.y;
        const midY = (y1 + y2) / 2;
        const path = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;

        const fromNode = nodeMap.get(edge.fromNodeId);
        const toNode = nodeMap.get(edge.toNodeId);

        return (
          <g key={edge.id}>
            {/* Invisible wider path for hover detection */}
            <path
              d={path}
              fill="none"
              stroke="transparent"
              strokeWidth={20}
              className="pointer-events-auto cursor-pointer"
              onMouseEnter={() => onHover(edge)}
              onMouseLeave={() => onHover(null)}
              onClick={() => onClick(edge)}
            />
            {/* Visible path */}
            <path
              d={path}
              fill="none"
              stroke={isActive ? edgeStyle.hoverColor : edgeStyle.color}
              strokeWidth={isActive ? 2.5 : 1.5}
              strokeDasharray={isActive ? "none" : edgeStyle.dash}
              markerEnd={`url(#arrow-${edge.edgeType}${isActive ? "" : "-dim"})`}
              style={{ transition: "stroke 0.15s, stroke-width 0.15s" }}
            />
            {/* Midpoint edge label — always visible in the connector lane */}
            {fromNode && toNode && (
              <foreignObject
                x={(x1 + x2) / 2 - 100}
                y={midY - 14}
                width={200}
                height={28}
                className="pointer-events-none"
              >
                <div className="flex items-center justify-center h-full">
                  <div
                    className={`rounded-full border px-2.5 py-0.5 text-[10px] font-medium whitespace-nowrap transition-all duration-150 ${
                      isActive
                        ? "bg-popover border-border shadow-md"
                        : "bg-muted/80 border-border/50"
                    }`}
                    style={{ color: isActive ? edgeStyle.hoverColor : edgeStyle.color }}
                  >
                    {edgeStyle.label}
                  </div>
                </div>
              </foreignObject>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function WaterfallEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full py-16 px-6 text-center">
      <div className="rounded-full bg-muted p-4 mb-4">
        <Database className="w-8 h-8 text-muted-foreground/40" />
      </div>
      <h3 className="text-sm font-semibold text-foreground mb-1">
        No query to visualize
      </h3>
      <p className="text-xs text-muted-foreground max-w-[280px]">
        Write a SQL query or stored procedure, then click
        <strong> Analyze Flow</strong> to see how data flows through your
        query like a waterfall — from source tables down to the final output.
      </p>
    </div>
  );
}

function WaterfallLoadingState() {
  return (
    <div className="flex flex-col items-center justify-center h-full py-16 px-6 text-center">
      <Loader2 className="w-8 h-8 text-primary animate-spin mb-4" />
      <h3 className="text-sm font-semibold text-foreground mb-1">
        Analyzing data flow...
      </h3>
      <p className="text-xs text-muted-foreground max-w-[280px]">
        The LLM is decomposing your SQL into a waterfall of data
        transformations. This may take a moment.
      </p>
    </div>
  );
}

function WaterfallErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full py-16 px-6 text-center">
      <div className="rounded-full bg-destructive/10 p-4 mb-4">
        <AlertCircle className="w-8 h-8 text-destructive/60" />
      </div>
      <h3 className="text-sm font-semibold text-foreground mb-1">
        Analysis failed
      </h3>
      <p className="text-xs text-muted-foreground max-w-[280px] mb-3">
        {message}
      </p>
      <button
        onClick={onRetry}
        className="text-xs text-primary hover:underline"
      >
        Try again
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Merge conflicts banner
// ---------------------------------------------------------------------------

function MergeConflictsBanner({
  conflicts,
  newNodes,
  removedNodes,
  onDismiss,
}: {
  conflicts: MergeConflict[];
  newNodes: string[];
  removedNodes: string[];
  onDismiss: () => void;
}) {
  const hasConflicts = conflicts.length > 0;
  const hasChanges = newNodes.length > 0 || removedNodes.length > 0;
  if (!hasConflicts && !hasChanges) return null;

  return (
    <div className="mx-4 mt-3 mb-1 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2">
      <div className="flex items-start gap-2">
        <Info className="w-3.5 h-3.5 text-amber-500 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium text-amber-600 mb-1">
            Merge results — your modifications were preserved
          </p>
          {newNodes.length > 0 && (
            <p className="text-[10px] text-muted-foreground">
              New: {newNodes.join(", ")}
            </p>
          )}
          {removedNodes.length > 0 && (
            <p className="text-[10px] text-muted-foreground">
              Kept (no longer in SQL): {removedNodes.join(", ")}
            </p>
          )}
          {conflicts.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {conflicts.slice(0, 5).map((c, i) => (
                <p key={i} className="text-[10px] text-muted-foreground">
                  {c.type === "node" ? "Node" : "Edge"} <strong>{c.name}</strong>: {c.field} differs (kept yours)
                </p>
              ))}
              {conflicts.length > 5 && (
                <p className="text-[10px] text-muted-foreground italic">
                  +{conflicts.length - 5} more conflicts (all resolved in your favor)
                </p>
              )}
            </div>
          )}
        </div>
        <button
          onClick={onDismiss}
          className="p-0.5 rounded hover:bg-muted-foreground/20 transition-colors"
        >
          <X className="w-3 h-3 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function VisualExplorer({
  queryContent,
  queryId,
  schemas,
  dialect,
  onEdgeSelect,
  selectedEdgeId,
  onAnalysisComplete,
}: VisualExplorerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [containerWidth, setContainerWidth] = useState(800);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<WaterfallAnalysis | null>(null);
  const [analyzedContent, setAnalyzedContent] = useState<string>("");

  // Merge conflict state
  const [mergeConflicts, setMergeConflicts] = useState<MergeConflict[]>([]);
  const [mergeNewNodes, setMergeNewNodes] = useState<string[]>([]);
  const [mergeRemovedNodes, setMergeRemovedNodes] = useState<string[]>([]);
  const [showMergeBanner, setShowMergeBanner] = useState(false);

  const waterfallMutation = useWaterfallAnalysis();
  const saveWaterfallMutation = useSaveWaterfallData();

  // Load stored waterfall data for this query
  const { data: storedWaterfall } = useWaterfallData(queryId);

  // When stored waterfall is loaded and we don't have a local analysis yet, use it
  useEffect(() => {
    if (storedWaterfall && !analysis) {
      setAnalysis(storedWaterfall);
    }
  }, [storedWaterfall]); // eslint-disable-line react-hooks/exhaustive-deps

  // Observe container width for responsive layout
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const registerNodeRef = useCallback(
    (id: string, el: HTMLDivElement | null) => {
      if (el) {
        nodeRefs.current.set(id, el);
      } else {
        nodeRefs.current.delete(id);
      }
    },
    []
  );

  // Apply shadow-node transformation for display
  const displayAnalysis = useMemo(() => {
    if (!analysis) return null;
    return addShadowNodes(analysis);
  }, [analysis]);

  // Compute layout positions from the display analysis (with shadow nodes)
  const positions = useMemo(() => {
    if (!displayAnalysis) return new Map<string, NodePosition>();
    return layoutWaterfall(displayAnalysis, containerWidth);
  }, [displayAnalysis, containerWidth]);

  // Build node lookup
  const nodeMap = useMemo(() => {
    const map = new Map<string, WaterfallNode>();
    if (displayAnalysis) {
      for (const node of displayAnalysis.nodes) {
        map.set(node.id, node);
      }
    }
    return map;
  }, [displayAnalysis]);

  // Count non-shadow nodes for display
  const realNodeCount = useMemo(() => {
    if (!displayAnalysis) return 0;
    return displayAnalysis.nodes.filter((n) => !n.isShadow).length;
  }, [displayAnalysis]);

  // Compute total diagram height
  const diagramHeight = useMemo(() => {
    let maxY = 0;
    Array.from(positions.values()).forEach((pos) => {
      maxY = Math.max(maxY, pos.y + pos.height);
    });
    return maxY + TOP_PADDING * 2;
  }, [positions]);

  // Connected node IDs for highlight on edge hover/select
  const highlightedNodeIds = useMemo(() => {
    const ids = new Set<string>();
    const activeId = hoveredEdgeId || selectedEdgeId;
    if (activeId && displayAnalysis) {
      for (const edge of displayAnalysis.edges) {
        if (edge.id === activeId) {
          ids.add(edge.fromNodeId);
          ids.add(edge.toNodeId);
        }
      }
    }
    return ids;
  }, [hoveredEdgeId, selectedEdgeId, displayAnalysis]);

  const handleAnalyze = useCallback(() => {
    if (!queryContent.trim()) return;
    waterfallMutation.mutate(
      { content: queryContent, dialect, queryId: queryId ?? undefined },
      {
        onSuccess: (mergeResult) => {
          console.log(
            "[waterfall] Analysis received:",
            mergeResult.analysis.nodes.length, "nodes,",
            mergeResult.analysis.edges.length, "edges,",
            mergeResult.conflicts.length, "conflicts"
          );
          setAnalysis(mergeResult.analysis);
          setAnalyzedContent(queryContent);
          onAnalysisComplete?.(mergeResult.analysis);

          // Show merge info if there were conflicts or structural changes
          if (
            mergeResult.conflicts.length > 0 ||
            mergeResult.newNodes.length > 0 ||
            mergeResult.removedNodes.length > 0
          ) {
            setMergeConflicts(mergeResult.conflicts);
            setMergeNewNodes(mergeResult.newNodes);
            setMergeRemovedNodes(mergeResult.removedNodes);
            setShowMergeBanner(true);
          } else {
            setShowMergeBanner(false);
          }
        },
        onError: (err) => {
          console.error("[waterfall] Analysis failed:", err);
        },
      }
    );
  }, [queryContent, dialect, queryId, waterfallMutation, onAnalysisComplete]);

  const handleEdgeHover = useCallback(
    (edge: WaterfallEdge | null) => {
      setHoveredEdgeId(edge?.id ?? null);
      onEdgeSelect?.(edge);
    },
    [onEdgeSelect]
  );

  const handleEdgeClick = useCallback(
    (edge: WaterfallEdge) => {
      onEdgeSelect?.(edge);
    },
    [onEdgeSelect]
  );

  const isStale = analysis && analyzedContent && analyzedContent !== queryContent;

  // Empty state
  if (!queryContent.trim() && !analysis) {
    return <WaterfallEmptyState />;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-primary" />
          <span className="text-xs font-semibold text-foreground">
            Waterfall Flow
          </span>
        </div>
        <div className="flex items-center gap-2">
          {displayAnalysis && (
            <>
              <Badge variant="outline" className="text-[10px] h-5">
                <Table2 className="w-3 h-3 mr-1" />
                {realNodeCount} node
                {realNodeCount !== 1 ? "s" : ""}
              </Badge>
              <Badge variant="outline" className="text-[10px] h-5">
                <ArrowDown className="w-3 h-3 mr-1" />
                {displayAnalysis.edges.length} flow
                {displayAnalysis.edges.length !== 1 ? "s" : ""}
              </Badge>
            </>
          )}
          {isStale && (
            <Badge
              variant="outline"
              className="text-[10px] h-5 bg-amber-500/10 text-amber-600 border-amber-500/30"
            >
              stale
            </Badge>
          )}
          <button
            onClick={handleAnalyze}
            disabled={waterfallMutation.isPending || !queryContent.trim()}
            className="flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {waterfallMutation.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Play className="w-3 h-3" />
            )}
            {waterfallMutation.isPending
              ? "Analyzing..."
              : isStale
                ? "Re-analyze"
                : "Analyze Flow"}
          </button>
        </div>
      </div>

      {/* Content area */}
      <div ref={containerRef} className="flex-1 relative overflow-auto min-h-0">
        {/* Merge conflicts banner */}
        {showMergeBanner && (
          <MergeConflictsBanner
            conflicts={mergeConflicts}
            newNodes={mergeNewNodes}
            removedNodes={mergeRemovedNodes}
            onDismiss={() => setShowMergeBanner(false)}
          />
        )}

        {waterfallMutation.isPending && !analysis && (
          <WaterfallLoadingState />
        )}

        {waterfallMutation.isError && (
          <WaterfallErrorState
            message={waterfallMutation.error?.message || "Unknown error"}
            onRetry={handleAnalyze}
          />
        )}

        {!analysis && !waterfallMutation.isPending && !waterfallMutation.isError && (
          <div className="flex flex-col items-center justify-center h-full py-16 px-6 text-center">
            <div className="rounded-full bg-muted p-4 mb-4">
              <ArrowDown className="w-8 h-8 text-muted-foreground/40" />
            </div>
            <h3 className="text-sm font-semibold text-foreground mb-1">
              Ready to analyze
            </h3>
            <p className="text-xs text-muted-foreground max-w-[280px]">
              Click <strong>Analyze Flow</strong> to decompose your SQL into a
              waterfall showing how data flows from source tables through
              transformations to the final output.
            </p>
          </div>
        )}

        {displayAnalysis && (
          <div
            className="relative p-4"
            style={{ minHeight: Math.max(diagramHeight, 200), zIndex: 0 }}
          >
            {/* Loading overlay for re-analysis */}
            {waterfallMutation.isPending && (
              <div className="absolute inset-0 bg-background/50 backdrop-blur-sm flex items-center justify-center z-30">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Re-analyzing...
                </div>
              </div>
            )}

            {/* SVG edge overlay */}
            <WaterfallEdgeOverlay
              edges={displayAnalysis.edges}
              positions={positions}
              nodeMap={nodeMap}
              hoveredEdgeId={hoveredEdgeId}
              selectedEdgeId={selectedEdgeId ?? null}
              onHover={handleEdgeHover}
              onClick={handleEdgeClick}
            />

            {/* Node cards */}
            {displayAnalysis.nodes.map((node) => {
              const pos = positions.get(node.id);
              if (!pos) return null;
              return (
                <WaterfallNodeCard
                  key={node.id}
                  node={node}
                  position={pos}
                  isHighlighted={highlightedNodeIds.has(node.id)}
                  registerRef={registerNodeRef}
                />
              );
            })}

            {/* Summary */}
            {displayAnalysis.summary && (
              <div
                className="absolute left-1/2 -translate-x-1/2 text-center max-w-md"
                style={{
                  top: diagramHeight + 8,
                  zIndex: 2,
                }}
              >
                <p className="text-[11px] text-muted-foreground italic">
                  {displayAnalysis.summary}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
