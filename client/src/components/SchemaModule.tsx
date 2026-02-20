import { useState, useRef, useCallback, useMemo } from "react";
import { useUserSchemas, useCreateUserSchema, useDeleteUserSchema, useUpdateUserSchema } from "@/hooks/use-sql-queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Upload,
  Trash2,
  Table2,
  ChevronDown,
  ChevronRight,
  FileText,
  Database,
  Columns3,
  Plus,
  Key,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { UserSchema } from "@shared/schema";

// ---------------------------------------------------------------------------
// Helpers: extract column type info from parsed DDL
// ---------------------------------------------------------------------------

interface ColumnInfo {
  name: string;
  type: string;
  isPrimaryKey: boolean;
}

function parseColumnsFromDdl(
  ddl: string,
  tableName: string,
  fallbackColumns: string[]
): ColumnInfo[] {
  // Try to find CREATE TABLE for this specific table
  const tablePattern = new RegExp(
    `CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:["'\`]?${tableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\`]?)\\s*\\(([^;]*?)\\)`,
    "is"
  );
  const match = ddl.match(tablePattern);

  if (!match) {
    return fallbackColumns.map((c) => ({ name: c, type: "", isPrimaryKey: false }));
  }

  const body = match[1];
  const lines = body.split(",").map((l) => l.trim()).filter(Boolean);
  const columns: ColumnInfo[] = [];

  for (const line of lines) {
    // Skip constraints like PRIMARY KEY(...), FOREIGN KEY(...), CONSTRAINT...
    if (/^\s*(PRIMARY\s+KEY|FOREIGN\s+KEY|CONSTRAINT|UNIQUE|CHECK|INDEX)/i.test(line)) {
      // Mark columns that appear in PRIMARY KEY(...)
      const pkMatch = line.match(/PRIMARY\s+KEY\s*\(([^)]+)\)/i);
      if (pkMatch) {
        const pkCols = pkMatch[1].split(",").map((c) => c.trim().replace(/["'`]/g, "").toLowerCase());
        for (const col of columns) {
          if (pkCols.includes(col.name.toLowerCase())) {
            col.isPrimaryKey = true;
          }
        }
      }
      continue;
    }

    // Parse: column_name TYPE [constraints...]
    const colMatch = line.match(/^["'`]?(\w+)["'`]?\s+(\w+(?:\s*\([^)]*\))?)/i);
    if (colMatch) {
      const isPk = /PRIMARY\s+KEY/i.test(line) || /SERIAL/i.test(colMatch[2]);
      columns.push({
        name: colMatch[1],
        type: colMatch[2].toUpperCase(),
        isPrimaryKey: isPk,
      });
    }
  }

  if (columns.length === 0) {
    return fallbackColumns.map((c) => ({ name: c, type: "", isPrimaryKey: false }));
  }

  return columns;
}

// ---------------------------------------------------------------------------
// SchemaTreePanel — compact tree for the LEFT sidebar
// ---------------------------------------------------------------------------

export function SchemaTreePanel() {
  const { data: schemas, isLoading } = useUserSchemas();
  const deleteMutation = useDeleteUserSchema();
  const createMutation = useCreateUserSchema();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [expandedSchemas, setExpandedSchemas] = useState<Set<number>>(new Set());
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());

  const toggleSchema = (id: number) => {
    setExpandedSchemas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleTable = (key: string) => {
    setExpandedTables((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleDelete = (id: number) => {
    deleteMutation.mutate(id, {
      onSuccess: () => toast({ title: "Schema removed" }),
    });
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      file.text().then((content) => {
        const name = file.name.replace(/\.[^.]+$/, "");
        createMutation.mutate(
          { name, rawContent: content, fileName: file.name },
          {
            onSuccess: () => toast({ title: "Schema added", description: `"${name}" has been parsed.` }),
            onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
          }
        );
      });
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const allTables = useMemo(() => {
    if (!schemas) return [];
    return schemas.flatMap((s) =>
      ((s.tables as Array<{ name: string; columns: string[] }>) || []).map((t) => ({
        ...t,
        schemaId: s.id,
        schemaName: s.name,
        ddl: s.parsedDdl || "",
      }))
    );
  }, [schemas]);

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b border-border flex items-center gap-1.5">
        <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex-1">Schemas</h3>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0"
          onClick={() => fileInputRef.current?.click()}
          disabled={createMutation.isPending}
        >
          {createMutation.isPending ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Plus className="w-3 h-3" />
          )}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".sql,.txt,.csv,.json,.ddl,.tsv"
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      <ScrollArea className="flex-1">
        <div className="p-1.5">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          ) : !schemas || schemas.length === 0 ? (
            <div className="text-center py-6 px-2">
              <Database className="w-6 h-6 mx-auto mb-1.5 text-muted-foreground/30" />
              <p className="text-[10px] text-muted-foreground">No schemas yet</p>
              <p className="text-[10px] text-muted-foreground/50 mt-0.5">Upload a DDL file to start</p>
            </div>
          ) : (
            schemas.map((schema) => {
              const tables = (schema.tables as Array<{ name: string; columns: string[] }>) || [];
              const isExpanded = expandedSchemas.has(schema.id);

              return (
                <div key={schema.id} className="mb-0.5">
                  {/* Schema node */}
                  <button
                    onClick={() => toggleSchema(schema.id)}
                    className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded text-left hover:bg-accent/50 group"
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                    ) : (
                      <ChevronRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                    )}
                    <Database className="w-3 h-3 text-primary flex-shrink-0" />
                    <span className="text-[11px] font-medium truncate flex-1">{schema.name}</span>
                    <span className="text-[9px] text-muted-foreground/50">{tables.length}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(schema.id); }}
                      className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/20 transition-all"
                    >
                      <Trash2 className="w-2.5 h-2.5 text-destructive" />
                    </button>
                  </button>

                  {/* Tables under this schema */}
                  {isExpanded && tables.map((table, ti) => {
                    const tableKey = `${schema.id}-${ti}`;
                    const isTableExpanded = expandedTables.has(tableKey);
                    const columns = parseColumnsFromDdl(schema.parsedDdl || "", table.name, table.columns);

                    return (
                      <div key={ti} className="ml-3">
                        <button
                          onClick={() => toggleTable(tableKey)}
                          className="w-full flex items-center gap-1.5 px-1.5 py-0.5 rounded text-left hover:bg-accent/50"
                        >
                          {isTableExpanded ? (
                            <ChevronDown className="w-2.5 h-2.5 text-muted-foreground flex-shrink-0" />
                          ) : (
                            <ChevronRight className="w-2.5 h-2.5 text-muted-foreground flex-shrink-0" />
                          )}
                          <Table2 className="w-3 h-3 text-emerald-500 flex-shrink-0" />
                          <span className="text-[10px] font-medium truncate">{table.name}</span>
                          <span className="text-[9px] text-muted-foreground/50 ml-auto">{columns.length}</span>
                        </button>

                        {/* Columns under this table */}
                        {isTableExpanded && (
                          <div className="ml-5 border-l border-border/50 pl-2 py-0.5">
                            {columns.map((col, ci) => (
                              <div
                                key={ci}
                                className="flex items-center gap-1.5 py-[1px] text-[10px]"
                              >
                                {col.isPrimaryKey ? (
                                  <Key className="w-2.5 h-2.5 text-amber-500 flex-shrink-0" />
                                ) : (
                                  <Columns3 className="w-2.5 h-2.5 text-muted-foreground/40 flex-shrink-0" />
                                )}
                                <span className={`font-mono truncate ${col.isPrimaryKey ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                                  {col.name}
                                </span>
                                {col.type && (
                                  <span className="text-[9px] text-muted-foreground/50 ml-auto font-mono flex-shrink-0">
                                    {col.type}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SchemaUpload — the upload interface (used when no schemas exist)
// ---------------------------------------------------------------------------

export function SchemaUpload() {
  const createMutation = useCreateUserSchema();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [schemaName, setSchemaName] = useState("");
  const [schemaDescription, setSchemaDescription] = useState("");

  const processFile = useCallback(
    async (file: File) => {
      const content = await file.text();
      const name = schemaName.trim() || file.name.replace(/\.[^.]+$/, "");

      createMutation.mutate(
        { name, rawContent: content, fileName: file.name, description: schemaDescription.trim() || undefined },
        {
          onSuccess: () => {
            toast({ title: "Schema added", description: `"${name}" has been parsed and added.` });
            setSchemaName("");
            setSchemaDescription("");
          },
          onError: (err) => {
            toast({ title: "Error", description: err.message, variant: "destructive" });
          },
        }
      );
    },
    [schemaName, schemaDescription, createMutation, toast]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        processFile(files[0]);
      }
    },
    [processFile]
  );

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handlePaste = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      const name = schemaName.trim() || "Pasted Schema";
      createMutation.mutate(
        { name, rawContent: text, description: schemaDescription.trim() || undefined },
        {
          onSuccess: () => {
            toast({ title: "Schema added", description: `"${name}" has been parsed and added.` });
            setSchemaName("");
            setSchemaDescription("");
          },
          onError: (err) => {
            toast({ title: "Error", description: err.message, variant: "destructive" });
          },
        }
      );
    },
    [schemaName, schemaDescription, createMutation, toast]
  );

  return (
    <div className="flex flex-col items-center justify-center h-full px-8 gap-4">
      <Database className="w-12 h-12 text-muted-foreground/20" />
      <div className="text-center">
        <p className="text-sm font-medium text-foreground">Add Your Schema</p>
        <p className="text-xs text-muted-foreground mt-1">
          Upload DDL files, paste SQL, or drop files to populate the ERD
        </p>
      </div>

      <div className="w-full max-w-sm space-y-2">
        <Input
          value={schemaName}
          onChange={(e) => setSchemaName(e.target.value)}
          placeholder="Schema name (optional)"
          className="h-8 text-xs"
        />

        <Textarea
          value={schemaDescription}
          onChange={(e) => setSchemaDescription(e.target.value)}
          placeholder="Description (optional)"
          className="text-xs min-h-[50px] max-h-[80px]"
        />

        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
            isDragOver
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50"
          }`}
        >
          <Upload className="w-6 h-6 mx-auto mb-2 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">Drop a file or click to upload</p>
          <p className="text-[10px] text-muted-foreground/60 mt-1">SQL DDL, CSV, JSON, or text</p>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".sql,.txt,.csv,.json,.ddl,.tsv"
          onChange={handleFileSelect}
          className="hidden"
        />

        <Button
          size="sm"
          variant="outline"
          className="w-full h-8 text-xs"
          onClick={() => {
            navigator.clipboard.readText().then(handlePaste).catch(() => {
              toast({ title: "Paste failed", description: "Allow clipboard access to paste schema.", variant: "destructive" });
            });
          }}
        >
          <FileText className="w-3 h-3 mr-1.5" />
          Paste from clipboard
        </Button>

        {createMutation.isPending && (
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground py-2">
            <Loader2 className="w-3 h-3 animate-spin" />
            Parsing schema...
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SchemaERD — ERD diagram for center panel when schemas have tables
// ---------------------------------------------------------------------------

interface ERDTable {
  name: string;
  columns: ColumnInfo[];
  schemaName: string;
}

interface ERDRelationship {
  from: string;
  fromCol: string;
  to: string;
  toCol: string;
}

function detectRelationships(tables: ERDTable[], ddl: string): ERDRelationship[] {
  const relationships: ERDRelationship[] = [];

  // Parse FOREIGN KEY ... REFERENCES from DDL
  const fkPattern = /FOREIGN\s+KEY\s*\(\s*["'`]?(\w+)["'`]?\s*\)\s*REFERENCES\s+["'`]?(\w+)["'`]?\s*\(\s*["'`]?(\w+)["'`]?\s*\)/gi;
  const tableNames = new Set(tables.map((t) => t.name.toLowerCase()));

  // Match REFERENCES in the DDL globally
  let match;
  while ((match = fkPattern.exec(ddl)) !== null) {
    const [, fromCol, toTable, toCol] = match;
    // Find which table this FK belongs to by scanning backwards for CREATE TABLE
    const before = ddl.substring(0, match.index);
    const createMatch = Array.from(before.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)["'`]?/gi));
    if (createMatch.length > 0) {
      const fromTable = createMatch[createMatch.length - 1][1];
      relationships.push({ from: fromTable, fromCol, to: toTable, toCol });
    }
  }

  // Also detect by naming convention: columns ending in _id referencing other tables
  if (relationships.length === 0) {
    for (const table of tables) {
      for (const col of table.columns) {
        if (col.name.toLowerCase().endsWith("_id")) {
          const refName = col.name.toLowerCase().replace(/_id$/, "");
          // Check plural and singular forms
          const candidates = [refName, refName + "s", refName + "es"];
          for (const candidate of candidates) {
            if (tableNames.has(candidate) && candidate !== table.name.toLowerCase()) {
              const targetTable = tables.find((t) => t.name.toLowerCase() === candidate);
              const targetPk = targetTable?.columns.find((c) => c.isPrimaryKey);
              relationships.push({
                from: table.name,
                fromCol: col.name,
                to: targetTable?.name || candidate,
                toCol: targetPk?.name || "id",
              });
              break;
            }
          }
        }
      }
    }
  }

  return relationships;
}

export function SchemaERD() {
  const { data: schemas } = useUserSchemas();

  const { tables, relationships, ddl } = useMemo(() => {
    if (!schemas) return { tables: [] as ERDTable[], relationships: [] as ERDRelationship[], ddl: "" };

    const allDdl = schemas.map((s) => s.parsedDdl || "").join("\n\n");
    const allTables: ERDTable[] = schemas.flatMap((s) =>
      ((s.tables as Array<{ name: string; columns: string[] }>) || []).map((t) => ({
        name: t.name,
        columns: parseColumnsFromDdl(s.parsedDdl || "", t.name, t.columns),
        schemaName: s.name,
      }))
    );

    const rels = detectRelationships(allTables, allDdl);

    return { tables: allTables, relationships: rels, ddl: allDdl };
  }, [schemas]);

  if (tables.length === 0) return null;

  // Layout: arrange tables in a grid
  const cols = Math.min(Math.ceil(Math.sqrt(tables.length)), 4);

  return (
    <div className="h-full overflow-auto p-6">
      <div
        className="grid gap-6"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(220px, 1fr))` }}
      >
        {tables.map((table, i) => {
          // Find relationships for this table
          const outgoing = relationships.filter((r) => r.from.toLowerCase() === table.name.toLowerCase());
          const incoming = relationships.filter((r) => r.to.toLowerCase() === table.name.toLowerCase());

          return (
            <div
              key={i}
              className="rounded-lg border border-border bg-card shadow-sm overflow-hidden"
            >
              {/* Table header */}
              <div className="px-3 py-2 bg-primary/10 border-b border-border flex items-center gap-2">
                <Table2 className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                <span className="text-xs font-semibold text-foreground truncate">{table.name}</span>
                <span className="text-[9px] text-muted-foreground ml-auto">{table.schemaName}</span>
              </div>

              {/* Columns */}
              <div className="divide-y divide-border/50">
                {table.columns.map((col, ci) => {
                  const isFK = outgoing.some((r) => r.fromCol.toLowerCase() === col.name.toLowerCase());
                  const isReferenced = incoming.some((r) => r.toCol.toLowerCase() === col.name.toLowerCase());

                  return (
                    <div
                      key={ci}
                      className="flex items-center gap-2 px-3 py-1 text-[11px] hover:bg-accent/30 transition-colors"
                    >
                      {col.isPrimaryKey ? (
                        <Key className="w-3 h-3 text-amber-500 flex-shrink-0" />
                      ) : isFK ? (
                        <Key className="w-3 h-3 text-blue-400 flex-shrink-0" />
                      ) : (
                        <Columns3 className="w-3 h-3 text-muted-foreground/30 flex-shrink-0" />
                      )}
                      <span className={`font-mono truncate ${col.isPrimaryKey ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                        {col.name}
                      </span>
                      {col.type && (
                        <span className="text-[9px] text-muted-foreground/50 ml-auto font-mono flex-shrink-0">
                          {col.type}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Relationships footer */}
              {(outgoing.length > 0 || incoming.length > 0) && (
                <div className="px-3 py-1.5 bg-muted/30 border-t border-border">
                  {outgoing.map((r, ri) => (
                    <p key={`o-${ri}`} className="text-[9px] text-blue-400 truncate">
                      {r.fromCol} → {r.to}.{r.toCol}
                    </p>
                  ))}
                  {incoming.map((r, ri) => (
                    <p key={`i-${ri}`} className="text-[9px] text-emerald-400 truncate">
                      ← {r.from}.{r.fromCol}
                    </p>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SchemaModule — original combined component (kept for backward compat)
// ---------------------------------------------------------------------------

export function SchemaModule() {
  const { data: schemas, isLoading } = useUserSchemas();

  const hasTables = useMemo(() => {
    if (!schemas) return false;
    return schemas.some(
      (s) => ((s.tables as Array<{ name: string; columns: string[] }>) || []).length > 0
    );
  }, [schemas]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // If we have tables, show ERD; otherwise show upload
  return hasTables ? <SchemaERD /> : <SchemaUpload />;
}
