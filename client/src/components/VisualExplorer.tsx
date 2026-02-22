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
  Trash2,
  Plus,
  Check,
} from "lucide-react";
import { useWaterfallData, useSaveWaterfallData } from "@/hooks/use-sql-queries";
import type {
  WaterfallAnalysis,
  WaterfallNode,
  WaterfallEdge,
  WaterfallEdgeType,
  WaterfallNodeType,
  MergeConflict,
} from "@shared/waterfall";

// ---------------------------------------------------------------------------
// Updater interface — exposed to parent for cross-component editing
// ---------------------------------------------------------------------------

export interface WaterfallUpdaters {
  updateNode: (nodeId: string, updates: Partial<WaterfallNode>) => void;
  deleteNode: (nodeId: string) => void;
  addNode: (node: Omit<WaterfallNode, "id">) => void;
  updateEdge: (edgeId: string, updates: Partial<WaterfallEdge>) => void;
  deleteEdge: (edgeId: string) => void;
  addEdge: (edge: Omit<WaterfallEdge, "id">) => void;
}

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
  updaterRef?: React.MutableRefObject<WaterfallUpdaters | null>;
}

// ---------------------------------------------------------------------------
// Shadow node transformation
// ---------------------------------------------------------------------------

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

const NODE_TYPE_OPTIONS: { value: WaterfallNodeType; label: string }[] = [
  { value: "source_table", label: "Source Table" },
  { value: "cte", label: "CTE" },
  { value: "temp_table", label: "Temp Table" },
  { value: "derived_table", label: "Derived Table" },
  { value: "final_output", label: "Final Output" },
];

// ---------------------------------------------------------------------------
// Node edit popover
// ---------------------------------------------------------------------------

function NodeEditPopover({
  node,
  position,
  onSave,
  onDelete,
  onClose,
}: {
  node: WaterfallNode;
  position: NodePosition;
  onSave: (updates: Partial<WaterfallNode>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(node.name);
  const [nodeType, setNodeType] = useState<WaterfallNodeType>(node.nodeType);
  const [columnsText, setColumnsText] = useState(
    (node.columns ?? []).join("\n")
  );
  const [stepIndex, setStepIndex] = useState(String(node.stepIndex));

  const handleSave = () => {
    const columns = columnsText
      .split("\n")
      .map((c) => c.trim())
      .filter(Boolean);
    onSave({
      name: name.trim() || node.name,
      nodeType,
      columns: columns.length > 0 ? columns : undefined,
      stepIndex: parseInt(stepIndex, 10) || node.stepIndex,
      userModified: true,
    });
    onClose();
  };

  return (
    <div
      className="absolute z-40 bg-popover border border-border rounded-lg shadow-xl p-3 w-64"
      style={{
        left: position.x + position.width + 12,
        top: position.y,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-foreground">Edit Node</span>
        <button onClick={onClose} className="p-0.5 rounded hover:bg-muted">
          <X className="w-3 h-3 text-muted-foreground" />
        </button>
      </div>

      <div className="space-y-2">
        <div>
          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full mt-0.5 px-2 py-1 text-xs font-mono bg-muted border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div>
          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Type
          </label>
          <select
            value={nodeType}
            onChange={(e) => setNodeType(e.target.value as WaterfallNodeType)}
            className="w-full mt-0.5 px-2 py-1 text-xs bg-muted border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {NODE_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Step
          </label>
          <input
            type="number"
            min={0}
            value={stepIndex}
            onChange={(e) => setStepIndex(e.target.value)}
            className="w-full mt-0.5 px-2 py-1 text-xs bg-muted border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div>
          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Columns (one per line)
          </label>
          <textarea
            value={columnsText}
            onChange={(e) => setColumnsText(e.target.value)}
            rows={4}
            className="w-full mt-0.5 px-2 py-1 text-xs font-mono bg-muted border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary resize-none"
          />
        </div>
      </div>

      <div className="flex items-center justify-between mt-3 pt-2 border-t border-border">
        <button
          onClick={onDelete}
          className="flex items-center gap-1 text-[10px] text-destructive hover:underline"
        >
          <Trash2 className="w-3 h-3" />
          Delete
        </button>
        <button
          onClick={handleSave}
          className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90"
        >
          <Check className="w-3 h-3" />
          Save
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add node dialog
// ---------------------------------------------------------------------------

function AddNodeDialog({
  maxStepIndex,
  existingNodes,
  onAdd,
  onClose,
}: {
  maxStepIndex: number;
  existingNodes: WaterfallNode[];
  onAdd: (node: Omit<WaterfallNode, "id">) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [nodeType, setNodeType] = useState<WaterfallNodeType>("source_table");
  const [stepIndex, setStepIndex] = useState("0");
  const [columnsText, setColumnsText] = useState("");

  const handleAdd = () => {
    if (!name.trim()) return;
    const columns = columnsText
      .split("\n")
      .map((c) => c.trim())
      .filter(Boolean);
    onAdd({
      name: name.trim(),
      nodeType,
      stepIndex: parseInt(stepIndex, 10) || 0,
      columns: columns.length > 0 ? columns : undefined,
      userModified: true,
    });
    onClose();
  };

  return (
    <div className="mx-4 mt-2 mb-1 bg-popover border border-border rounded-lg shadow-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-foreground">Add Node</span>
        <button onClick={onClose} className="p-0.5 rounded hover:bg-muted">
          <X className="w-3 h-3 text-muted-foreground" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="table_name"
            className="w-full mt-0.5 px-2 py-1 text-xs font-mono bg-muted border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div>
          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Type
          </label>
          <select
            value={nodeType}
            onChange={(e) => setNodeType(e.target.value as WaterfallNodeType)}
            className="w-full mt-0.5 px-2 py-1 text-xs bg-muted border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {NODE_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Step (0–{maxStepIndex + 1})
          </label>
          <input
            type="number"
            min={0}
            value={stepIndex}
            onChange={(e) => setStepIndex(e.target.value)}
            className="w-full mt-0.5 px-2 py-1 text-xs bg-muted border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div>
          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Columns (comma-sep)
          </label>
          <input
            type="text"
            value={columnsText}
            onChange={(e) => setColumnsText(e.target.value)}
            placeholder="col1, col2"
            className="w-full mt-0.5 px-2 py-1 text-xs font-mono bg-muted border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      <div className="flex justify-end mt-2">
        <button
          onClick={handleAdd}
          disabled={!name.trim()}
          className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
        >
          <Plus className="w-3 h-3" />
          Add Node
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function WaterfallNodeCard({
  node,
  position,
  isHighlighted,
  isSelected,
  registerRef,
  onClick,
  onDelete,
}: {
  node: WaterfallNode;
  position: NodePosition;
  isHighlighted: boolean;
  isSelected: boolean;
  registerRef: (id: string, el: HTMLDivElement | null) => void;
  onClick: () => void;
  onDelete: () => void;
}) {
  const style = NODE_STYLES[node.nodeType] || NODE_STYLES.source_table;
  const Icon = style.icon;
  const isShadow = node.isShadow;

  return (
    <div
      ref={(el) => registerRef(node.id, el)}
      className={`absolute rounded-lg border-2 bg-card shadow-sm transition-all duration-200 group ${
        isShadow
          ? "opacity-30 border-dashed border-muted-foreground/30"
          : isSelected
            ? `${style.borderClass} shadow-md ring-2 ring-primary/40`
            : isHighlighted
              ? `${style.borderClass} shadow-md ring-1 ring-primary/20`
              : "border-border hover:border-primary/30 hover:shadow-md cursor-pointer"
      } ${node.nodeType === "final_output" && !isShadow ? "border-2" : ""}`}
      style={{
        left: position.x,
        top: position.y,
        width: position.width,
        minHeight: position.height,
        pointerEvents: isShadow ? "none" : undefined,
      }}
      onClick={isShadow ? undefined : onClick}
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
        {/* Delete button — visible on hover */}
        {!isShadow && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/10 transition-opacity"
            title="Delete node"
          >
            <Trash2 className="w-3 h-3 text-destructive/60" />
          </button>
        )}
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
        const fromPos = positions.get(edge.fromNodeId);
        const toPos = positions.get(edge.toNodeId);
        if (!fromPos || !toPos) return null;

        const isActive =
          hoveredEdgeId === edge.id || selectedEdgeId === edge.id;
        const edgeStyle = EDGE_STYLES[edge.edgeType] || EDGE_STYLES.select_from;

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
            <path
              d={path}
              fill="none"
              stroke={isActive ? edgeStyle.hoverColor : edgeStyle.color}
              strokeWidth={isActive ? 2.5 : 1.5}
              strokeDasharray={isActive ? "none" : edgeStyle.dash}
              markerEnd={`url(#arrow-${edge.edgeType}${isActive ? "" : "-dim"})`}
              style={{ transition: "stroke 0.15s, stroke-width 0.15s" }}
            />
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
  updaterRef,
}: VisualExplorerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [containerWidth, setContainerWidth] = useState(800);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<WaterfallAnalysis | null>(null);

  // Editing state
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [showAddNode, setShowAddNode] = useState(false);

  // Merge conflict state
  const [mergeConflicts, setMergeConflicts] = useState<MergeConflict[]>([]);
  const [mergeNewNodes, setMergeNewNodes] = useState<string[]>([]);
  const [mergeRemovedNodes, setMergeRemovedNodes] = useState<string[]>([]);
  const [showMergeBanner, setShowMergeBanner] = useState(false);

  const saveWaterfallMutation = useSaveWaterfallData();

  // Load stored waterfall data for this query
  const { data: storedWaterfall, isLoading: isLoadingWaterfall } = useWaterfallData(queryId);

  // Reset local analysis when queryId changes (different queries = different visuals)
  const prevQueryIdRef = useRef(queryId);
  useEffect(() => {
    if (queryId !== prevQueryIdRef.current) {
      setAnalysis(null);
      setEditingNodeId(null);
      setShowAddNode(false);
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

  // Observe container width
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

  // ─── Analysis mutation helpers ───────────────────────────────────

  const persistAnalysis = useCallback(
    (updated: WaterfallAnalysis) => {
      setAnalysis(updated);
      onAnalysisComplete?.(updated);
      if (queryId && queryId > 0) {
        saveWaterfallMutation.mutate({ queryId, analysis: updated });
      }
    },
    [queryId, saveWaterfallMutation, onAnalysisComplete]
  );

  // ─── CRUD operations ─────────────────────────────────────────────

  const updateNode = useCallback(
    (nodeId: string, updates: Partial<WaterfallNode>) => {
      if (!analysis) return;
      const updated = {
        ...analysis,
        nodes: analysis.nodes.map((n) =>
          n.id === nodeId ? { ...n, ...updates, userModified: true } : n
        ),
      };
      persistAnalysis(updated);
    },
    [analysis, persistAnalysis]
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      if (!analysis) return;
      const updated = {
        ...analysis,
        nodes: analysis.nodes.filter((n) => n.id !== nodeId),
        edges: analysis.edges.filter(
          (e) => e.fromNodeId !== nodeId && e.toNodeId !== nodeId
        ),
      };
      persistAnalysis(updated);
      setEditingNodeId(null);
    },
    [analysis, persistAnalysis]
  );

  const addNode = useCallback(
    (node: Omit<WaterfallNode, "id">) => {
      if (!analysis) return;
      const maxId = analysis.nodes.reduce((max, n) => {
        const num = parseInt(n.id.replace("node_", ""), 10);
        return isNaN(num) ? max : Math.max(max, num);
      }, -1);
      const newNode: WaterfallNode = { ...node, id: `node_${maxId + 1}` };
      const updated = {
        ...analysis,
        nodes: [...analysis.nodes, newNode],
      };
      persistAnalysis(updated);
    },
    [analysis, persistAnalysis]
  );

  const updateEdge = useCallback(
    (edgeId: string, updates: Partial<WaterfallEdge>) => {
      if (!analysis) return;
      const updated = {
        ...analysis,
        edges: analysis.edges.map((e) =>
          e.id === edgeId ? { ...e, ...updates, userModified: true } : e
        ),
      };
      persistAnalysis(updated);
      // Also update the selected edge in the parent if it changed
      const updatedEdge = updated.edges.find((e) => e.id === edgeId);
      if (updatedEdge && selectedEdgeId === edgeId) {
        onEdgeSelect?.(updatedEdge);
      }
    },
    [analysis, persistAnalysis, selectedEdgeId, onEdgeSelect]
  );

  const deleteEdge = useCallback(
    (edgeId: string) => {
      if (!analysis) return;
      const updated = {
        ...analysis,
        edges: analysis.edges.filter((e) => e.id !== edgeId),
      };
      persistAnalysis(updated);
      if (selectedEdgeId === edgeId) {
        onEdgeSelect?.(null);
      }
    },
    [analysis, persistAnalysis, selectedEdgeId, onEdgeSelect]
  );

  const addEdge = useCallback(
    (edge: Omit<WaterfallEdge, "id">) => {
      if (!analysis) return;
      const maxId = analysis.edges.reduce((max, e) => {
        const num = parseInt(e.id.replace("edge_", ""), 10);
        return isNaN(num) ? max : Math.max(max, num);
      }, -1);
      const newEdge: WaterfallEdge = { ...edge, id: `edge_${maxId + 1}` };
      const updated = {
        ...analysis,
        edges: [...analysis.edges, newEdge],
      };
      persistAnalysis(updated);
    },
    [analysis, persistAnalysis]
  );

  // ─── Expose updaters to parent via ref ────────────────────────────

  useEffect(() => {
    if (updaterRef) {
      updaterRef.current = {
        updateNode,
        deleteNode,
        addNode,
        updateEdge,
        deleteEdge,
        addEdge,
      };
    }
    return () => {
      if (updaterRef) updaterRef.current = null;
    };
  }, [updaterRef, updateNode, deleteNode, addNode, updateEdge, deleteEdge, addEdge]);

  // ─── Display transforms ──────────────────────────────────────────

  const displayAnalysis = useMemo(() => {
    if (!analysis) return null;
    return addShadowNodes(analysis);
  }, [analysis]);

  const positions = useMemo(() => {
    if (!displayAnalysis) return new Map<string, NodePosition>();
    return layoutWaterfall(displayAnalysis, containerWidth);
  }, [displayAnalysis, containerWidth]);

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

  const maxStepIndex = useMemo(() => {
    if (!analysis) return 0;
    return Math.max(0, ...analysis.nodes.map((n) => n.stepIndex));
  }, [analysis]);

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
      onEdgeSelect?.(edge);
      setEditingNodeId(null);
    },
    [onEdgeSelect]
  );

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      setEditingNodeId((prev) => (prev === nodeId ? null : nodeId));
      setShowAddNode(false);
    },
    []
  );

  // Empty state
  if (!queryContent.trim() && !analysis) {
    return <WaterfallEmptyState />;
  }

  // Find the node being edited (from the raw analysis, not display)
  const editingNode = editingNodeId && analysis
    ? analysis.nodes.find((n) => n.id === editingNodeId)
    : null;
  const editingNodePos = editingNodeId ? positions.get(editingNodeId) : null;

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
                {realNodeCount} node{realNodeCount !== 1 ? "s" : ""}
              </Badge>
              <Badge variant="outline" className="text-[10px] h-5">
                <ArrowDown className="w-3 h-3 mr-1" />
                {displayAnalysis.edges.length} flow
                {displayAnalysis.edges.length !== 1 ? "s" : ""}
              </Badge>
            </>
          )}
          {analysis && (
            <button
              onClick={() => { setShowAddNode((v) => !v); setEditingNodeId(null); }}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border border-border hover:bg-accent/50 transition-colors"
              title="Add node"
            >
              <Plus className="w-3 h-3" />
              Node
            </button>
          )}
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

        {/* Add node inline form */}
        {showAddNode && analysis && (
          <AddNodeDialog
            maxStepIndex={maxStepIndex}
            existingNodes={analysis.nodes}
            onAdd={addNode}
            onClose={() => setShowAddNode(false)}
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
              Click <strong>Analyze</strong> on the Analysis tab to generate
              both feedback and a waterfall showing how data flows from source
              tables through transformations to the final output.
            </p>
          </div>
        )}

        {displayAnalysis && (
          <div
            className="relative p-4"
            style={{ minHeight: Math.max(diagramHeight, 200), zIndex: 0 }}
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
                  isSelected={editingNodeId === node.id}
                  registerRef={registerNodeRef}
                  onClick={() => handleNodeClick(node.id)}
                  onDelete={() => deleteNode(node.id)}
                />
              );
            })}

            {/* Node edit popover */}
            {editingNode && editingNodePos && (
              <NodeEditPopover
                node={editingNode}
                position={editingNodePos}
                onSave={(updates) => updateNode(editingNode.id, updates)}
                onDelete={() => deleteNode(editingNode.id)}
                onClose={() => setEditingNodeId(null)}
              />
            )}

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
