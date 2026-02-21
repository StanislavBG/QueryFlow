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
  Bug,
  Copy,
  Check,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { UserSchema, ParsedTable, ParsedColumn } from "@shared/schema";

// ---------------------------------------------------------------------------
// Backward-compatibility normalizer for stored tables data.
// Old format: { name, columns: string[] }
// New format: { name, columns: Array<{name, type, isPrimaryKey}>, relationships? }
// This is NOT a parser — it just maps field shapes for old vs. new data.
// ---------------------------------------------------------------------------

export function normalizeTables(tables: unknown): ParsedTable[] {
  if (!Array.isArray(tables)) return [];
  return tables.map((t: any) => {
    if (!t || !t.name || !Array.isArray(t.columns)) {
      return { name: t?.name || "unknown", columns: [], relationships: [] };
    }
    // Old format: columns are plain strings
    if (t.columns.length > 0 && typeof t.columns[0] === "string") {
      return {
        name: t.name,
        columns: t.columns.map((c: string) => ({ name: c, type: "", isPrimaryKey: false })),
        relationships: [],
      };
    }
    // New format: columns are objects
    return {
      name: t.name,
      columns: t.columns.map((c: any) => ({
        name: c.name || "",
        type: c.type || "",
        isPrimaryKey: !!c.isPrimaryKey,
      })),
      relationships: Array.isArray(t.relationships)
        ? t.relationships.map((r: any) => ({
            fromCol: r.fromCol || "",
            toTable: r.toTable || "",
            toCol: r.toCol || "",
          }))
        : [],
    };
  });
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
            onSuccess: (schema) => {
              const tables = normalizeTables(schema.tables);
              const parseError = (schema as Record<string, unknown>).parseError as string | undefined;
              if (tables.length > 0) {
                toast({ title: "Schema added", description: `"${name}" — ${tables.length} table${tables.length === 1 ? "" : "s"} detected.` });
              } else {
                toast({ title: "Schema added — no tables detected", description: parseError || `"${name}" was saved but no tables could be parsed.`, variant: "destructive" });
              }
            },
            onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
          }
        );
      });
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

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
              const tables = normalizeTables(schema.tables);
              const isExpanded = expandedSchemas.has(schema.id);

              return (
                <div key={schema.id} className="mb-0.5">
                  {/* Schema node */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleSchema(schema.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleSchema(schema.id); }}
                    className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded text-left hover:bg-accent/50 group cursor-pointer"
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
                  </div>

                  {/* Tables under this schema */}
                  {isExpanded && tables.map((table, ti) => {
                    const tableKey = `${schema.id}-${ti}`;
                    const isTableExpanded = expandedTables.has(tableKey);

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
                          <span className="text-[9px] text-muted-foreground/50 ml-auto">{table.columns.length}</span>
                        </button>

                        {/* Columns under this table */}
                        {isTableExpanded && (
                          <div className="ml-5 border-l border-border/50 pl-2 py-0.5">
                            {table.columns.map((col, ci) => (
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
          onSuccess: (schema) => {
            const tables = normalizeTables(schema.tables);
            const parseError = (schema as Record<string, unknown>).parseError as string | undefined;
            if (tables.length > 0) {
              toast({ title: "Schema added", description: `"${name}" — ${tables.length} table${tables.length === 1 ? "" : "s"} detected.` });
            } else {
              toast({ title: "Schema added — no tables detected", description: parseError || `"${name}" was saved but no tables could be parsed.`, variant: "destructive" });
            }
            setSchemaName("");
            setSchemaDescription("");
          },
          onError: (err) => {
            toast({ title: "Upload failed", description: err.message, variant: "destructive" });
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
          onSuccess: (schema) => {
            const tables = normalizeTables(schema.tables);
            const parseError = (schema as Record<string, unknown>).parseError as string | undefined;
            if (tables.length > 0) {
              toast({ title: "Schema added", description: `"${name}" — ${tables.length} table${tables.length === 1 ? "" : "s"} detected.` });
            } else {
              toast({ title: "Schema added — no tables detected", description: parseError || `"${name}" was saved but no tables could be parsed.`, variant: "destructive" });
            }
            setSchemaName("");
            setSchemaDescription("");
          },
          onError: (err) => {
            toast({ title: "Paste failed", description: err.message, variant: "destructive" });
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
  columns: ParsedColumn[];
  schemaName: string;
}

interface ERDRelationship {
  from: string;
  fromCol: string;
  to: string;
  toCol: string;
}

export function SchemaERD() {
  const { data: schemas } = useUserSchemas();
  const [debugOpen, setDebugOpen] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const { tables, relationships, ddl } = useMemo(() => {
    if (!schemas) return { tables: [] as ERDTable[], relationships: [] as ERDRelationship[], ddl: "" };

    const allDdl = schemas.map((s) => s.parsedDdl || "").join("\n\n");

    const allTables: ERDTable[] = schemas.flatMap((s) => {
      const parsed = normalizeTables(s.tables);
      return parsed.map((t) => ({
        name: t.name,
        columns: t.columns,
        schemaName: s.name,
      }));
    });

    // Build relationships from LLM-detected data stored in each table
    const allRelationships: ERDRelationship[] = schemas.flatMap((s) => {
      const parsed = normalizeTables(s.tables);
      return parsed.flatMap((t) =>
        (t.relationships || []).map((r) => ({
          from: t.name,
          fromCol: r.fromCol,
          to: r.toTable,
          toCol: r.toCol,
        }))
      );
    });

    return { tables: allTables, relationships: allRelationships, ddl: allDdl };
  }, [schemas]);

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    });
  };

  if (tables.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
        <Table2 className="w-10 h-10 opacity-30" />
        <p className="text-sm font-medium">No tables detected</p>
        <p className="text-xs opacity-60 max-w-[280px] text-center">
          Schemas were uploaded but no tables could be parsed. Try uploading a DDL file with CREATE TABLE statements, or a MySQL DESCRIBE output.
        </p>
      </div>
    );
  }

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

      {/* Debug / Inspect Panel */}
      <div className="mt-6 border border-border rounded-lg bg-card overflow-hidden">
        <button
          onClick={() => setDebugOpen(!debugOpen)}
          className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-accent/30 transition-colors"
        >
          <Bug className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">Schema Debug Inspector</span>
          <span className="text-[9px] text-muted-foreground/50 ml-1">
            {schemas?.length || 0} schema{(schemas?.length || 0) !== 1 ? "s" : ""} · {tables.length} table{tables.length !== 1 ? "s" : ""} · {tables.reduce((s, t) => s + t.columns.length, 0)} columns
          </span>
          {debugOpen ? (
            <ChevronDown className="w-3 h-3 text-muted-foreground ml-auto" />
          ) : (
            <ChevronRight className="w-3 h-3 text-muted-foreground ml-auto" />
          )}
        </button>

        {debugOpen && schemas && (
          <div className="border-t border-border divide-y divide-border/50">
            {schemas.map((schema) => {
              const schemaTables = normalizeTables(schema.tables);
              const tablesJson = JSON.stringify(schemaTables, null, 2);
              const rawDdl = schema.parsedDdl || "(no DDL generated)";

              return (
                <div key={schema.id} className="p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Database className="w-3.5 h-3.5 text-primary" />
                    <span className="text-xs font-semibold">{schema.name}</span>
                    <Badge variant="outline" className="text-[9px] h-4">
                      {schemaTables.length} table{schemaTables.length !== 1 ? "s" : ""}
                    </Badge>
                  </div>

                  {/* Per-table column summary */}
                  <div className="space-y-1">
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Tables & Column Counts</p>
                    {schemaTables.length === 0 ? (
                      <p className="text-[10px] text-destructive">No tables were parsed from this schema input.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {schemaTables.map((t, ti) => {
                          const pkCount = t.columns.filter((c) => c.isPrimaryKey).length;
                          const hasTypes = t.columns.some((c) => c.type !== "");
                          return (
                            <Badge key={ti} variant="secondary" className="text-[9px] h-5 font-mono gap-1">
                              {t.name}
                              <span className="text-muted-foreground">
                                {t.columns.length}col{t.columns.length !== 1 ? "s" : ""}
                                {pkCount > 0 && ` · ${pkCount}pk`}
                                {!hasTypes && " · no types"}
                              </span>
                            </Badge>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Tables JSON */}
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">LLM Tables JSON</p>
                      <button
                        onClick={() => copyToClipboard(tablesJson, `json-${schema.id}`)}
                        className="p-0.5 rounded hover:bg-accent/50 transition-colors"
                        title="Copy JSON"
                      >
                        {copiedField === `json-${schema.id}` ? (
                          <Check className="w-3 h-3 text-emerald-500" />
                        ) : (
                          <Copy className="w-3 h-3 text-muted-foreground" />
                        )}
                      </button>
                    </div>
                    <pre className="text-[10px] font-mono bg-muted/50 rounded p-2 max-h-[200px] overflow-auto whitespace-pre-wrap text-muted-foreground">
                      {tablesJson}
                    </pre>
                  </div>

                  {/* Parsed DDL */}
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Generated DDL</p>
                      <button
                        onClick={() => copyToClipboard(rawDdl, `ddl-${schema.id}`)}
                        className="p-0.5 rounded hover:bg-accent/50 transition-colors"
                        title="Copy DDL"
                      >
                        {copiedField === `ddl-${schema.id}` ? (
                          <Check className="w-3 h-3 text-emerald-500" />
                        ) : (
                          <Copy className="w-3 h-3 text-muted-foreground" />
                        )}
                      </button>
                    </div>
                    <pre className="text-[10px] font-mono bg-muted/50 rounded p-2 max-h-[300px] overflow-auto whitespace-pre-wrap text-muted-foreground">
                      {rawDdl}
                    </pre>
                  </div>

                  {/* Raw content preview */}
                  {schema.rawContent && (
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Raw Input (first 500 chars)</p>
                        <button
                          onClick={() => copyToClipboard(schema.rawContent || "", `raw-${schema.id}`)}
                          className="p-0.5 rounded hover:bg-accent/50 transition-colors"
                          title="Copy raw input"
                        >
                          {copiedField === `raw-${schema.id}` ? (
                            <Check className="w-3 h-3 text-emerald-500" />
                          ) : (
                            <Copy className="w-3 h-3 text-muted-foreground" />
                          )}
                        </button>
                      </div>
                      <pre className="text-[10px] font-mono bg-muted/50 rounded p-2 max-h-[150px] overflow-auto whitespace-pre-wrap text-muted-foreground/70">
                        {schema.rawContent.slice(0, 500)}{schema.rawContent.length > 500 ? "…" : ""}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SchemaModule — original combined component (kept for backward compat)
// ---------------------------------------------------------------------------

export function SchemaModule() {
  const { data: schemas, isLoading } = useUserSchemas();

  const hasSchemas = !!schemas && schemas.length > 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // If schemas exist, show ERD (even if 0 tables parsed); otherwise show upload
  return hasSchemas ? <SchemaERD /> : <SchemaUpload />;
}
