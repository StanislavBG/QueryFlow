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
  Info,
  X,
  Pencil,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  Code2,
} from "lucide-react";
import { useWaterfallData } from "@/hooks/use-sql-queries";
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
 * Enforce downward-only flow: every edge target must have a strictly greater
 * stepIndex than its source.  When the LLM assigns the same (or lower) tier
 * to a target, we push it (and everything downstream) one tier below its
 * highest source.
 */
function enforceDownwardFlow(analysis: WaterfallAnalysis): WaterfallAnalysis {
  const nodeMap = new Map(analysis.nodes.map((n) => [n.id, { ...n }]));

  // Build adjacency: source → [targets]
  const childrenOf = new Map<string, string[]>();
  for (const edge of analysis.edges) {
    if (!childrenOf.has(edge.fromNodeId)) childrenOf.set(edge.fromNodeId, []);
    childrenOf.get(edge.fromNodeId)!.push(edge.toNodeId);
  }

  // Iteratively fix violations until stable (max 20 iterations to be safe)
  let changed = true;
  for (let iter = 0; iter < 20 && changed; iter++) {
    changed = false;
    for (const edge of analysis.edges) {
      const from = nodeMap.get(edge.fromNodeId);
      const to = nodeMap.get(edge.toNodeId);
      if (!from || !to) continue;
      if (to.stepIndex <= from.stepIndex) {
        to.stepIndex = from.stepIndex + 1;
        changed = true;
      }
    }
  }

  return {
    nodes: Array.from(nodeMap.values()),
    edges: analysis.edges,
    summary: analysis.summary,
  };
}

function addShadowNodes(analysis: WaterfallAnalysis): WaterfallAnalysis {
  const nodeById = new Map(analysis.nodes.map((n) => [n.id, n]));
  const sourceNodes = analysis.nodes.filter(
    (n) => n.nodeType === "source_table" && n.stepIndex === 0
  );

  if (sourceNodes.length === 0) return analysis;

  const updatedNodes: WaterfallNode[] = [];
  const shadowNodes: WaterfallNode[] = [];
  let shadowIdx = 0;

  for (const node of analysis.nodes) {
    if (node.nodeType !== "source_table" || node.stepIndex !== 0) {
      updatedNodes.push(node);
      continue;
    }

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

    if (minDestStep <= 1 || minDestStep === Infinity) {
      updatedNodes.push(node);
      continue;
    }

    const shadowId = `node_shadow_${shadowIdx++}`;
    shadowNodes.push({
      ...node,
      id: shadowId,
      isShadow: true,
      stepIndex: 0,
      displayStepIndex: 0,
    });

    const displayStep = minDestStep;
    updatedNodes.push({
      ...node,
      stepIndex: displayStep,
      displayStepIndex: displayStep,
    });
  }

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
const NODE_HEADER_HEIGHT = 36;
const NODE_COLUMN_ROW_HEIGHT = 18;
const NODE_COLUMN_SECTION_PAD = 12;
const TIER_GAP_Y = 180;
const NODE_GAP_X = 40;
const TOP_PADDING = 24;

interface NodePosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Estimate rendered height of a node card based on its columns. */
function estimateNodeHeight(node: WaterfallNode): number {
  if (node.isShadow || !node.columns || node.columns.length === 0) {
    return NODE_MIN_HEIGHT;
  }
  const visibleCols = Math.min(node.columns.length, 6);
  const hasMore = node.columns.length > 6;
  const colRows = visibleCols + (hasMore ? 1 : 0);
  return Math.max(
    NODE_MIN_HEIGHT,
    NODE_HEADER_HEIGHT + NODE_COLUMN_SECTION_PAD + colRows * NODE_COLUMN_ROW_HEIGHT
  );
}

function layoutWaterfall(
  analysis: WaterfallAnalysis,
  containerWidth: number
): Map<string, NodePosition> {
  // Build adjacency maps for barycenter ordering
  const childrenOf = new Map<string, string[]>();
  const parentsOf = new Map<string, string[]>();
  for (const edge of analysis.edges) {
    if (!childrenOf.has(edge.fromNodeId)) childrenOf.set(edge.fromNodeId, []);
    childrenOf.get(edge.fromNodeId)!.push(edge.toNodeId);
    if (!parentsOf.has(edge.toNodeId)) parentsOf.set(edge.toNodeId, []);
    parentsOf.get(edge.toNodeId)!.push(edge.fromNodeId);
  }

  // Group nodes by tier (stepIndex)
  const tiers = new Map<number, WaterfallNode[]>();
  for (const node of analysis.nodes) {
    const tier = tiers.get(node.stepIndex) || [];
    tier.push(node);
    tiers.set(node.stepIndex, tier);
  }
  const sortedTierKeys = Array.from(tiers.keys()).sort((a, b) => a - b);

  // Helper: place nodes in a tier and update the positions map
  function placeTier(
    nodes: WaterfallNode[],
    y: number,
    pos: Map<string, NodePosition>
  ) {
    const totalWidth =
      nodes.length * NODE_WIDTH + (nodes.length - 1) * NODE_GAP_X;
    const startX = Math.max(TOP_PADDING, (containerWidth - totalWidth) / 2);
    nodes.forEach((node, idx) => {
      pos.set(node.id, {
        x: startX + idx * (NODE_WIDTH + NODE_GAP_X),
        y,
        width: NODE_WIDTH,
        height: estimateNodeHeight(node),
      });
    });
  }

  // Initial placement — use max estimated height per tier for Y spacing
  const positions = new Map<string, NodePosition>();
  let cumulativeY = TOP_PADDING;
  sortedTierKeys.forEach((tierKey, tierIndex) => {
    const nodesInTier = tiers.get(tierKey)!;
    if (tierIndex > 0) {
      // Gap is relative to the tallest node in the PREVIOUS tier
      const prevTierKey = sortedTierKeys[tierIndex - 1];
      const prevNodes = tiers.get(prevTierKey)!;
      const prevMaxH = Math.max(...prevNodes.map(estimateNodeHeight));
      cumulativeY += prevMaxH + TIER_GAP_Y;
    }
    placeTier(nodesInTier, cumulativeY, positions);
  });

  // Barycenter refinement: 3 iterations of down-pass + up-pass
  // to minimize edge crossings and total line length
  for (let iter = 0; iter < 3; iter++) {
    // Down pass: order each tier by average X of parent nodes
    for (let i = 1; i < sortedTierKeys.length; i++) {
      const tierKey = sortedTierKeys[i];
      const nodesInTier = [...tiers.get(tierKey)!];
      const y = positions.get(nodesInTier[0]?.id)?.y ?? 0;

      nodesInTier.sort((a, b) => {
        const aParents = parentsOf.get(a.id) || [];
        const bParents = parentsOf.get(b.id) || [];
        const aBC =
          aParents.length > 0
            ? aParents.reduce((s, pid) => {
                const p = positions.get(pid);
                return s + (p ? p.x + p.width / 2 : 0);
              }, 0) / aParents.length
            : Infinity;
        const bBC =
          bParents.length > 0
            ? bParents.reduce((s, pid) => {
                const p = positions.get(pid);
                return s + (p ? p.x + p.width / 2 : 0);
              }, 0) / bParents.length
            : Infinity;
        if (aBC === Infinity && bBC === Infinity)
          return a.name.localeCompare(b.name);
        return aBC - bBC;
      });

      tiers.set(tierKey, nodesInTier);
      placeTier(nodesInTier, y, positions);
    }

    // Up pass: order each tier by average X of child nodes
    // Shadow nodes are always pushed to the right
    for (let i = sortedTierKeys.length - 2; i >= 0; i--) {
      const tierKey = sortedTierKeys[i];
      const nodesInTier = [...tiers.get(tierKey)!];
      const y = positions.get(nodesInTier[0]?.id)?.y ?? 0;

      nodesInTier.sort((a, b) => {
        // Shadow nodes always go to the right
        const aShadow = a.isShadow ? 1 : 0;
        const bShadow = b.isShadow ? 1 : 0;
        if (aShadow !== bShadow) return aShadow - bShadow;

        const aChildren = childrenOf.get(a.id) || [];
        const bChildren = childrenOf.get(b.id) || [];
        const aBC =
          aChildren.length > 0
            ? aChildren.reduce((s, cid) => {
                const p = positions.get(cid);
                return s + (p ? p.x + p.width / 2 : 0);
              }, 0) / aChildren.length
            : Infinity;
        const bBC =
          bChildren.length > 0
            ? bChildren.reduce((s, cid) => {
                const p = positions.get(cid);
                return s + (p ? p.x + p.width / 2 : 0);
              }, 0) / bChildren.length
            : Infinity;
        if (aBC === Infinity && bBC === Infinity)
          return a.name.localeCompare(b.name);
        return aBC - bBC;
      });

      tiers.set(tierKey, nodesInTier);
      placeTier(nodesInTier, y, positions);
    }
  }

  return positions;
}

// ---------------------------------------------------------------------------
// Edge / Node style configs
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
// Edge path computation — anchor distribution + collision avoidance
// ---------------------------------------------------------------------------

interface EdgePath {
  path: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  labelX: number;
  labelY: number;
}

function computeAllEdgePaths(
  edges: WaterfallEdge[],
  positions: Map<string, NodePosition>
): Map<string, EdgePath> {
  const result = new Map<string, EdgePath>();

  // --- Anchor distribution ---
  // Group edges by source (bottom) and target (top) node
  const bottomGroups = new Map<string, WaterfallEdge[]>();
  const topGroups = new Map<string, WaterfallEdge[]>();

  for (const edge of edges) {
    if (!positions.has(edge.fromNodeId) || !positions.has(edge.toNodeId))
      continue;
    if (!bottomGroups.has(edge.fromNodeId))
      bottomGroups.set(edge.fromNodeId, []);
    bottomGroups.get(edge.fromNodeId)!.push(edge);
    if (!topGroups.has(edge.toNodeId)) topGroups.set(edge.toNodeId, []);
    topGroups.get(edge.toNodeId)!.push(edge);
  }

  const ANCHOR_PAD = 24;
  const fromAnchor = new Map<string, { x: number; y: number }>();
  const toAnchor = new Map<string, { x: number; y: number }>();

  // Distribute bottom anchors: sort by target X, spread across node width
  for (const [nodeId, group] of bottomGroups) {
    const pos = positions.get(nodeId)!;
    const sorted = [...group].sort((a, b) => {
      const aPos = positions.get(a.toNodeId);
      const bPos = positions.get(b.toNodeId);
      return (
        (aPos ? aPos.x + aPos.width / 2 : 0) -
        (bPos ? bPos.x + bPos.width / 2 : 0)
      );
    });
    const count = sorted.length;
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      fromAnchor.set(sorted[i].id, {
        x: pos.x + ANCHOR_PAD + t * (pos.width - 2 * ANCHOR_PAD),
        y: pos.y + pos.height,
      });
    }
  }

  // Distribute top anchors: sort by source X, spread across node width
  for (const [nodeId, group] of topGroups) {
    const pos = positions.get(nodeId)!;
    const sorted = [...group].sort((a, b) => {
      const aPos = positions.get(a.fromNodeId);
      const bPos = positions.get(b.fromNodeId);
      return (
        (aPos ? aPos.x + aPos.width / 2 : 0) -
        (bPos ? bPos.x + bPos.width / 2 : 0)
      );
    });
    const count = sorted.length;
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      toAnchor.set(sorted[i].id, {
        x: pos.x + ANCHOR_PAD + t * (pos.width - 2 * ANCHOR_PAD),
        y: pos.y,
      });
    }
  }

  // --- Path computation with collision avoidance ---
  for (const edge of edges) {
    const fromPos = positions.get(edge.fromNodeId);
    const toPos = positions.get(edge.toNodeId);
    if (!fromPos || !toPos) continue;

    const from = fromAnchor.get(edge.id) || {
      x: fromPos.x + fromPos.width / 2,
      y: fromPos.y + fromPos.height,
    };
    const to = toAnchor.get(edge.id) || {
      x: toPos.x + toPos.width / 2,
      y: toPos.y,
    };
    const x1 = from.x;
    const y1 = from.y;
    const x2 = to.x;
    const y2 = to.y;

    // Default label position
    let labelX = (x1 + x2) / 2;
    let labelY = (y1 + y2) / 2;

    // For edges going upward or to the same tier, just use a simple S-curve
    if (y2 <= y1) {
      const midY = (y1 + y2) / 2;
      result.set(edge.id, {
        path: `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`,
        x1, y1, x2, y2, labelX, labelY,
      });
      continue;
    }

    // Collect intermediate obstacles (boxes between source and target tiers)
    const obstacles: NodePosition[] = [];
    for (const [nodeId, pos] of positions) {
      if (nodeId === edge.fromNodeId || nodeId === edge.toNodeId) continue;
      // Box overlaps vertically with the edge corridor
      if (pos.y + pos.height > y1 + 2 && pos.y < y2 - 2) {
        obstacles.push(pos);
      }
    }

    if (obstacles.length === 0) {
      const midY = (y1 + y2) / 2;
      result.set(edge.id, {
        path: `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`,
        x1, y1, x2, y2, labelX, labelY,
      });
      continue;
    }

    // Sample the default Bézier to check for actual collisions
    const midY = (y1 + y2) / 2;
    const BOX_PAD = 12;
    const collidingBoxes = obstacles.filter((box) => {
      for (let s = 0; s <= 24; s++) {
        const t = s / 24;
        const mt = 1 - t;
        // Cubic Bézier: P0=(x1,y1) P1=(x1,midY) P2=(x2,midY) P3=(x2,y2)
        const sx =
          mt * mt * mt * x1 +
          3 * mt * mt * t * x1 +
          3 * mt * t * t * x2 +
          t * t * t * x2;
        const sy =
          mt * mt * mt * y1 +
          3 * mt * mt * t * midY +
          3 * mt * t * t * midY +
          t * t * t * y2;
        if (
          sx >= box.x - BOX_PAD &&
          sx <= box.x + box.width + BOX_PAD &&
          sy >= box.y - BOX_PAD &&
          sy <= box.y + box.height + BOX_PAD
        ) {
          return true;
        }
      }
      return false;
    });

    if (collidingBoxes.length === 0) {
      result.set(edge.id, {
        path: `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`,
        x1, y1, x2, y2, labelX, labelY,
      });
      continue;
    }

    // Route around colliding boxes using waypoints
    collidingBoxes.sort((a, b) => a.y - b.y);
    const CLEARANCE = 24;
    const waypoints: { x: number; y: number }[] = [];

    for (const box of collidingBoxes) {
      const leftX = box.x - CLEARANCE;
      const rightX = box.x + box.width + CLEARANCE;
      // Choose the side that minimizes total horizontal detour
      const distLeft = Math.abs(x1 - leftX) + Math.abs(x2 - leftX);
      const distRight = Math.abs(x1 - rightX) + Math.abs(x2 - rightX);
      const routeX = distLeft <= distRight ? leftX : rightX;
      waypoints.push({ x: routeX, y: box.y + box.height / 2 });
    }

    // Build a smooth multi-segment cubic Bézier path through waypoints
    const points = [{ x: x1, y: y1 }, ...waypoints, { x: x2, y: y2 }];
    let path = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const my = (prev.y + curr.y) / 2;
      path += ` C ${prev.x} ${my}, ${curr.x} ${my}, ${curr.x} ${curr.y}`;
    }

    // Place label at the midpoint of the middle segment
    const midSegIdx = Math.floor(points.length / 2);
    const segA = points[midSegIdx - 1] || points[0];
    const segB = points[midSegIdx] || points[points.length - 1];
    labelX = (segA.x + segB.x) / 2;
    labelY = (segA.y + segB.y) / 2;

    result.set(edge.id, { path, x1, y1, x2, y2, labelX, labelY });
  }

  return result;
}

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
        {!isShadow && node.userModified && (
          <Pencil className="w-2.5 h-2.5 text-muted-foreground/50 flex-shrink-0" />
        )}
        <Badge
          variant="outline"
          className={`text-[9px] h-4 px-1.5 ml-auto ${isShadow ? "bg-muted/50 text-muted-foreground/40 border-muted-foreground/20" : style.badgeClass}`}
        >
          {isShadow ? "REF" : style.badgeLabel}
        </Badge>
      </div>

      {/* Columns */}
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
  // Pre-compute all edge paths with anchor distribution and collision avoidance
  // (must be called before the early return to satisfy React hooks rules)
  const edgePaths = useMemo(
    () => computeAllEdgePaths(edges, positions),
    [edges, positions]
  );

  if (edges.length === 0) return null;

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
        const pathInfo = edgePaths.get(edge.id);
        if (!pathInfo) return null;

        const isActive =
          hoveredEdgeId === edge.id || selectedEdgeId === edge.id;
        const edgeStyle = EDGE_STYLES[edge.edgeType] || EDGE_STYLES.select_from;

        const fromNode = nodeMap.get(edge.fromNodeId);
        const toNode = nodeMap.get(edge.toNodeId);

        return (
          <g key={edge.id}>
            <path
              d={pathInfo.path}
              fill="none"
              stroke="transparent"
              strokeWidth={20}
              className="pointer-events-auto cursor-pointer"
              onMouseEnter={() => onHover(edge)}
              onMouseLeave={() => onHover(null)}
              onClick={() => onClick(edge)}
            />
            <path
              d={pathInfo.path}
              fill="none"
              stroke={isActive ? edgeStyle.hoverColor : edgeStyle.color}
              strokeWidth={isActive ? 2.5 : 1.5}
              strokeDasharray={isActive ? "none" : edgeStyle.dash}
              markerEnd={`url(#arrow-${edge.edgeType}${isActive ? "" : "-dim"})`}
              style={{ transition: "stroke 0.15s, stroke-width 0.15s" }}
            />
            {fromNode && toNode && (
              <foreignObject
                x={pathInfo.labelX - 100}
                y={pathInfo.labelY - 14}
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

// Zoom constants
const ZOOM_STEP = 0.1;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2.0;

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

  // Zoom & fullscreen state
  const [zoomLevel, setZoomLevel] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Fullscreen-local selected edge (for the SQL panel)
  const [fsSelectedEdge, setFsSelectedEdge] = useState<WaterfallEdge | null>(null);

  // Merge conflict state
  const [mergeConflicts, setMergeConflicts] = useState<MergeConflict[]>([]);
  const [mergeNewNodes, setMergeNewNodes] = useState<string[]>([]);
  const [mergeRemovedNodes, setMergeRemovedNodes] = useState<string[]>([]);
  const [showMergeBanner, setShowMergeBanner] = useState(false);

  // Load stored waterfall data for this query
  const { data: storedWaterfall, isLoading: isLoadingWaterfall } = useWaterfallData(queryId);

  // Reset local analysis when queryId changes (different queries = different visuals)
  const prevQueryIdRef = useRef(queryId);
  useEffect(() => {
    if (queryId !== prevQueryIdRef.current) {
      setAnalysis(null);
      setShowMergeBanner(false);
      prevQueryIdRef.current = queryId;
    }
  }, [queryId]);

  // Sync stored waterfall data into local state
  useEffect(() => {
    if (storedWaterfall) {
      setAnalysis(storedWaterfall);
      onAnalysisComplete?.(storedWaterfall);
    }
  }, [storedWaterfall]); // eslint-disable-line react-hooks/exhaustive-deps

  // Observe container width (account for zoom when laying out)
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

  // Close fullscreen on Escape
  useEffect(() => {
    if (!isFullscreen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFullscreen(false);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isFullscreen]);

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

  // ─── Display transforms ──────────────────────────────────────────

  const displayAnalysis = useMemo(() => {
    if (!analysis) return null;
    return addShadowNodes(enforceDownwardFlow(analysis));
  }, [analysis]);

  // Use unscaled container width for layout so nodes don't shrink
  const layoutWidth = useMemo(() => containerWidth / zoomLevel, [containerWidth, zoomLevel]);

  const positions = useMemo(() => {
    if (!displayAnalysis) return new Map<string, NodePosition>();
    return layoutWaterfall(displayAnalysis, layoutWidth);
  }, [displayAnalysis, layoutWidth]);

  const nodeMap = useMemo(() => {
    const map = new Map<string, WaterfallNode>();
    if (displayAnalysis) {
      for (const node of displayAnalysis.nodes) {
        map.set(node.id, node);
      }
    }
    return map;
  }, [displayAnalysis]);

  const realNodeCount = useMemo(() => {
    if (!displayAnalysis) return 0;
    return displayAnalysis.nodes.filter((n) => !n.isShadow).length;
  }, [displayAnalysis]);

  const diagramHeight = useMemo(() => {
    let maxY = 0;
    Array.from(positions.values()).forEach((pos) => {
      maxY = Math.max(maxY, pos.y + pos.height);
    });
    return maxY + TOP_PADDING * 2;
  }, [positions]);

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

  // ─── Event handlers ──────────────────────────────────────────────

  const handleEdgeHover = useCallback(
    (edge: WaterfallEdge | null) => {
      setHoveredEdgeId(edge?.id ?? null);
      onEdgeSelect?.(edge);
    },
    [onEdgeSelect]
  );

  const handleEdgeClick = useCallback(
    (edge: WaterfallEdge) => {
      setFsSelectedEdge((prev) => (prev?.id === edge.id ? null : edge));
      onEdgeSelect?.(edge);
    },
    [onEdgeSelect]
  );

  const handleZoomIn = useCallback(() => {
    setZoomLevel((z) => Math.min(MAX_ZOOM, +(z + ZOOM_STEP).toFixed(2)));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoomLevel((z) => Math.max(MIN_ZOOM, +(z - ZOOM_STEP).toFixed(2)));
  }, []);

  const handleToggleFullscreen = useCallback(() => {
    setIsFullscreen((v) => !v);
  }, []);

  // Empty state
  if (!queryContent.trim() && !analysis) {
    return <WaterfallEmptyState />;
  }

  const zoomPercent = Math.round(zoomLevel * 100);

  const content = (
    <div className={`flex flex-col ${isFullscreen ? "h-screen" : "h-full"}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card flex-shrink-0">
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
                {realNodeCount} node{realNodeCount !== 1 ? "s" : ""}
              </Badge>
              <Badge variant="outline" className="text-[10px] h-5">
                <ArrowDown className="w-3 h-3 mr-1" />
                {displayAnalysis.edges.length} flow
                {displayAnalysis.edges.length !== 1 ? "s" : ""}
              </Badge>
            </>
          )}

          {/* Zoom controls */}
          <div className="flex items-center gap-0.5 border border-border rounded-md">
            <button
              onClick={handleZoomOut}
              disabled={zoomLevel <= MIN_ZOOM}
              className="p-1 hover:bg-accent/50 transition-colors disabled:opacity-30 rounded-l-md"
              title="Zoom out"
            >
              <ZoomOut className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
            <span className="text-[10px] font-mono text-muted-foreground px-1 min-w-[36px] text-center select-none">
              {zoomPercent}%
            </span>
            <button
              onClick={handleZoomIn}
              disabled={zoomLevel >= MAX_ZOOM}
              className="p-1 hover:bg-accent/50 transition-colors disabled:opacity-30 rounded-r-md"
              title="Zoom in"
            >
              <ZoomIn className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </div>

          {/* Fullscreen toggle */}
          <button
            onClick={handleToggleFullscreen}
            className="p-1 rounded-md border border-border hover:bg-accent/50 transition-colors"
            title={isFullscreen ? "Exit full screen" : "Full screen"}
          >
            {isFullscreen ? (
              <Minimize2 className="w-3.5 h-3.5 text-muted-foreground" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5 text-muted-foreground" />
            )}
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

        {isLoadingWaterfall && !analysis && (
          <WaterfallLoadingState />
        )}

        {!analysis && !isLoadingWaterfall && (
          <div className="flex flex-col items-center justify-center h-full py-16 px-6 text-center">
            <div className="rounded-full bg-muted p-4 mb-4">
              <ArrowDown className="w-8 h-8 text-muted-foreground/40" />
            </div>
            <h3 className="text-sm font-semibold text-foreground mb-1">
              No visual yet
            </h3>
            <p className="text-xs text-muted-foreground max-w-[280px]">
              Click <strong>Analyze</strong> to generate both feedback and a
              waterfall showing how data flows from source tables through
              transformations to the final output.
            </p>
          </div>
        )}

        {displayAnalysis && (
          <div
            className="relative p-4"
            style={{
              minHeight: Math.max(diagramHeight * zoomLevel, 200),
              zIndex: 0,
            }}
          >
            {/* Loading overlay */}
            {isLoadingWaterfall && (
              <div className="absolute inset-0 bg-background/50 backdrop-blur-sm flex items-center justify-center z-30">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading...
                </div>
              </div>
            )}

            {/* Zoomable diagram wrapper */}
            <div
              style={{
                transform: `scale(${zoomLevel})`,
                transformOrigin: "top left",
                width: `${100 / zoomLevel}%`,
              }}
            >
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
          </div>
        )}
      </div>
    </div>
  );

  // Fullscreen: render as a fixed overlay with a 1/3 SQL panel on the right
  if (isFullscreen) {
    // Resolve the active edge (clicked or hovered) for the SQL panel
    const activeEdge = fsSelectedEdge ?? (hoveredEdgeId && displayAnalysis
      ? displayAnalysis.edges.find((e) => e.id === hoveredEdgeId) ?? null
      : null);
    const activeFromNode = activeEdge ? nodeMap.get(activeEdge.fromNodeId) : null;
    const activeToNode = activeEdge ? nodeMap.get(activeEdge.toNodeId) : null;

    return (
      <div className="fixed inset-0 z-50 bg-background flex">
        {/* Waterfall — 2/3 */}
        <div className="flex-[2] min-w-0">{content}</div>

        {/* SQL panel — 1/3 */}
        <div className="flex-1 border-l border-border bg-card flex flex-col min-w-0">
          <div className="flex items-center gap-2 px-4 py-2 border-b border-border flex-shrink-0">
            <Code2 className="w-4 h-4 text-primary" />
            <span className="text-xs font-semibold text-foreground">SQL Detail</span>
          </div>

          {activeEdge ? (
            <div className="flex-1 overflow-auto p-4 space-y-4">
              {/* Edge summary */}
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] h-5">
                    {EDGE_STYLES[activeEdge.edgeType]?.label ?? activeEdge.edgeType}
                  </Badge>
                  <span className="text-[11px] text-muted-foreground">
                    {activeFromNode?.name ?? "?"} → {activeToNode?.name ?? "?"}
                  </span>
                </div>
                {activeEdge.joinDetails && (
                  <p className="text-[11px] text-muted-foreground/80 font-mono">
                    {activeEdge.joinDetails}
                  </p>
                )}
              </div>

              {/* SQL statement */}
              <div className="space-y-1">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  SQL Statement
                </p>
                <pre className="text-xs font-mono text-foreground bg-muted/50 border border-border rounded-md p-3 whitespace-pre-wrap break-words overflow-auto max-h-[calc(100vh-160px)]">
                  {activeEdge.sqlStatement || "No SQL available"}
                </pre>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
              <Code2 className="w-8 h-8 text-muted-foreground/30 mb-3" />
              <p className="text-xs text-muted-foreground">
                Click or hover over a connection line to see its SQL statement here.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return content;
}
