// ---------------------------------------------------------------------------
// Waterfall Flow Analysis Types
// ---------------------------------------------------------------------------

/** Node types in the waterfall DAG */
export type WaterfallNodeType =
  | "source_table"    // base tables referenced in FROM
  | "cte"             // WITH ... AS (...)
  | "temp_table"      // CREATE TEMP TABLE / INSERT INTO #table
  | "derived_table"   // subquery alias in FROM clause
  | "final_output";   // final SELECT result or persistent table write

/** Edge types representing different data-flow operations */
export type WaterfallEdgeType =
  | "join"            // merging multiple tables via JOIN
  | "create_insert"   // CREATE TABLE AS / INSERT INTO ... SELECT
  | "cte_definition"  // WITH cte AS (SELECT ...)
  | "subquery_ref"    // referencing a subquery/derived table
  | "select_from";    // simple SELECT FROM (data reads)

/** A single node in the waterfall DAG */
export interface WaterfallNode {
  id: string;                    // unique, e.g., "node_0", "node_1"
  name: string;                  // table/CTE/temp table name
  nodeType: WaterfallNodeType;
  columns?: string[];            // key columns involved
  stepIndex: number;             // vertical ordering (0 = top)
  isShadow?: boolean;            // true for ghost copies shown at step 0
  displayStepIndex?: number;     // step where the node is first introduced (for layout)
  userModified?: boolean;        // true if user has manually edited this node
}

/** A directed edge in the waterfall DAG */
export interface WaterfallEdge {
  id: string;                    // unique edge id, e.g., "edge_0"
  fromNodeId: string;
  toNodeId: string;
  edgeType: WaterfallEdgeType;
  sqlStatement: string;          // actual SQL shown in right panel on hover
  joinDetails?: string;          // for JOIN edges: e.g. "INNER JOIN ON a.id = b.id"
  userModified?: boolean;        // true if user has manually edited this edge
}

/** Full waterfall analysis result from the LLM */
export interface WaterfallAnalysis {
  nodes: WaterfallNode[];
  edges: WaterfallEdge[];
  summary: string;               // brief natural-language description of the flow
}

// ---------------------------------------------------------------------------
// Merge types — used when re-analyzing a query that has user-evolved data
// ---------------------------------------------------------------------------

export interface MergeConflict {
  type: "node" | "edge";
  name: string;                  // human-readable identifier (e.g., table name or edge label)
  field: string;                 // which field differs
  userValue: string;             // what the user has
  llmValue: string;              // what the LLM now says
  resolution: "kept_user";       // user always wins
}

export interface WaterfallMergeResult {
  analysis: WaterfallAnalysis;
  conflicts: MergeConflict[];
  newNodes: string[];            // names of nodes added from the new analysis
  removedNodes: string[];        // names of nodes in old data but not in new (kept)
}
