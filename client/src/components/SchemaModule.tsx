import { useState, useRef, useCallback } from "react";
import { useUserSchemas, useCreateUserSchema, useDeleteUserSchema } from "@/hooks/use-sql-queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { UserSchema } from "@shared/schema";

function SchemaCard({
  schema,
  onDelete,
}: {
  schema: UserSchema;
  onDelete: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const tables = (schema.tables as Array<{ name: string; columns: string[] }>) || [];

  return (
    <div className="rounded-md border border-border bg-muted/30">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-start gap-2 p-2.5 text-left group"
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 mt-0.5 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 mt-0.5 text-muted-foreground flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Database className="w-3.5 h-3.5 text-primary flex-shrink-0" />
            <span className="text-xs font-medium truncate">{schema.name}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {tables.length > 0 && (
              <Badge variant="outline" className="text-[10px] h-4">
                <Table2 className="w-2.5 h-2.5 mr-1" />
                {tables.length} table{tables.length !== 1 ? "s" : ""}
              </Badge>
            )}
            {schema.fileName && (
              <span className="text-[10px] text-muted-foreground truncate">
                {schema.fileName}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(schema.id);
          }}
          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-destructive/20 rounded"
        >
          <Trash2 className="w-3 h-3 text-destructive" />
        </button>
      </button>

      {expanded && (
        <div className="px-2.5 pb-2.5 space-y-2">
          {/* Tables list */}
          {tables.length > 0 && (
            <div className="space-y-1.5">
              {tables.map((table, i) => (
                <div key={i} className="rounded bg-background border border-border p-2">
                  <p className="text-[10px] font-semibold text-primary mb-1">{table.name}</p>
                  <div className="flex flex-wrap gap-1">
                    {table.columns.map((col, j) => (
                      <Badge key={j} variant="outline" className="text-[10px] h-4 font-mono">
                        {col}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* DDL preview */}
          {schema.parsedDdl && (
            <div className="rounded bg-background border border-border p-2 max-h-[150px] overflow-auto">
              <pre className="text-[10px] font-mono text-muted-foreground whitespace-pre-wrap">
                {schema.parsedDdl.substring(0, 1000)}{schema.parsedDdl.length > 1000 ? "..." : ""}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SchemaModule() {
  const { data: schemas, isLoading } = useUserSchemas();
  const createMutation = useCreateUserSchema();
  const deleteMutation = useDeleteUserSchema();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [schemaName, setSchemaName] = useState("");

  const processFile = useCallback(
    async (file: File) => {
      const content = await file.text();
      const name = schemaName.trim() || file.name.replace(/\.[^.]+$/, "");

      createMutation.mutate(
        { name, rawContent: content, fileName: file.name },
        {
          onSuccess: () => {
            toast({ title: "Schema added", description: `"${name}" has been parsed and added.` });
            setSchemaName("");
          },
          onError: (err) => {
            toast({ title: "Error", description: err.message, variant: "destructive" });
          },
        }
      );
    },
    [schemaName, createMutation, toast]
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
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handlePaste = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      const name = schemaName.trim() || "Pasted Schema";
      createMutation.mutate(
        { name, rawContent: text },
        {
          onSuccess: () => {
            toast({ title: "Schema added", description: `"${name}" has been parsed and added.` });
            setSchemaName("");
          },
          onError: (err) => {
            toast({ title: "Error", description: err.message, variant: "destructive" });
          },
        }
      );
    },
    [schemaName, createMutation, toast]
  );

  const handleDelete = (id: number) => {
    deleteMutation.mutate(id, {
      onSuccess: () => toast({ title: "Schema removed" }),
    });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border space-y-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Schemas</h3>

        {/* Name input */}
        <Input
          value={schemaName}
          onChange={(e) => setSchemaName(e.target.value)}
          placeholder="Schema name (optional)"
          className="h-7 text-xs"
        />

        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-md p-3 text-center cursor-pointer transition-colors ${
            isDragOver
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50"
          }`}
        >
          <Upload className="w-4 h-4 mx-auto mb-1 text-muted-foreground" />
          <p className="text-[10px] text-muted-foreground">
            Drop a file or click to upload
          </p>
          <p className="text-[10px] text-muted-foreground/60">
            SQL DDL, CSV, JSON, or text
          </p>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".sql,.txt,.csv,.json,.ddl,.tsv"
          onChange={handleFileSelect}
          className="hidden"
        />

        {/* Paste option */}
        <Button
          size="sm"
          variant="outline"
          className="w-full h-7 text-xs"
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
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" />
            Parsing schema...
          </div>
        )}
      </div>

      {/* Schema list */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1.5">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : !schemas || schemas.length === 0 ? (
            <div className="text-center py-6 px-3">
              <Database className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground">No schemas added yet</p>
              <p className="text-[10px] text-muted-foreground/60 mt-1">
                Drop schema files to enable validation
              </p>
            </div>
          ) : (
            schemas.map((schema) => (
              <SchemaCard key={schema.id} schema={schema} onDelete={handleDelete} />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
