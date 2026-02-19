import { useState, useEffect, useRef, useCallback } from "react";
import { useUpdateSqlQuery, useFormatQuery } from "@/hooks/use-sql-queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Wand2, Save, Loader2, Pencil, Check, AlertTriangle } from "lucide-react";
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

function formatCharCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

interface SqlEditorProps {
  query: SqlQuery;
  onContentChange: (content: string) => void;
  maxChars: number;
  modelName: string;
}

export function SqlEditor({ query, onContentChange, maxChars, modelName }: SqlEditorProps) {
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

  const charCount = content.length;
  const isOverLimit = charCount > maxChars;
  const usagePercent = Math.min((charCount / maxChars) * 100, 100);
  const isNearLimit = usagePercent > 80;

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

    // Enforce hard limit: truncate beyond maxChars
    if (newContent.length > maxChars) {
      const truncated = newContent.slice(0, maxChars);
      setContent(truncated);
      onContentChange(truncated);
      debouncedSave(truncated);
      toast({
        title: "Character limit reached",
        description: `Max ${formatCharCount(maxChars)} characters for ${modelName}. Content has been truncated.`,
        variant: "destructive",
      });
      return;
    }

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
    if (e.key === "Tab") {
      e.preventDefault();
      const textarea = textareaRef.current;
      if (!textarea) return;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newContent = content.substring(0, start) + "  " + content.substring(end);

      if (newContent.length > maxChars) return;

      setContent(newContent);
      onContentChange(newContent);
      debouncedSave(newContent);
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
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {isEditingTitle ? (
            <div className="flex items-center gap-1">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleTitleSave()}
                onBlur={handleTitleSave}
                className="h-7 text-sm w-48"
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
          {/* Character count / limit indicator */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono border ${
                isOverLimit
                  ? "border-red-500/30 bg-red-500/10 text-red-400"
                  : isNearLimit
                    ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                    : "border-border text-muted-foreground"
              }`}>
                {isOverLimit && <AlertTriangle className="w-3 h-3" />}
                <span>{formatCharCount(charCount)}</span>
                <span className="text-muted-foreground/50">/</span>
                <span>{formatCharCount(maxChars)}</span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="text-xs">
                {charCount.toLocaleString()} / {maxChars.toLocaleString()} chars
                {isOverLimit
                  ? ` — over limit for ${modelName}`
                  : ` — max for ${modelName}`}
              </p>
            </TooltipContent>
          </Tooltip>

          <Button
            size="sm"
            variant="outline"
            onClick={handleFormat}
            disabled={formatMutation.isPending || !content.trim()}
            className="h-7 text-xs"
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
            className="h-7 text-xs"
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

      {/* Character limit progress bar */}
      <div className="h-0.5 bg-muted">
        <div
          className={`h-full transition-all duration-300 ${
            isOverLimit
              ? "bg-red-500"
              : isNearLimit
                ? "bg-amber-500"
                : "bg-primary/40"
          }`}
          style={{ width: `${Math.min(usagePercent, 100)}%` }}
        />
      </div>

      {/* Editor area */}
      <div className="flex-1 relative overflow-hidden">
        <div className="absolute inset-0 flex">
          {/* Line numbers */}
          <div className="flex-shrink-0 bg-card border-r border-border select-none overflow-hidden">
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
              maxLength={maxChars}
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
