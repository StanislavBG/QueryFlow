import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Table2, ArrowRight, Link2, Database } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VisualExplorerProps {
  queryContent: string;
  schemas?: Array<{
    name: string;
    tables: Array<{ name: string; columns: string[] }>;
  }>;
}

interface ParsedTable {
  name: string;
  alias?: string;
  columns: string[];
  isSubquery: boolean;
}

interface JoinRelationship {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  joinType: string;
  condition: string;
}

// ---------------------------------------------------------------------------
// SQL Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Remove SQL comments (single-line and multi-line) and string literals so they
 * do not accidentally match table/column patterns.
 */
function stripCommentsAndStrings(sql: string): string {
  // Remove multi-line comments
  let cleaned = sql.replace(/\/\*[\s\S]*?\*\//g, " ");
  // Remove single-line comments
  cleaned = cleaned.replace(/--[^\n]*/g, " ");
  // Remove string literals (single-quoted)
  cleaned = cleaned.replace(/'[^']*'/g, "''");
  return cleaned;
}

/**
 * Resolve a reference (which might be an alias) to its canonical table name.
 */
function resolveAlias(
  ref: string,
  aliasMap: Map<string, string>
): string {
  const upper = ref.toUpperCase();
  return aliasMap.get(upper) || ref;
}

/**
 * Parse FROM and JOIN clauses to extract tables and relationships.
 */
function parseSql(
  sql: string,
  schemas?: VisualExplorerProps["schemas"]
): { tables: ParsedTable[]; joins: JoinRelationship[] } {
  if (!sql.trim()) {
    return { tables: [], joins: [] };
  }

  const cleaned = stripCommentsAndStrings(sql);

  // Build a lookup of schema tables for column resolution
  const schemaTableMap = new Map<string, string[]>();
  if (schemas) {
    for (const schema of schemas) {
      for (const table of schema.tables) {
        schemaTableMap.set(table.name.toUpperCase(), table.columns);
      }
    }
  }

  // --- Extract tables -------------------------------------------------------

  const tableEntries: Array<{
    name: string;
    alias?: string;
    isSubquery: boolean;
  }> = [];
  const seenTableNames = new Set<string>();

  // Match FROM table [AS] alias  — handles optional schema prefix (schema.table)
  const fromRegex =
    /\bFROM\s+(?![\s(])(\w+(?:\.\w+)?)\s*(?:AS\s+)?(\w+)?/gi;
  let match: RegExpExecArray | null;
  while ((match = fromRegex.exec(cleaned)) !== null) {
    const rawName = match[1];
    // Skip if it looks like a subquery keyword artifact
    if (/^(SELECT|WHERE|SET|VALUES)$/i.test(rawName)) continue;
    const name = rawName.includes(".") ? rawName.split(".").pop()! : rawName;
    const alias = match[2] && !/^(WHERE|ON|INNER|LEFT|RIGHT|FULL|CROSS|JOIN|ORDER|GROUP|HAVING|LIMIT|UNION|SET)$/i.test(match[2])
      ? match[2]
      : undefined;
    const key = name.toUpperCase();
    if (!seenTableNames.has(key)) {
      seenTableNames.add(key);
      tableEntries.push({ name, alias, isSubquery: false });
    }
  }

  // Match [LEFT|RIGHT|INNER|FULL|CROSS] JOIN table [AS] alias ON condition
  const joinRegex =
    /\b((?:LEFT\s+(?:OUTER\s+)?|RIGHT\s+(?:OUTER\s+)?|FULL\s+(?:OUTER\s+)?|INNER\s+|CROSS\s+)?JOIN)\s+(\w+(?:\.\w+)?)\s*(?:AS\s+)?(\w+)?\s+ON\s+([\s\S]*?)(?=\b(?:LEFT|RIGHT|INNER|FULL|CROSS|JOIN|WHERE|ORDER|GROUP|HAVING|LIMIT|UNION|$))/gi;
  const joins: JoinRelationship[] = [];

  while ((match = joinRegex.exec(cleaned)) !== null) {
    const joinType = match[1].replace(/\s+/g, " ").trim().toUpperCase();
    const rawName = match[2];
    const name = rawName.includes(".") ? rawName.split(".").pop()! : rawName;
    const alias = match[3] && !/^(ON|WHERE|AND|OR|INNER|LEFT|RIGHT|FULL|CROSS|JOIN|ORDER|GROUP|HAVING|LIMIT|UNION|SET)$/i.test(match[3])
      ? match[3]
      : undefined;
    const condition = match[4].trim().replace(/\s+/g, " ");

    const key = name.toUpperCase();
    if (!seenTableNames.has(key)) {
      seenTableNames.add(key);
      tableEntries.push({ name, alias, isSubquery: false });
    }

    // Parse ON condition to extract column-level relationships
    // Pattern: a.col = b.col  (possibly multiple via AND)
    const condParts = condition.split(/\bAND\b/i);
    for (const part of condParts) {
      const eqMatch = part.match(
        /(\w+)\.(\w+)\s*=\s*(\w+)\.(\w+)/
      );
      if (eqMatch) {
        joins.push({
          fromTable: eqMatch[1],
          fromColumn: eqMatch[2],
          toTable: eqMatch[3],
          toColumn: eqMatch[4],
          joinType,
          condition: part.trim(),
        });
      } else {
        // If we can't parse columns, still record a relationship
        joins.push({
          fromTable: "",
          fromColumn: "",
          toTable: name,
          toColumn: "",
          joinType,
          condition: condition,
        });
      }
    }
  }

  // Detect subqueries — simplified: find (SELECT ...) alias patterns
  const subqueryRegex =
    /\(\s*SELECT\s[\s\S]*?\)\s+(?:AS\s+)?(\w+)/gi;
  while ((match = subqueryRegex.exec(cleaned)) !== null) {
    const alias = match[1];
    if (alias && !/^(ON|WHERE|AND|OR|ORDER|GROUP|HAVING)$/i.test(alias)) {
      const key = alias.toUpperCase();
      if (!seenTableNames.has(key)) {
        seenTableNames.add(key);
        tableEntries.push({ name: alias, alias: undefined, isSubquery: true });
      }
    }
  }

  // --- Build alias map (alias -> canonical name) ---
  const aliasMap = new Map<string, string>();
  for (const entry of tableEntries) {
    aliasMap.set(entry.name.toUpperCase(), entry.name);
    if (entry.alias) {
      aliasMap.set(entry.alias.toUpperCase(), entry.name);
    }
  }

  // --- Resolve join references to canonical table names ---
  const resolvedJoins: JoinRelationship[] = joins.map((j) => ({
    ...j,
    fromTable: j.fromTable ? resolveAlias(j.fromTable, aliasMap) : j.fromTable,
    toTable: resolveAlias(j.toTable, aliasMap),
  }));

  // --- Collect columns referenced in query for each table ---
  const tableColumnRefs = new Map<string, Set<string>>();
  for (const entry of tableEntries) {
    tableColumnRefs.set(entry.name.toUpperCase(), new Set());
  }

  // Gather column references from the query:  alias.column  or  table.column
  const colRefRegex = /\b(\w+)\.(\w+)\b/g;
  while ((match = colRefRegex.exec(cleaned)) !== null) {
    const ref = match[1];
    const col = match[2];
    // Skip SQL keywords that look like table refs
    if (/^(dbo|sys|information_schema)$/i.test(ref)) continue;
    const resolved = resolveAlias(ref, aliasMap);
    const key = resolved.toUpperCase();
    if (tableColumnRefs.has(key)) {
      tableColumnRefs.get(key)!.add(col);
    }
  }

  // --- Build final ParsedTable list ---
  const tables: ParsedTable[] = tableEntries.map((entry) => {
    const key = entry.name.toUpperCase();

    // Prefer schema columns if available
    let columns: string[] = [];
    if (schemaTableMap.has(key)) {
      columns = schemaTableMap.get(key)!;
    } else {
      // Fall back to referenced columns from the query
      const refs = tableColumnRefs.get(key);
      if (refs && refs.size > 0) {
        columns = Array.from(refs);
      }
    }

    return {
      name: entry.name,
      alias: entry.alias,
      columns,
      isSubquery: entry.isSubquery,
    };
  });

  return { tables, joins: resolvedJoins };
}

// ---------------------------------------------------------------------------
// Connection line drawing
// ---------------------------------------------------------------------------

interface ConnectionLine {
  fromRect: DOMRect;
  toRect: DOMRect;
  join: JoinRelationship;
}

function getConnectionPath(
  from: DOMRect,
  to: DOMRect,
  containerRect: DOMRect
): string {
  // Calculate centre points relative to the container
  const fromCx = from.left + from.width / 2 - containerRect.left;
  const fromCy = from.top + from.height / 2 - containerRect.top;
  const toCx = to.left + to.width / 2 - containerRect.left;
  const toCy = to.top + to.height / 2 - containerRect.top;

  // Determine best attachment edges
  let x1: number, y1: number, x2: number, y2: number;

  if (fromCx < toCx) {
    // From is on the left
    x1 = from.right - containerRect.left;
    y1 = fromCy;
    x2 = to.left - containerRect.left;
    y2 = toCy;
  } else {
    // From is on the right
    x1 = from.left - containerRect.left;
    y1 = fromCy;
    x2 = to.right - containerRect.left;
    y2 = toCy;
  }

  // Cubic bezier with horizontal control points for a nice curve
  const midX = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TableCard({
  table,
  schemas,
  registerRef,
}: {
  table: ParsedTable;
  schemas?: VisualExplorerProps["schemas"];
  registerRef: (name: string, el: HTMLDivElement | null) => void;
}) {
  // Determine if a column is a primary key from schema info
  const isPrimaryKey = useCallback(
    (col: string): boolean => {
      // Simple heuristic: column ends in _id or is called "id" and matches the table name pattern
      if (/^id$/i.test(col)) return true;
      // Check if column name follows pattern table_id for this table
      const tableBase = table.name.replace(/s$/i, "");
      if (col.toLowerCase() === `${tableBase.toLowerCase()}_id`) return true;
      return false;
    },
    [table.name]
  );

  return (
    <div
      ref={(el) => registerRef(table.name, el)}
      className="relative rounded-lg border border-border bg-card shadow-sm hover:shadow-md transition-shadow duration-200 min-w-[180px] max-w-[260px]"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/50 rounded-t-lg">
        {table.isSubquery ? (
          <Database className="w-3.5 h-3.5 text-primary flex-shrink-0" />
        ) : (
          <Table2 className="w-3.5 h-3.5 text-primary flex-shrink-0" />
        )}
        <span className="text-sm font-bold text-foreground truncate">
          {table.name}
        </span>
        {table.alias && (
          <Badge variant="secondary" className="text-[10px] h-4 ml-auto">
            {table.alias}
          </Badge>
        )}
        {table.isSubquery && (
          <Badge variant="outline" className="text-[10px] h-4 ml-auto bg-primary/10 text-primary border-primary/30">
            subquery
          </Badge>
        )}
      </div>

      {/* Columns */}
      <div className="px-3 py-2 space-y-1">
        {table.columns.length > 0 ? (
          table.columns.map((col) => (
            <div key={col} className="flex items-center gap-1.5">
              {isPrimaryKey(col) ? (
                <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
              ) : (
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30 flex-shrink-0" />
              )}
              <span
                className={`text-xs font-mono truncate ${
                  isPrimaryKey(col)
                    ? "text-primary font-semibold"
                    : "text-muted-foreground"
                }`}
              >
                {col}
              </span>
              {isPrimaryKey(col) && (
                <Badge
                  variant="outline"
                  className="text-[9px] h-3.5 px-1 ml-auto bg-primary/10 text-primary border-primary/30"
                >
                  PK
                </Badge>
              )}
            </div>
          ))
        ) : (
          <p className="text-[10px] text-muted-foreground/50 italic">
            No columns detected
          </p>
        )}
      </div>
    </div>
  );
}

function ConnectionOverlay({
  connections,
  containerRef,
}: {
  connections: ConnectionLine[];
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (!containerRef.current || connections.length === 0) return null;

  const containerRect = containerRef.current.getBoundingClientRect();

  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 1 }}
    >
      {connections.map((conn, i) => {
        const path = getConnectionPath(
          conn.fromRect,
          conn.toRect,
          containerRect
        );
        const isHovered = hoveredIndex === i;

        return (
          <g key={i}>
            {/* Wider invisible path for easier hover */}
            <path
              d={path}
              fill="none"
              stroke="transparent"
              strokeWidth={16}
              className="pointer-events-auto cursor-pointer"
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
            />
            {/* Visible path */}
            <path
              d={path}
              fill="none"
              className={
                isHovered
                  ? "stroke-primary"
                  : "stroke-muted-foreground/30"
              }
              strokeWidth={isHovered ? 2.5 : 1.5}
              strokeDasharray={isHovered ? "none" : "6 3"}
              style={{ transition: "stroke 0.15s, stroke-width 0.15s" }}
            />
            {/* Arrow marker at the end */}
            {(() => {
              // Compute arrow position and direction from the path endpoint
              const toCenter = {
                x:
                  conn.toRect.left +
                  conn.toRect.width / 2 -
                  containerRect.left,
                y:
                  conn.toRect.top +
                  conn.toRect.height / 2 -
                  containerRect.top,
              };
              const fromCenter = {
                x:
                  conn.fromRect.left +
                  conn.fromRect.width / 2 -
                  containerRect.left,
                y:
                  conn.fromRect.top +
                  conn.fromRect.height / 2 -
                  containerRect.top,
              };
              // Small dot at the midpoint of the path
              const mid = {
                x: (fromCenter.x + toCenter.x) / 2,
                y: (fromCenter.y + toCenter.y) / 2,
              };

              return (
                <circle
                  cx={mid.x}
                  cy={mid.y}
                  r={isHovered ? 4 : 3}
                  className={
                    isHovered ? "fill-primary" : "fill-muted-foreground/40"
                  }
                  style={{ transition: "fill 0.15s, r 0.15s" }}
                />
              );
            })()}
          </g>
        );
      })}

      {/* Hover tooltip for connections */}
      {hoveredIndex !== null && (() => {
        const conn = connections[hoveredIndex];
        const midX =
          (conn.fromRect.left +
            conn.fromRect.width / 2 +
            conn.toRect.left +
            conn.toRect.width / 2) /
            2 -
          containerRect.left;
        const midY =
          (conn.fromRect.top +
            conn.fromRect.height / 2 +
            conn.toRect.top +
            conn.toRect.height / 2) /
            2 -
          containerRect.top;

        return (
          <foreignObject
            x={midX - 140}
            y={midY - 48}
            width={280}
            height={60}
            className="pointer-events-none"
          >
            <div className="flex items-center justify-center h-full">
              <div className="rounded-md border border-border bg-popover px-3 py-1.5 shadow-md text-xs text-popover-foreground max-w-[260px] text-center">
                <div className="font-semibold text-primary mb-0.5">
                  {conn.join.joinType}
                </div>
                <div className="font-mono text-[10px] text-muted-foreground break-all">
                  {conn.join.condition}
                </div>
              </div>
            </div>
          </foreignObject>
        );
      })()}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full py-16 px-6 text-center">
      <div className="rounded-full bg-muted p-4 mb-4">
        <Database className="w-8 h-8 text-muted-foreground/40" />
      </div>
      <h3 className="text-sm font-semibold text-foreground mb-1">
        No query to visualize
      </h3>
      <p className="text-xs text-muted-foreground max-w-[280px]">
        Write a SQL query with FROM and JOIN clauses to see a visual
        representation of tables, relationships, and data flow.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function VisualExplorer({ queryContent, schemas }: VisualExplorerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tableRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [connections, setConnections] = useState<ConnectionLine[]>([]);
  const [renderKey, setRenderKey] = useState(0);

  const { tables, joins } = useMemo(
    () => parseSql(queryContent, schemas),
    [queryContent, schemas]
  );

  const registerTableRef = useCallback(
    (name: string, el: HTMLDivElement | null) => {
      if (el) {
        tableRefs.current.set(name.toUpperCase(), el);
      } else {
        tableRefs.current.delete(name.toUpperCase());
      }
    },
    []
  );

  // Recompute connection lines after tables render / resize
  useEffect(() => {
    if (tables.length === 0 || joins.length === 0) {
      setConnections([]);
      return;
    }

    // Small delay to let the DOM settle
    const timer = setTimeout(() => {
      const newConnections: ConnectionLine[] = [];

      for (const join of joins) {
        const fromEl = tableRefs.current.get(join.fromTable.toUpperCase());
        const toEl = tableRefs.current.get(join.toTable.toUpperCase());

        if (fromEl && toEl) {
          newConnections.push({
            fromRect: fromEl.getBoundingClientRect(),
            toRect: toEl.getBoundingClientRect(),
            join,
          });
        }
      }

      setConnections(newConnections);
    }, 100);

    return () => clearTimeout(timer);
  }, [tables, joins, renderKey]);

  // Re-measure on window resize
  useEffect(() => {
    const handleResize = () => setRenderKey((k) => k + 1);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  if (!queryContent.trim() || tables.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-primary" />
          <span className="text-xs font-semibold text-foreground">
            Visual Explorer
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px] h-5">
            <Table2 className="w-3 h-3 mr-1" />
            {tables.length} table{tables.length !== 1 ? "s" : ""}
          </Badge>
          {joins.length > 0 && (
            <Badge variant="outline" className="text-[10px] h-5">
              <Link2 className="w-3 h-3 mr-1" />
              {joins.length} join{joins.length !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>
      </div>

      {/* Diagram area */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-auto p-6"
      >
        {/* SVG connection overlay */}
        <ConnectionOverlay
          connections={connections}
          containerRef={containerRef}
        />

        {/* Table cards laid out with flexbox */}
        <div
          className="relative flex flex-wrap items-start gap-6 justify-center"
          style={{ zIndex: 2 }}
        >
          {tables.map((table, index) => (
            <div key={table.name} className="flex items-center gap-3">
              <TableCard
                table={table}
                schemas={schemas}
                registerRef={registerTableRef}
              />
              {/* Arrow between sequential tables (not the last one) */}
              {index < tables.length - 1 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-muted border border-border">
                      <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p className="text-xs">Data flows from left to right</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          ))}
        </div>

        {/* Join details list (below the diagram) */}
        {joins.length > 0 && (
          <div className="mt-8 space-y-2" style={{ position: "relative", zIndex: 2 }}>
            <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Relationships
            </h4>
            <div className="grid gap-2 sm:grid-cols-1 md:grid-cols-2">
              {joins.map((join, i) => (
                <Tooltip key={i}>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs cursor-default hover:bg-muted/60 transition-colors">
                      <Link2 className="w-3 h-3 text-primary flex-shrink-0" />
                      <span className="font-mono font-semibold text-foreground">
                        {join.fromTable}
                        {join.fromColumn ? `.${join.fromColumn}` : ""}
                      </span>
                      <Badge
                        variant="outline"
                        className="text-[9px] h-4 px-1.5 bg-primary/10 text-primary border-primary/30"
                      >
                        {join.joinType}
                      </Badge>
                      <ArrowRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                      <span className="font-mono font-semibold text-foreground">
                        {join.toTable}
                        {join.toColumn ? `.${join.toColumn}` : ""}
                      </span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <div className="text-xs space-y-0.5">
                      <p className="font-semibold text-primary">{join.joinType}</p>
                      <p className="font-mono text-[10px]">{join.condition}</p>
                    </div>
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
