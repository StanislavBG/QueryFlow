// ---------------------------------------------------------------------------
// Waterfall Merge Logic
// ---------------------------------------------------------------------------
// Merges a fresh LLM waterfall analysis with the user's previously-evolved
// version.  The user's modifications always win when conflicts are detected.
// ---------------------------------------------------------------------------

import type {
  WaterfallAnalysis,
  WaterfallNode,
  WaterfallEdge,
  MergeConflict,
  WaterfallMergeResult,
} from "@shared/waterfall";

/** Canonical key for matching nodes across analyses. */
function nodeKey(n: WaterfallNode): string {
  return `${n.nodeType}::${n.name.toLowerCase()}`;
}

/** Canonical key for matching edges across analyses. */
function edgeKey(e: WaterfallEdge, nodeMap: Map<string, WaterfallNode>): string {
  const from = nodeMap.get(e.fromNodeId);
  const to = nodeMap.get(e.toNodeId);
  const fromName = from ? `${from.nodeType}::${from.name.toLowerCase()}` : e.fromNodeId;
  const toName = to ? `${to.nodeType}::${to.name.toLowerCase()}` : e.toNodeId;
  return `${fromName}->${toName}::${e.edgeType}`;
}

/**
 * Build a map from nodeId → WaterfallNode for quick lookups.
 */
function buildNodeMap(nodes: WaterfallNode[]): Map<string, WaterfallNode> {
  const m = new Map<string, WaterfallNode>();
  for (const n of nodes) m.set(n.id, n);
  return m;
}

/**
 * Detect field-level conflicts between a user node and an LLM node.
 * Returns conflict records (user always wins).
 */
function diffNode(
  userNode: WaterfallNode,
  llmNode: WaterfallNode
): MergeConflict[] {
  const conflicts: MergeConflict[] = [];

  if (userNode.userModified) {
    // Only report meaningful conflicts for user-modified nodes
    const userCols = (userNode.columns ?? []).join(",");
    const llmCols = (llmNode.columns ?? []).join(",");
    if (userCols !== llmCols) {
      conflicts.push({
        type: "node",
        name: userNode.name,
        field: "columns",
        userValue: userCols || "(none)",
        llmValue: llmCols || "(none)",
        resolution: "kept_user",
      });
    }
    if (userNode.stepIndex !== llmNode.stepIndex) {
      conflicts.push({
        type: "node",
        name: userNode.name,
        field: "stepIndex",
        userValue: String(userNode.stepIndex),
        llmValue: String(llmNode.stepIndex),
        resolution: "kept_user",
      });
    }
  }

  return conflicts;
}

/**
 * Detect field-level conflicts between a user edge and an LLM edge.
 */
function diffEdge(
  userEdge: WaterfallEdge,
  llmEdge: WaterfallEdge
): MergeConflict[] {
  const conflicts: MergeConflict[] = [];

  if (userEdge.userModified) {
    if (userEdge.sqlStatement !== llmEdge.sqlStatement) {
      conflicts.push({
        type: "edge",
        name: `${userEdge.fromNodeId} → ${userEdge.toNodeId}`,
        field: "sqlStatement",
        userValue: userEdge.sqlStatement.slice(0, 120),
        llmValue: llmEdge.sqlStatement.slice(0, 120),
        resolution: "kept_user",
      });
    }
  }

  return conflicts;
}

/**
 * Merge a fresh LLM analysis with existing user-evolved data.
 *
 * Strategy:
 * - Match nodes by (nodeType + name) — IDs may differ between runs.
 * - For matched nodes: keep user version if user-modified, otherwise take LLM.
 * - New nodes from LLM are added.
 * - Nodes that existed in user data but not in LLM are kept (user added them).
 * - Edges follow similar logic, matched by (fromName→toName + edgeType).
 * - Conflicts are reported but user always wins.
 */
export function mergeWaterfallAnalysis(
  userAnalysis: WaterfallAnalysis,
  llmAnalysis: WaterfallAnalysis
): WaterfallMergeResult {
  const conflicts: MergeConflict[] = [];
  const newNodes: string[] = [];
  const removedNodes: string[] = [];

  // --- Node merge ---

  // Build key → node maps
  const userNodeByKey = new Map<string, WaterfallNode>();
  for (const n of userAnalysis.nodes) userNodeByKey.set(nodeKey(n), n);

  const llmNodeByKey = new Map<string, WaterfallNode>();
  for (const n of llmAnalysis.nodes) llmNodeByKey.set(nodeKey(n), n);

  const mergedNodes: WaterfallNode[] = [];
  // Map from old LLM nodeId → merged nodeId (for edge remapping)
  const idRemap = new Map<string, string>();
  let nextNodeIdx = 0;

  // 1. Process LLM nodes — match against user nodes
  for (const [key, llmNode] of Array.from(llmNodeByKey)) {
    const userNode = userNodeByKey.get(key);

    if (userNode) {
      // Match found — user version wins if modified, otherwise take LLM's updated data
      if (userNode.userModified) {
        const nodeConflicts = diffNode(userNode, llmNode);
        conflicts.push(...nodeConflicts);
        const merged = { ...userNode, id: `node_${nextNodeIdx}` };
        idRemap.set(llmNode.id, merged.id);
        idRemap.set(userNode.id, merged.id);
        mergedNodes.push(merged);
      } else {
        // User hasn't modified — take LLM's fresh version (might have updated columns, etc.)
        const merged = { ...llmNode, id: `node_${nextNodeIdx}` };
        idRemap.set(llmNode.id, merged.id);
        idRemap.set(userNode.id, merged.id);
        mergedNodes.push(merged);
      }
    } else {
      // New node from LLM
      const merged = { ...llmNode, id: `node_${nextNodeIdx}` };
      idRemap.set(llmNode.id, merged.id);
      mergedNodes.push(merged);
      newNodes.push(llmNode.name);
    }
    nextNodeIdx++;
  }

  // 2. Process user-only nodes (exist in user data but not in LLM)
  for (const [key, userNode] of Array.from(userNodeByKey)) {
    if (!llmNodeByKey.has(key)) {
      const merged = { ...userNode, id: `node_${nextNodeIdx}` };
      idRemap.set(userNode.id, merged.id);
      mergedNodes.push(merged);
      removedNodes.push(userNode.name);
      nextNodeIdx++;
    }
  }

  // --- Edge merge ---

  const userNodeMap = buildNodeMap(userAnalysis.nodes);
  const llmNodeMap = buildNodeMap(llmAnalysis.nodes);

  const userEdgeByKey = new Map<string, WaterfallEdge>();
  for (const e of userAnalysis.edges) userEdgeByKey.set(edgeKey(e, userNodeMap), e);

  const llmEdgeByKey = new Map<string, WaterfallEdge>();
  for (const e of llmAnalysis.edges) llmEdgeByKey.set(edgeKey(e, llmNodeMap), e);

  const mergedEdges: WaterfallEdge[] = [];
  let nextEdgeIdx = 0;

  // 1. Process LLM edges — match against user edges
  for (const [key, llmEdge] of Array.from(llmEdgeByKey)) {
    const userEdge = userEdgeByKey.get(key);

    const remappedFrom = idRemap.get(llmEdge.fromNodeId) ?? llmEdge.fromNodeId;
    const remappedTo = idRemap.get(llmEdge.toNodeId) ?? llmEdge.toNodeId;

    if (userEdge) {
      if (userEdge.userModified) {
        const edgeConflicts = diffEdge(userEdge, llmEdge);
        conflicts.push(...edgeConflicts);
        mergedEdges.push({
          ...userEdge,
          id: `edge_${nextEdgeIdx}`,
          fromNodeId: remappedFrom,
          toNodeId: remappedTo,
        });
      } else {
        mergedEdges.push({
          ...llmEdge,
          id: `edge_${nextEdgeIdx}`,
          fromNodeId: remappedFrom,
          toNodeId: remappedTo,
        });
      }
    } else {
      mergedEdges.push({
        ...llmEdge,
        id: `edge_${nextEdgeIdx}`,
        fromNodeId: remappedFrom,
        toNodeId: remappedTo,
      });
    }
    nextEdgeIdx++;
  }

  // 2. User-only edges (not in new LLM result) — keep if both endpoints still exist
  const mergedNodeIds = new Set(mergedNodes.map((n) => n.id));
  for (const [key, userEdge] of Array.from(userEdgeByKey)) {
    if (!llmEdgeByKey.has(key)) {
      const remappedFrom = idRemap.get(userEdge.fromNodeId) ?? userEdge.fromNodeId;
      const remappedTo = idRemap.get(userEdge.toNodeId) ?? userEdge.toNodeId;
      if (mergedNodeIds.has(remappedFrom) && mergedNodeIds.has(remappedTo)) {
        mergedEdges.push({
          ...userEdge,
          id: `edge_${nextEdgeIdx}`,
          fromNodeId: remappedFrom,
          toNodeId: remappedTo,
        });
        nextEdgeIdx++;
      }
    }
  }

  // --- Summary merge ---
  // Keep user summary only if they explicitly changed it (simple heuristic: not empty and differs)
  const summary =
    userAnalysis.summary && userAnalysis.summary !== llmAnalysis.summary
      ? userAnalysis.summary
      : llmAnalysis.summary;

  return {
    analysis: { nodes: mergedNodes, edges: mergedEdges, summary },
    conflicts,
    newNodes,
    removedNodes,
  };
}
