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
} from "lucide-react";
import { useWaterfallAnalysis } from "@/hooks/use-sql-queries";
import type {
  WaterfallAnalysis,
  WaterfallNode,
  WaterfallEdge,
  WaterfallEdgeType,
  WaterfallNodeType,
} from "@shared/waterfall";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface VisualExplorerProps {
  queryContent: string;
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
// Layout helpers
// ---------------------------------------------------------------------------

const NODE_WIDTH = 220;
const NODE_MIN_HEIGHT = 64;
const TIER_GAP_Y = 100;
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
    color: "rgba(59, 130, 246, 0.5)",    // blue-500/50
    hoverColor: "rgba(59, 130, 246, 1)",
    dash: "none",
    label: "JOIN",
  },
  create_insert: {
    color: "rgba(16, 185, 129, 0.5)",    // emerald-500/50
    hoverColor: "rgba(16, 185, 129, 1)",
    dash: "none",
    label: "CREATE / INSERT",
  },
  cte_definition: {
    color: "rgba(168, 85, 247, 0.5)",    // purple-500/50
    hoverColor: "rgba(168, 85, 247, 1)",
    dash: "6 3",
    label: "CTE",
  },
  subquery_ref: {
    color: "rgba(245, 158, 11, 0.5)",    // amber-500/50
    hoverColor: "rgba(245, 158, 11, 1)",
    dash: "4 4",
    label: "SUBQUERY",
  },
  select_from: {
    color: "rgba(148, 163, 184, 0.4)",   // slate-400/40
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

  return (
    <div
      ref={(el) => registerRef(node.id, el)}
      className={`absolute rounded-lg border-2 bg-card shadow-sm transition-all duration-200 ${
        isHighlighted
          ? `${style.borderClass} shadow-md ring-1 ring-primary/20`
          : "border-border"
      } ${node.nodeType === "final_output" ? "border-2" : ""}`}
      style={{
        left: position.x,
        top: position.y,
        width: position.width,
        minHeight: position.height,
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/50 rounded-t-lg">
        <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${style.accentClass}`} />
        <span className="text-sm font-bold text-foreground truncate">
          {node.name}
        </span>
        <Badge
          variant="outline"
          className={`text-[9px] h-4 px-1.5 ml-auto ${style.badgeClass}`}
        >
          {style.badgeLabel}
        </Badge>
      </div>

      {/* Columns */}
      {node.columns && node.columns.length > 0 && (
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
            {/* Midpoint indicator */}
            <circle
              cx={(x1 + x2) / 2}
              cy={midY}
              r={isActive ? 5 : 3}
              fill={isActive ? edgeStyle.hoverColor : edgeStyle.color}
              style={{ transition: "fill 0.15s, r 0.15s" }}
            />

            {/* Inline tooltip on hover */}
            {isActive && fromNode && toNode && (
              <foreignObject
                x={(x1 + x2) / 2 - 120}
                y={midY - 36}
                width={240}
                height={48}
                className="pointer-events-none"
              >
                <div className="flex items-center justify-center h-full">
                  <div className="rounded-md border border-border bg-popover px-3 py-1.5 shadow-md text-xs text-popover-foreground max-w-[230px] text-center whitespace-nowrap overflow-hidden">
                    <span
                      className="font-semibold px-1.5 py-0.5 rounded text-[10px]"
                      style={{ color: edgeStyle.hoverColor }}
                    >
                      {edgeStyle.label}
                    </span>
                    <span className="text-muted-foreground mx-1 text-[10px]">
                      {fromNode.name} → {toNode.name}
                    </span>
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
// Main component
// ---------------------------------------------------------------------------

export function VisualExplorer({
  queryContent,
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
  // Track which content was last analyzed to show stale state
  const [analyzedContent, setAnalyzedContent] = useState<string>("");

  const waterfallMutation = useWaterfallAnalysis();

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

  // Compute layout positions
  const positions = useMemo(() => {
    if (!analysis) return new Map<string, NodePosition>();
    return layoutWaterfall(analysis, containerWidth);
  }, [analysis, containerWidth]);

  // Build node lookup
  const nodeMap = useMemo(() => {
    const map = new Map<string, WaterfallNode>();
    if (analysis) {
      for (const node of analysis.nodes) {
        map.set(node.id, node);
      }
    }
    return map;
  }, [analysis]);

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
    if (activeId && analysis) {
      for (const edge of analysis.edges) {
        if (edge.id === activeId) {
          ids.add(edge.fromNodeId);
          ids.add(edge.toNodeId);
        }
      }
    }
    return ids;
  }, [hoveredEdgeId, selectedEdgeId, analysis]);

  const handleAnalyze = useCallback(() => {
    if (!queryContent.trim()) return;
    waterfallMutation.mutate(
      { content: queryContent, dialect },
      {
        onSuccess: (data) => {
          setAnalysis(data);
          setAnalyzedContent(queryContent);
          onAnalysisComplete?.(data);
        },
      }
    );
  }, [queryContent, dialect, waterfallMutation, onAnalysisComplete]);

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

  const isStale = analysis && analyzedContent !== queryContent;

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
          {analysis && (
            <>
              <Badge variant="outline" className="text-[10px] h-5">
                <Table2 className="w-3 h-3 mr-1" />
                {analysis.nodes.length} node
                {analysis.nodes.length !== 1 ? "s" : ""}
              </Badge>
              <Badge variant="outline" className="text-[10px] h-5">
                <ArrowDown className="w-3 h-3 mr-1" />
                {analysis.edges.length} flow
                {analysis.edges.length !== 1 ? "s" : ""}
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
      <div ref={containerRef} className="flex-1 relative overflow-auto">
        {waterfallMutation.isPending && !analysis && (
          <WaterfallLoadingState />
        )}

        {waterfallMutation.isError && !analysis && (
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

        {analysis && (
          <div
            className="relative"
            style={{ minHeight: diagramHeight, zIndex: 0 }}
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
              edges={analysis.edges}
              positions={positions}
              nodeMap={nodeMap}
              hoveredEdgeId={hoveredEdgeId}
              selectedEdgeId={selectedEdgeId ?? null}
              onHover={handleEdgeHover}
              onClick={handleEdgeClick}
            />

            {/* Node cards */}
            {analysis.nodes.map((node) => {
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
            {analysis.summary && (
              <div
                className="absolute left-1/2 -translate-x-1/2 text-center max-w-md"
                style={{
                  top: diagramHeight + 8,
                  zIndex: 2,
                }}
              >
                <p className="text-[11px] text-muted-foreground italic">
                  {analysis.summary}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
