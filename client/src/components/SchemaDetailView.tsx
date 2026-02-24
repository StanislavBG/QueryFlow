import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { useUserSchemas, useSchemaVoiceContexts, useUpdateUserSchema, useAddTablesToSchema, useTranscribeAudio } from "@/hooks/use-sql-queries";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table2, Database, Key, Columns3, ChevronLeft, ArrowRight, Plus, Check, X, Pencil, Trash2, Upload, FileText, Loader2, Info, Mic, Square } from "lucide-react";
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
// MicRecordButton — inline mic for context editing sections
// ---------------------------------------------------------------------------

function MicRecordButton({ schemaId, onTranscript }: { schemaId: number; onTranscript: (text: string) => void }) {
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const transcribeMutation = useTranscribeAudio();
  const { toast } = useToast();

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.start(100);
      setRecording(true);
    } catch {
      toast({ title: "Microphone access denied", variant: "destructive" });
    }
  }, [toast]);

  const stopRecording = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        const b = new Blob(chunksRef.current, { type: "audio/webm" });
        recorder.stream.getTracks().forEach((t) => t.stop());
        resolve(b);
      };
      recorder.stop();
    });
    setRecording(false);
    if (blob.size === 0) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(",")[1];
      transcribeMutation.mutate(
        { schemaId, audio: base64 },
        {
          onSuccess: (data) => onTranscript(data.transcript),
          onError: () => toast({ title: "Transcription failed", variant: "destructive" }),
        }
      );
    };
    reader.readAsDataURL(blob);
  }, [schemaId, transcribeMutation, toast, onTranscript]);

  return (
    <>
      {recording ? (
        <Button size="sm" variant="destructive" className="h-6 text-[10px] gap-1" onClick={stopRecording}>
          <Square className="w-3 h-3" />
          Stop
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-[10px] gap-1"
          onClick={startRecording}
          disabled={transcribeMutation.isPending}
        >
          {transcribeMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Mic className="w-3 h-3" />}
          Record
        </Button>
      )}
      {recording && <span className="text-[10px] text-red-500 animate-pulse">Recording...</span>}
      {transcribeMutation.isPending && <span className="text-[10px] text-muted-foreground">Transcribing...</span>}
    </>
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
  const addTablesMutation = useAddTablesToSchema();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pasteContent, setPasteContent] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);

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

  const handleDeleteTable = useCallback((tableName: string) => {
    const filtered = tables.filter((t) => t.name !== tableName);
    updateMutation.mutate(
      { id: schema.id, data: { tables: filtered } },
      {
        onSuccess: () => toast({ title: "Table deleted", description: `"${tableName}" removed.` }),
        onError: () => toast({ title: "Failed to delete table", variant: "destructive" }),
      }
    );
  }, [schema.id, tables, updateMutation, toast]);

  const handleAddTablesFromContent = useCallback((rawContent: string, fileName?: string) => {
    if (!rawContent.trim()) return;
    addTablesMutation.mutate(
      { schemaId: schema.id, rawContent, fileName },
      {
        onSuccess: (result) => {
          const addedCount = result.added.length;
          const skippedCount = result.duplicatesSkipped.length;
          let desc = `${addedCount} table${addedCount !== 1 ? "s" : ""} added.`;
          if (skippedCount > 0) {
            desc += ` ${skippedCount} duplicate${skippedCount !== 1 ? "s" : ""} skipped.`;
          }
          toast({ title: "Tables added", description: desc });
          setPasteContent("");
        },
        onError: (err) => toast({ title: "Failed to add tables", description: err.message, variant: "destructive" }),
      }
    );
  }, [schema.id, addTablesMutation, toast]);

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      const file = files[0];
      file.text().then((content) => {
        handleAddTablesFromContent(content, file.name);
      });
    }
  }, [handleAddTablesFromContent]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      file.text().then((content) => {
        handleAddTablesFromContent(content, file.name);
      });
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [handleAddTablesFromContent]);

  const isAddingTables = addTablesMutation.isPending;

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
      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.min(Math.ceil(Math.sqrt(Math.max(tables.length, 1))), 3)}, minmax(200px, 1fr))` }}>
        {tables.map((table) => {
          const sorted = sortColumns(table.columns);
          return (
            <div
              key={table.name}
              className="rounded-lg border border-border bg-card shadow-sm overflow-hidden text-left hover:border-primary/50 hover:shadow-md transition-all group/card"
            >
              <div className="px-3 py-2 bg-primary/10 border-b border-border flex items-center gap-2">
                <Table2 className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                <button
                  onClick={() => onNavigate?.({ schemaId: schema.id, tableName: table.name })}
                  className="text-xs font-semibold text-foreground truncate flex-1 text-left hover:text-primary transition-colors"
                >
                  {table.name}
                </button>
                <Badge variant="secondary" className="text-[9px] h-4">{table.columns.length} cols</Badge>
                <button
                  onClick={() => handleDeleteTable(table.name)}
                  disabled={updateMutation.isPending}
                  className="p-0.5 rounded opacity-0 group-hover/card:opacity-100 hover:bg-destructive/20 transition-all disabled:opacity-50"
                  title={`Delete table ${table.name}`}
                >
                  <Trash2 className="w-3 h-3 text-destructive" />
                </button>
              </div>
              <button
                onClick={() => onNavigate?.({ schemaId: schema.id, tableName: table.name })}
                className="w-full p-2 text-left"
              >
                {table.context && (
                  <div className="flex items-start gap-1.5 text-[10px] py-1 mb-1 border-b border-dashed border-violet-500/20">
                    <Info className="w-2.5 h-2.5 text-violet-400 flex-shrink-0 mt-0.5" />
                    <span className="text-violet-400/80 italic line-clamp-2">{table.context}</span>
                  </div>
                )}
                {sorted.slice(0, 5).map((col) => (
                  <div key={col.name} className="flex items-center gap-1.5 text-[10px] py-[1px]">
                    {col.isPrimaryKey ? (
                      <Key className="w-2.5 h-2.5 text-amber-500 flex-shrink-0" />
                    ) : (
                      <Columns3 className="w-2.5 h-2.5 text-muted-foreground/30 flex-shrink-0" />
                    )}
                    <span className="font-mono text-muted-foreground truncate">{col.name}</span>
                    {col.context && (
                      <Info className="w-2 h-2 text-violet-400/60 flex-shrink-0" />
                    )}
                    {col.type && (
                      <span className="text-[9px] text-muted-foreground/40 ml-auto font-mono">{col.type}</span>
                    )}
                  </div>
                ))}
                {table.columns.length > 5 && (
                  <p className="text-[9px] text-muted-foreground/50 mt-1">+{table.columns.length - 5} more...</p>
                )}
              </button>
            </div>
          );
        })}

      </div>

      {/* Smart Add Table widget — always visible at bottom */}
      <div className="rounded-lg border-2 border-dashed border-primary/30 bg-card shadow-sm overflow-hidden">
        <div className="px-3 py-2 bg-primary/5 border-b border-border flex items-center gap-2">
          <Plus className="w-3.5 h-3.5 text-primary flex-shrink-0" />
          <span className="text-xs font-semibold text-foreground flex-1">Add Tables</span>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-[11px] text-muted-foreground">
            Paste DDL, DESCRIBE output, or any table definition text. You can also drop a file.
          </p>

          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleFileDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
              isDragOver
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50"
            }`}
          >
            <Upload className="w-5 h-5 mx-auto mb-1.5 text-muted-foreground/50" />
            <p className="text-[11px] text-muted-foreground">Drop a file or click to upload</p>
            <p className="text-[10px] text-muted-foreground/50 mt-0.5">SQL DDL, CSV, JSON, or text</p>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".sql,.txt,.csv,.json,.ddl,.tsv"
            onChange={handleFileSelect}
            className="hidden"
          />

          {/* Paste area */}
          <Textarea
            value={pasteContent}
            onChange={(e) => setPasteContent(e.target.value)}
            placeholder="Paste table definitions here (CREATE TABLE, DESCRIBE output, etc.)"
            className="text-xs min-h-[80px] max-h-[200px] font-mono"
          />

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="h-7 text-xs"
              disabled={!pasteContent.trim() || isAddingTables}
              onClick={() => handleAddTablesFromContent(pasteContent)}
            >
              {isAddingTables ? (
                <>
                  <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                  Parsing...
                </>
              ) : (
                <>
                  <Plus className="w-3 h-3 mr-1.5" />
                  Parse & Add Tables
                </>
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={isAddingTables}
              onClick={() => {
                navigator.clipboard.readText().then((text) => {
                  if (text.trim()) {
                    setPasteContent(text);
                  } else {
                    toast({ title: "Clipboard empty", variant: "destructive" });
                  }
                }).catch(() => {
                  toast({ title: "Clipboard access denied", description: "Allow clipboard access to paste.", variant: "destructive" });
                });
              }}
            >
              <FileText className="w-3 h-3 mr-1.5" />
              Paste from clipboard
            </Button>
          </div>
        </div>
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
  const [isEditingTableContext, setIsEditingTableContext] = useState(false);
  const [editTableContext, setEditTableContext] = useState(table.context ?? "");

  // Sync edit state when table changes externally
  useEffect(() => { setEditTableName(table.name); }, [table.name]);
  useEffect(() => { setEditTableContext(table.context ?? ""); }, [table.context]);

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

  const handleSaveTableContext = useCallback(() => {
    const trimmed = editTableContext.trim();
    if (trimmed === (table.context ?? "")) {
      setIsEditingTableContext(false);
      return;
    }
    const updatedTables = allTables.map((t) =>
      t.name === table.name ? { ...t, context: trimmed || undefined } : t
    );
    updateMutation.mutate(
      { id: schema.id, data: { tables: updatedTables } },
      {
        onSuccess: () => {
          setIsEditingTableContext(false);
          toast({ title: "Table context updated" });
        },
        onError: () => toast({ title: "Failed to update context", variant: "destructive" }),
      }
    );
  }, [editTableContext, table.context, table.name, allTables, schema.id, updateMutation, toast]);

  const handleSaveColumnContext = useCallback((colName: string, newContext: string) => {
    const trimmed = newContext.trim();
    const updatedTables = allTables.map((t) =>
      t.name === table.name
        ? {
            ...t,
            columns: t.columns.map((c) =>
              c.name === colName ? { ...c, context: trimmed || undefined } : c
            ),
          }
        : t
    );
    updateMutation.mutate(
      { id: schema.id, data: { tables: updatedTables } },
      {
        onSuccess: () => toast({ title: "Column context updated" }),
        onError: () => toast({ title: "Failed to update context", variant: "destructive" }),
      }
    );
  }, [table.name, allTables, schema.id, updateMutation, toast]);

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

      {/* Table context — system metadata */}
      <div className="rounded-lg border border-dashed border-violet-500/30 bg-violet-500/5 overflow-hidden">
        <div className="px-3 py-1.5 border-b border-violet-500/20 flex items-center gap-2">
          <Info className="w-3 h-3 text-violet-400 flex-shrink-0" />
          <p className="text-[10px] font-semibold text-violet-400 uppercase tracking-wider flex-1">Table Context</p>
          <Badge variant="outline" className="text-[8px] h-4 border-violet-500/30 text-violet-400">system</Badge>
        </div>
        {isEditingTableContext ? (
          <div className="p-3 space-y-2">
            <Textarea
              value={editTableContext}
              onChange={(e) => setEditTableContext(e.target.value)}
              placeholder="Describe this table's business purpose, what it stores, how it relates to other tables..."
              className="text-xs min-h-[60px] max-h-[150px] border-violet-500/20 focus-visible:ring-violet-500/30"
              autoFocus
            />
            <div className="flex items-center gap-1.5 flex-wrap">
              <Button size="sm" className="h-6 text-[10px] gap-1 bg-violet-600 hover:bg-violet-700" onClick={handleSaveTableContext} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                Save
              </Button>
              <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => { setIsEditingTableContext(false); setEditTableContext(table.context ?? ""); }}>
                Cancel
              </Button>
              <MicRecordButton schemaId={schema.id} onTranscript={(text) => setEditTableContext((prev) => prev ? prev + "\n" + text : text)} />
            </div>
          </div>
        ) : (
          <button
            onClick={() => setIsEditingTableContext(true)}
            className="w-full p-3 text-left hover:bg-violet-500/5 transition-colors group/ctx"
          >
            {table.context ? (
              <div className="flex items-start gap-2">
                <p className="text-xs text-violet-300/80 italic flex-1">{table.context}</p>
                <Pencil className="w-3 h-3 text-violet-400/50 opacity-0 group-hover/ctx:opacity-100 transition-opacity flex-shrink-0 mt-0.5" />
              </div>
            ) : (
              <p className="text-[11px] text-violet-400/40 italic">Click to add table context...</p>
            )}
          </button>
        )}
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
              <div key={col.name} className="group/col">
                <div
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
                  {col.context && (
                    <Info className="w-3 h-3 text-violet-400/60 flex-shrink-0" />
                  )}
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
                {col.context && (
                  <div className="px-3 pb-2 pl-10 flex items-start gap-1.5">
                    <Info className="w-2.5 h-2.5 text-violet-400/40 flex-shrink-0 mt-0.5" />
                    <p className="text-[10px] text-violet-400/60 italic line-clamp-2">{col.context}</p>
                  </div>
                )}
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
  allTables,
  voiceContexts,
  onNavigate,
}: {
  schema: { id: number; name: string };
  table: ParsedTable;
  column: ParsedColumn;
  allTables: ParsedTable[];
  voiceContexts?: SchemaVoiceContext[];
  onNavigate?: (selection: SchemaSelection | null) => void;
}) {
  const outgoing = (table.relationships || []).filter(
    (r) => r.fromCol.toLowerCase() === column.name.toLowerCase()
  );

  const updateMutation = useUpdateUserSchema();
  const { toast } = useToast();
  const [isEditingContext, setIsEditingContext] = useState(false);
  const [editContext, setEditContext] = useState(column.context ?? "");

  useEffect(() => { setEditContext(column.context ?? ""); }, [column.context]);

  const handleSaveContext = useCallback(() => {
    const trimmed = editContext.trim();
    if (trimmed === (column.context ?? "")) {
      setIsEditingContext(false);
      return;
    }
    const updatedTables = allTables.map((t) =>
      t.name === table.name
        ? {
            ...t,
            columns: t.columns.map((c) =>
              c.name === column.name ? { ...c, context: trimmed || undefined } : c
            ),
          }
        : t
    );
    updateMutation.mutate(
      { id: schema.id, data: { tables: updatedTables } },
      {
        onSuccess: () => {
          setIsEditingContext(false);
          toast({ title: "Column context updated" });
        },
        onError: () => toast({ title: "Failed to update context", variant: "destructive" }),
      }
    );
  }, [editContext, column.context, column.name, table.name, allTables, schema.id, updateMutation, toast]);

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

      {/* Column context — system metadata */}
      <div className="rounded-lg border border-dashed border-violet-500/30 bg-violet-500/5 overflow-hidden">
        <div className="px-3 py-1.5 border-b border-violet-500/20 flex items-center gap-2">
          <Info className="w-3 h-3 text-violet-400 flex-shrink-0" />
          <p className="text-[10px] font-semibold text-violet-400 uppercase tracking-wider flex-1">Column Context</p>
          <Badge variant="outline" className="text-[8px] h-4 border-violet-500/30 text-violet-400">system</Badge>
        </div>
        {isEditingContext ? (
          <div className="p-3 space-y-2">
            <Textarea
              value={editContext}
              onChange={(e) => setEditContext(e.target.value)}
              placeholder="Describe this column's meaning, valid values, business logic..."
              className="text-xs min-h-[60px] max-h-[150px] border-violet-500/20 focus-visible:ring-violet-500/30"
              autoFocus
            />
            <div className="flex items-center gap-1.5 flex-wrap">
              <Button size="sm" className="h-6 text-[10px] gap-1 bg-violet-600 hover:bg-violet-700" onClick={handleSaveContext} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                Save
              </Button>
              <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => { setIsEditingContext(false); setEditContext(column.context ?? ""); }}>
                Cancel
              </Button>
              <MicRecordButton schemaId={schema.id} onTranscript={(text) => setEditContext((prev) => prev ? prev + "\n" + text : text)} />
            </div>
          </div>
        ) : (
          <button
            onClick={() => setIsEditingContext(true)}
            className="w-full p-3 text-left hover:bg-violet-500/5 transition-colors group/ctx"
          >
            {column.context ? (
              <div className="flex items-start gap-2">
                <p className="text-xs text-violet-300/80 italic flex-1">{column.context}</p>
                <Pencil className="w-3 h-3 text-violet-400/50 opacity-0 group-hover/ctx:opacity-100 transition-opacity flex-shrink-0 mt-0.5" />
              </div>
            ) : (
              <p className="text-[11px] text-violet-400/40 italic">Click to add column context...</p>
            )}
          </button>
        )}
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
          allTables={tables}
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
