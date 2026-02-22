import { useMemo, useState, useCallback, useEffect } from "react";
import { useUserSchemas, useSchemaVoiceContexts, useUpdateUserSchema } from "@/hooks/use-sql-queries";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table2, Database, Key, Columns3, ChevronLeft, ArrowRight, Plus, Check, X, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { VoiceContextButton } from "@/components/VoiceContextButton";
import { normalizeTables, SchemaModule } from "@/components/SchemaModule";
import type { SchemaSelection } from "@/components/SchemaModule";
import type { ParsedTable, ParsedColumn, SchemaVoiceContext } from "@shared/schema";

/** Sort columns: primary keys first, then alphabetically by name. */
function sortColumns(columns: ParsedColumn[]): ParsedColumn[] {
  return [...columns].sort((a, b) => {
    if (a.isPrimaryKey && !b.isPrimaryKey) return -1;
    if (!a.isPrimaryKey && b.isPrimaryKey) return 1;
    return a.name.localeCompare(b.name);
  });
}

/** Format a Date or ISO string to a short readable timestamp. */
function formatTimestamp(ts?: Date | string): string | null {
  if (!ts) return null;
  const d = typeof ts === "string" ? new Date(ts) : ts;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
    " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** Generate a unique name that doesn't collide with existing names. */
function uniqueName(prefix: string, existingNames: string[]): string {
  const nameSet = new Set(existingNames.map((n) => n.toLowerCase()));
  let i = existingNames.length + 1;
  while (nameSet.has(`${prefix}${i}`.toLowerCase())) i++;
  return `${prefix}${i}`;
}

interface SchemaDetailViewProps {
  selection: SchemaSelection | null;
  onNavigate?: (selection: SchemaSelection | null) => void;
}

function findVoiceContext(
  contexts: SchemaVoiceContext[] | undefined,
  targetType: "schema" | "table" | "column",
  targetTable?: string | null,
  targetColumn?: string | null,
): SchemaVoiceContext | undefined {
  if (!contexts) return undefined;
  return contexts.find(
    (c) =>
      c.targetType === targetType &&
      (c.targetTable ?? null) === (targetTable ?? null) &&
      (c.targetColumn ?? null) === (targetColumn ?? null),
  );
}

// ---------------------------------------------------------------------------
// Schema Overview — shows all tables in the selected schema
// ---------------------------------------------------------------------------

function SchemaOverview({
  schema,
  tables,
  voiceContexts,
  onNavigate,
}: {
  schema: { id: number; name: string; description?: string | null; updatedAt?: Date | string };
  tables: ParsedTable[];
  voiceContexts?: SchemaVoiceContext[];
  onNavigate?: (selection: SchemaSelection | null) => void;
}) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState(schema.name);
  const updateMutation = useUpdateUserSchema();
  const { toast } = useToast();

  // Sync edit state when schema.name changes externally
  useEffect(() => { setEditName(schema.name); }, [schema.name]);

  const handleSaveName = useCallback(() => {
    const trimmed = editName.trim();
    if (!trimmed || trimmed === schema.name) {
      setIsEditingName(false);
      setEditName(schema.name);
      return;
    }
    updateMutation.mutate(
      { id: schema.id, data: { name: trimmed } },
      {
        onSuccess: () => {
          setIsEditingName(false);
          toast({ title: "Schema renamed" });
        },
        onError: () => {
          toast({ title: "Failed to rename", variant: "destructive" });
        },
      }
    );
  }, [editName, schema.id, schema.name, updateMutation, toast]);

  const handleAddTable = useCallback(() => {
    const name = uniqueName("new_table_", tables.map((t) => t.name));
    const newTable: ParsedTable = {
      name,
      columns: [{ name: "id", type: "INT", isPrimaryKey: true }],
      relationships: [],
    };
    updateMutation.mutate(
      { id: schema.id, data: { tables: [...tables, newTable] } },
      {
        onSuccess: () => toast({ title: "Table added" }),
        onError: () => toast({ title: "Failed to add table", variant: "destructive" }),
      }
    );
  }, [schema.id, tables, updateMutation, toast]);

  return (
    <div className="p-6 space-y-6">
      {/* Schema header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          aria-label="Back to schema list"
          onClick={() => onNavigate?.(null)}
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <Database className="w-5 h-5 text-primary" />
        <div className="flex-1">
          {isEditingName ? (
            <div className="flex items-center gap-1.5">
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveName();
                  if (e.key === "Escape") { setIsEditingName(false); setEditName(schema.name); }
                }}
                className="h-7 text-sm font-semibold"
                aria-label="Schema name"
                autoFocus
              />
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" aria-label="Save name" onClick={handleSaveName} disabled={updateMutation.isPending}>
                <Check className="w-3.5 h-3.5 text-emerald-500" />
              </Button>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" aria-label="Cancel editing" onClick={() => { setIsEditingName(false); setEditName(schema.name); }}>
                <X className="w-3.5 h-3.5 text-muted-foreground" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 group">
              <h2
                className="text-base font-semibold cursor-pointer hover:text-primary transition-colors"
                onClick={() => setIsEditingName(true)}
              >
                {schema.name}
              </h2>
              <button
                onClick={() => setIsEditingName(true)}
                aria-label="Rename schema"
                className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-accent/50 transition-all"
              >
                <Pencil className="w-3 h-3 text-muted-foreground" />
              </button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <p className="text-xs text-muted-foreground">{tables.length} table{tables.length !== 1 ? "s" : ""}</p>
            {schema.updatedAt && (
              <p className="text-[10px] text-muted-foreground/50">{formatTimestamp(schema.updatedAt)}</p>
            )}
          </div>
        </div>
        <VoiceContextButton
          schemaId={schema.id}
          targetType="schema"
          existingContext={findVoiceContext(voiceContexts, "schema")}
          size="lg"
        />
      </div>

      {schema.description && (
        <p className="text-xs text-muted-foreground bg-muted/30 rounded p-2">{schema.description}</p>
      )}

      {/* Table cards grid */}
      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.min(Math.ceil(Math.sqrt(tables.length)), 3)}, minmax(200px, 1fr))` }}>
        {tables.map((table) => {
          const sorted = sortColumns(table.columns);
          return (
            <button
              key={table.name}
              onClick={() => onNavigate?.({ schemaId: schema.id, tableName: table.name })}
              className="rounded-lg border border-border bg-card shadow-sm overflow-hidden text-left hover:border-primary/50 hover:shadow-md transition-all"
            >
              <div className="px-3 py-2 bg-primary/10 border-b border-border flex items-center gap-2">
                <Table2 className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                <span className="text-xs font-semibold text-foreground truncate">{table.name}</span>
                <Badge variant="secondary" className="text-[9px] h-4 ml-auto">{table.columns.length} cols</Badge>
              </div>
              <div className="p-2">
                {sorted.slice(0, 5).map((col) => (
                  <div key={col.name} className="flex items-center gap-1.5 text-[10px] py-[1px]">
                    {col.isPrimaryKey ? (
                      <Key className="w-2.5 h-2.5 text-amber-500 flex-shrink-0" />
                    ) : (
                      <Columns3 className="w-2.5 h-2.5 text-muted-foreground/30 flex-shrink-0" />
                    )}
                    <span className="font-mono text-muted-foreground truncate">{col.name}</span>
                    {col.type && (
                      <span className="text-[9px] text-muted-foreground/40 ml-auto font-mono">{col.type}</span>
                    )}
                  </div>
                ))}
                {table.columns.length > 5 && (
                  <p className="text-[9px] text-muted-foreground/50 mt-1">+{table.columns.length - 5} more...</p>
                )}
              </div>
            </button>
          );
        })}

        {/* Add table button */}
        <button
          onClick={handleAddTable}
          disabled={updateMutation.isPending}
          className="rounded-lg border-2 border-dashed border-border bg-card/50 shadow-sm overflow-hidden text-left hover:border-primary/50 hover:shadow-md transition-all flex flex-col items-center justify-center gap-2 py-8 min-h-[100px] disabled:opacity-50"
        >
          <Plus className="w-5 h-5 text-muted-foreground/50" />
          <span className="text-xs text-muted-foreground/50">Add Table</span>
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table Detail — full column listing + relationships
// ---------------------------------------------------------------------------

function TableDetail({
  schema,
  table,
  allTables,
  voiceContexts,
  onNavigate,
}: {
  schema: { id: number; name: string; updatedAt?: Date | string };
  table: ParsedTable;
  allTables: ParsedTable[];
  voiceContexts?: SchemaVoiceContext[];
  onNavigate?: (selection: SchemaSelection | null) => void;
}) {
  const outgoing = (table.relationships || []).map((r) => ({
    fromCol: r.fromCol,
    to: r.toTable,
    toCol: r.toCol,
  }));

  const incoming = allTables.flatMap((t) =>
    (t.relationships || [])
      .filter((r) => r.toTable.toLowerCase() === table.name.toLowerCase())
      .map((r) => ({ from: t.name, fromCol: r.fromCol, toCol: r.toCol }))
  );

  const sortedColumns = sortColumns(table.columns);

  const updateMutation = useUpdateUserSchema();
  const { toast } = useToast();

  const [isEditingTableName, setIsEditingTableName] = useState(false);
  const [editTableName, setEditTableName] = useState(table.name);

  // Sync edit state when table.name changes externally
  useEffect(() => { setEditTableName(table.name); }, [table.name]);

  const handleSaveTableName = useCallback(() => {
    const trimmed = editTableName.trim();
    if (!trimmed || trimmed === table.name) {
      setIsEditingTableName(false);
      setEditTableName(table.name);
      return;
    }
    // Update the table name AND fix FK references in other tables
    const updatedTables = allTables.map((t) => {
      if (t.name === table.name) return { ...t, name: trimmed };
      // Update relationship references pointing to the old name
      if (t.relationships?.some((r) => r.toTable === table.name)) {
        return {
          ...t,
          relationships: t.relationships.map((r) =>
            r.toTable === table.name ? { ...r, toTable: trimmed } : r
          ),
        };
      }
      return t;
    });
    updateMutation.mutate(
      { id: schema.id, data: { tables: updatedTables } },
      {
        onSuccess: () => {
          setIsEditingTableName(false);
          toast({ title: "Table renamed" });
          onNavigate?.({ schemaId: schema.id, tableName: trimmed });
        },
        onError: () => toast({ title: "Failed to rename", variant: "destructive" }),
      }
    );
  }, [editTableName, table.name, allTables, schema.id, updateMutation, toast, onNavigate]);

  const handleAddColumn = useCallback(() => {
    const colName = uniqueName("new_field_", table.columns.map((c) => c.name));
    const newCol: ParsedColumn = {
      name: colName,
      type: "VARCHAR(255)",
      isPrimaryKey: false,
    };
    const updatedTables = allTables.map((t) =>
      t.name === table.name ? { ...t, columns: [...t.columns, newCol] } : t
    );
    updateMutation.mutate(
      { id: schema.id, data: { tables: updatedTables } },
      {
        onSuccess: () => toast({ title: "Field added" }),
        onError: () => toast({ title: "Failed to add field", variant: "destructive" }),
      }
    );
  }, [table, allTables, schema.id, updateMutation, toast]);

  return (
    <div className="p-6 space-y-6">
      {/* Breadcrumb header */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          aria-label="Back to schema overview"
          onClick={() => onNavigate?.({ schemaId: schema.id })}
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <button
          onClick={() => onNavigate?.({ schemaId: schema.id })}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {schema.name}
        </button>
        <span className="text-xs text-muted-foreground/40">/</span>
        <Table2 className="w-4 h-4 text-emerald-500" />
        {isEditingTableName ? (
          <div className="flex items-center gap-1.5 flex-1">
            <Input
              value={editTableName}
              onChange={(e) => setEditTableName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveTableName();
                if (e.key === "Escape") { setIsEditingTableName(false); setEditTableName(table.name); }
              }}
              className="h-7 text-sm font-semibold font-mono max-w-[200px]"
              aria-label="Table name"
              autoFocus
            />
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" aria-label="Save name" onClick={handleSaveTableName} disabled={updateMutation.isPending}>
              <Check className="w-3.5 h-3.5 text-emerald-500" />
            </Button>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" aria-label="Cancel editing" onClick={() => { setIsEditingTableName(false); setEditTableName(table.name); }}>
              <X className="w-3.5 h-3.5 text-muted-foreground" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 flex-1 group">
            <h2
              className="text-base font-semibold cursor-pointer hover:text-primary transition-colors"
              onClick={() => setIsEditingTableName(true)}
            >
              {table.name}
            </h2>
            <button
              onClick={() => setIsEditingTableName(true)}
              aria-label="Rename table"
              className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-accent/50 transition-all"
            >
              <Pencil className="w-3 h-3 text-muted-foreground" />
            </button>
          </div>
        )}
        <VoiceContextButton
          schemaId={schema.id}
          targetType="table"
          targetTable={table.name}
          existingContext={findVoiceContext(voiceContexts, "table", table.name)}
          size="lg"
        />
      </div>

      {/* Column listing */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="px-3 py-1.5 bg-muted/30 border-b border-border flex items-center gap-2">
          {schema.updatedAt && (
            <p className="text-[10px] text-muted-foreground/50">{formatTimestamp(schema.updatedAt)}</p>
          )}
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider ml-auto">
            Columns ({table.columns.length})
          </p>
        </div>
        <div className="divide-y divide-border/50">
          {sortedColumns.map((col, ci) => {
            const isFK = outgoing.some((r) => r.fromCol.toLowerCase() === col.name.toLowerCase());
            return (
              <div
                key={col.name}
                role="button"
                tabIndex={0}
                onClick={() => onNavigate?.({ schemaId: schema.id, tableName: table.name, columnName: col.name })}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onNavigate?.({ schemaId: schema.id, tableName: table.name, columnName: col.name }); } }}
                className="flex items-center gap-3 px-3 py-2 pr-10 hover:bg-accent/30 transition-colors cursor-pointer"
              >
                {col.isPrimaryKey ? (
                  <Key className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                ) : isFK ? (
                  <Key className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                ) : (
                  <Columns3 className="w-3.5 h-3.5 text-muted-foreground/30 flex-shrink-0" />
                )}
                <span className={`text-xs font-mono flex-1 ${col.isPrimaryKey ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                  {col.name}
                </span>
                {col.type && (
                  <Badge variant="outline" className="text-[9px] h-5 font-mono">{col.type}</Badge>
                )}
                {col.isPrimaryKey && <Badge className="text-[9px] h-5 bg-amber-500/10 text-amber-600 border-amber-500/20">PK</Badge>}
                {isFK && <Badge className="text-[9px] h-5 bg-blue-500/10 text-blue-400 border-blue-500/20">FK</Badge>}
                <VoiceContextButton
                  schemaId={schema.id}
                  targetType="column"
                  targetTable={table.name}
                  targetColumn={col.name}
                  existingContext={findVoiceContext(voiceContexts, "column", table.name, col.name)}
                  size="sm"
                />
              </div>
            );
          })}
        </div>
        {/* Add field button */}
        <button
          onClick={handleAddColumn}
          disabled={updateMutation.isPending}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs text-muted-foreground/50 hover:text-muted-foreground hover:bg-accent/20 transition-colors border-t border-border/50 disabled:opacity-50"
        >
          <Plus className="w-3 h-3" />
          Add Field
        </button>
      </div>

      {/* Relationships */}
      {(outgoing.length > 0 || incoming.length > 0) && (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="px-3 py-1.5 bg-muted/30 border-b border-border">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              Relationships
            </p>
          </div>
          <div className="p-3 space-y-1.5">
            {outgoing.map((r, ri) => (
              <div key={`o-${ri}`} className="flex items-center gap-2 text-xs">
                <span className="font-mono text-foreground">{r.fromCol}</span>
                <ArrowRight className="w-3 h-3 text-blue-400" />
                <span className="font-mono text-blue-400">{r.to}.{r.toCol}</span>
              </div>
            ))}
            {incoming.map((r, ri) => (
              <div key={`i-${ri}`} className="flex items-center gap-2 text-xs">
                <ArrowRight className="w-3 h-3 text-emerald-400 rotate-180" />
                <span className="font-mono text-emerald-400">{r.from}.{r.fromCol}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Column Detail — single column info
// ---------------------------------------------------------------------------

function ColumnDetail({
  schema,
  table,
  column,
  voiceContexts,
  onNavigate,
}: {
  schema: { id: number; name: string };
  table: ParsedTable;
  column: ParsedColumn;
  voiceContexts?: SchemaVoiceContext[];
  onNavigate?: (selection: SchemaSelection | null) => void;
}) {
  const outgoing = (table.relationships || []).filter(
    (r) => r.fromCol.toLowerCase() === column.name.toLowerCase()
  );

  return (
    <div className="p-6 space-y-6">
      {/* Breadcrumb header */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          aria-label="Back to table detail"
          onClick={() => onNavigate?.({ schemaId: schema.id, tableName: table.name })}
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <button
          onClick={() => onNavigate?.({ schemaId: schema.id })}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {schema.name}
        </button>
        <span className="text-xs text-muted-foreground/40">/</span>
        <button
          onClick={() => onNavigate?.({ schemaId: schema.id, tableName: table.name })}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {table.name}
        </button>
        <span className="text-xs text-muted-foreground/40">/</span>
        {column.isPrimaryKey ? (
          <Key className="w-4 h-4 text-amber-500" />
        ) : (
          <Columns3 className="w-4 h-4 text-muted-foreground" />
        )}
        <h2 className="text-base font-semibold font-mono flex-1">{column.name}</h2>
        <VoiceContextButton
          schemaId={schema.id}
          targetType="column"
          targetTable={table.name}
          targetColumn={column.name}
          existingContext={findVoiceContext(voiceContexts, "column", table.name, column.name)}
          size="lg"
        />
      </div>

      {/* Column details card */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="px-3 py-1.5 bg-muted/30 border-b border-border">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Column Properties</p>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Name</span>
            <span className="text-xs font-mono font-medium">{column.name}</span>
          </div>
          {column.type && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Type</span>
              <Badge variant="outline" className="text-xs font-mono">{column.type}</Badge>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Primary Key</span>
            <Badge variant={column.isPrimaryKey ? "default" : "secondary"} className="text-[10px]">
              {column.isPrimaryKey ? "Yes" : "No"}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Table</span>
            <button
              onClick={() => onNavigate?.({ schemaId: schema.id, tableName: table.name })}
              className="text-xs font-mono text-primary hover:underline"
            >
              {table.name}
            </button>
          </div>
        </div>
      </div>

      {/* Relationships involving this column */}
      {outgoing.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="px-3 py-1.5 bg-muted/30 border-b border-border">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Foreign Key References</p>
          </div>
          <div className="p-3 space-y-1.5">
            {outgoing.map((r, ri) => (
              <div key={ri} className="flex items-center gap-2 text-xs">
                <ArrowRight className="w-3 h-3 text-blue-400" />
                <span className="font-mono text-blue-400">{r.toTable}.{r.toCol}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main SchemaDetailView — routes to the right sub-view based on selection
// ---------------------------------------------------------------------------

export function SchemaDetailView({ selection, onNavigate }: SchemaDetailViewProps) {
  const { data: schemas, isLoading } = useUserSchemas();
  const { data: voiceContexts } = useSchemaVoiceContexts(selection?.schemaId ?? null);

  const resolvedData = useMemo(() => {
    if (!schemas || !selection?.schemaId) return null;
    const schema = schemas.find((s) => s.id === selection.schemaId);
    if (!schema) return null;

    const tables = normalizeTables(schema.tables);
    const table = selection.tableName
      ? tables.find((t) => t.name === selection.tableName)
      : undefined;
    const column = table && selection.columnName
      ? table.columns.find((c) => c.name === selection.columnName)
      : undefined;

    return { schema, tables, table, column };
  }, [schemas, selection]);

  // No selection → show default ERD
  if (!selection?.schemaId) {
    return <SchemaModule />;
  }

  if (isLoading || !resolvedData) {
    return <SchemaModule />;
  }

  const { schema, tables, table, column } = resolvedData;

  const schemaWithMeta = { id: schema.id, name: schema.name, description: schema.description, updatedAt: schema.updatedAt ?? undefined };

  // Column selected
  if (table && column) {
    return (
      <ScrollArea className="h-full">
        <ColumnDetail
          schema={schemaWithMeta}
          table={table}
          column={column}
          voiceContexts={voiceContexts}
          onNavigate={onNavigate}
        />
      </ScrollArea>
    );
  }

  // Table selected
  if (table) {
    return (
      <ScrollArea className="h-full">
        <TableDetail
          schema={schemaWithMeta}
          table={table}
          allTables={tables}
          voiceContexts={voiceContexts}
          onNavigate={onNavigate}
        />
      </ScrollArea>
    );
  }

  // Schema selected
  return (
    <ScrollArea className="h-full">
      <SchemaOverview
        schema={schemaWithMeta}
        tables={tables}
        voiceContexts={voiceContexts}
        onNavigate={onNavigate}
      />
    </ScrollArea>
  );
}
