import { useState, useEffect, useRef, useCallback } from "react";
import { useUpdateSqlQuery, useFormatQuery } from "@/hooks/use-sql-queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Wand2, Save, Loader2, Pencil, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { SqlQuery } from "@shared/schema";

// SQL keywords for syntax highlighting
const SQL_KEYWORDS = new Set([
  "SELECT", "FROM", "WHERE", "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "OUTER",
  "CROSS", "ON", "AND", "OR", "NOT", "IN", "EXISTS", "BETWEEN", "LIKE", "IS",
  "NULL", "ORDER", "BY", "GROUP", "HAVING", "LIMIT", "OFFSET", "UNION", "ALL",
  "INTERSECT", "EXCEPT", "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE",
  "CREATE", "TABLE", "ALTER", "DROP", "INDEX", "AS", "DISTINCT", "COUNT", "SUM",
  "AVG", "MIN", "MAX", "CASE", "WHEN", "THEN", "ELSE", "END", "WITH",
  "OVER", "PARTITION", "ROW_NUMBER", "RANK", "DENSE_RANK", "COALESCE", "NULLIF",
  "CAST", "CONVERT", "TOP", "BEGIN", "COMMIT", "ROLLBACK", "DECLARE", "EXEC",
  "EXECUTE", "PROCEDURE", "FUNCTION", "RETURNS", "RETURN", "IF", "WHILE",
  "ASC", "DESC", "PRIMARY", "KEY", "FOREIGN", "REFERENCES", "CONSTRAINT",
  "UNIQUE", "DEFAULT", "CHECK", "SERIAL", "BIGINT", "INT", "INTEGER",
  "VARCHAR", "TEXT", "BOOLEAN", "TIMESTAMP", "DATE", "TIME", "FLOAT",
  "DECIMAL", "NUMERIC", "OUTPUT", "CURSOR", "FETCH", "OPEN", "CLOSE",
]);

function highlightSQL(sql: string): string {
  // Escape HTML
  let result = sql
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Highlight strings
  result = result.replace(/'([^']*)'/g, '<span class="sql-string">\'$1\'</span>');

  // Highlight comments (single-line)
  result = result.replace(/(--[^\n]*)/g, '<span class="sql-comment">$1</span>');

  // Highlight comments (multi-line)
  result = result.replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="sql-comment">$1</span>');

  // Highlight numbers
  result = result.replace(/\b(\d+\.?\d*)\b/g, '<span class="sql-number">$1</span>');

  // Highlight keywords
  result = result.replace(/\b([A-Za-z_]\w*)\b/g, (match) => {
    if (SQL_KEYWORDS.has(match.toUpperCase())) {
      return `<span class="sql-keyword">${match}</span>`;
    }
    return match;
  });

  return result;
}

interface SqlEditorProps {
  query: SqlQuery;
  onContentChange: (content: string) => void;
}

export function SqlEditor({ query, onContentChange }: SqlEditorProps) {
  const [content, setContent] = useState(query.content);
  const [title, setTitle] = useState(query.title);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const updateMutation = useUpdateSqlQuery();
  const formatMutation = useFormatQuery();
  const { toast } = useToast();
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync content when query changes
  useEffect(() => {
    setContent(query.content);
    setTitle(query.title);
  }, [query.id, query.content, query.title]);

  // Auto-save with debounce
  const debouncedSave = useCallback(
    (newContent: string) => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = setTimeout(() => {
        updateMutation.mutate({ id: query.id, data: { content: newContent } });
      }, 1000);
    },
    [query.id, updateMutation]
  );

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    setContent(newContent);
    onContentChange(newContent);
    debouncedSave(newContent);
  };

  const handleScroll = () => {
    if (textareaRef.current && highlightRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop;
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Tab key inserts spaces
    if (e.key === "Tab") {
      e.preventDefault();
      const textarea = textareaRef.current;
      if (!textarea) return;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newContent = content.substring(0, start) + "  " + content.substring(end);
      setContent(newContent);
      onContentChange(newContent);
      debouncedSave(newContent);
      // Set cursor position after inserted tab
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      });
    }
  };

  const handleSave = () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    setIsSaving(true);
    updateMutation.mutate(
      { id: query.id, data: { content, title } },
      {
        onSuccess: () => {
          setIsSaving(false);
          toast({ title: "Saved", description: "Query saved successfully." });
        },
        onError: () => {
          setIsSaving(false);
          toast({ title: "Error", description: "Failed to save query.", variant: "destructive" });
        },
      }
    );
  };

  const handleFormat = () => {
    formatMutation.mutate(content, {
      onSuccess: (result) => {
        setContent(result.formatted);
        onContentChange(result.formatted);
        updateMutation.mutate({ id: query.id, data: { content: result.formatted, formattedContent: result.formatted } });
        toast({ title: "Formatted", description: "Query formatted successfully." });
      },
      onError: (error) => {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      },
    });
  };

  const handleTitleSave = () => {
    setIsEditingTitle(false);
    updateMutation.mutate({ id: query.id, data: { title } });
  };

  const lineCount = content.split("\n").length;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-card/30">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {isEditingTitle ? (
            <div className="flex items-center gap-1">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleTitleSave()}
                onBlur={handleTitleSave}
                className="h-7 text-sm bg-secondary/50 border-primary/30 w-48"
                autoFocus
              />
              <Button size="sm" variant="ghost" onClick={handleTitleSave} className="h-7 w-7 p-0">
                <Check className="w-3 h-3" />
              </Button>
            </div>
          ) : (
            <button
              onClick={() => setIsEditingTitle(true)}
              className="flex items-center gap-1.5 text-sm font-medium hover:text-primary transition-colors group"
            >
              <span className="truncate max-w-[200px]">{title}</span>
              <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          )}
          <span className="text-[10px] text-muted-foreground ml-2">
            {lineCount} lines
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleFormat}
            disabled={formatMutation.isPending || !content.trim()}
            className="h-7 text-xs border-white/10 hover:bg-primary/10 hover:border-primary/30"
          >
            {formatMutation.isPending ? (
              <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
            ) : (
              <Wand2 className="w-3 h-3 mr-1.5" />
            )}
            Format
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={isSaving}
            className="h-7 text-xs bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30"
          >
            {isSaving ? (
              <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
            ) : (
              <Save className="w-3 h-3 mr-1.5" />
            )}
            Save
          </Button>
        </div>
      </div>

      {/* Editor area */}
      <div className="flex-1 relative overflow-hidden">
        <div className="absolute inset-0 flex">
          {/* Line numbers */}
          <div className="flex-shrink-0 bg-card/50 border-r border-white/5 select-none overflow-hidden">
            <div className="px-3 py-3 font-mono text-xs leading-[1.625rem]">
              {Array.from({ length: Math.max(lineCount, 20) }, (_, i) => (
                <div key={i} className="text-muted-foreground/40 text-right">
                  {i + 1}
                </div>
              ))}
            </div>
          </div>

          {/* Code area with syntax highlighting overlay */}
          <div className="flex-1 relative overflow-hidden">
            {/* Syntax highlight layer */}
            <div
              ref={highlightRef}
              className="absolute inset-0 px-4 py-3 font-mono text-sm leading-[1.625rem] whitespace-pre-wrap break-words overflow-hidden pointer-events-none"
              dangerouslySetInnerHTML={{ __html: highlightSQL(content) || '<span class="text-muted-foreground/30">Write your SQL query here...</span>' }}
            />
            {/* Textarea layer */}
            <textarea
              ref={textareaRef}
              value={content}
              onChange={handleContentChange}
              onScroll={handleScroll}
              onKeyDown={handleKeyDown}
              className="absolute inset-0 w-full h-full px-4 py-3 font-mono text-sm leading-[1.625rem] bg-transparent text-transparent caret-foreground resize-none outline-none selection:bg-primary/30 selection:text-transparent"
              spellCheck={false}
              placeholder="Write your SQL query here..."
            />
          </div>
        </div>
      </div>
    </div>
  );
}
