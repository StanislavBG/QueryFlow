import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useUpdateSqlQuery } from "@/hooks/use-sql-queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Save, Loader2, Pencil, Check, AlertTriangle, Minus, Plus, Highlighter, Upload } from "lucide-react";
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
  highlightedLines?: Set<number>;
  onLineHover?: (lineNumber: number | null) => void;
  onCursorLineChange?: (lineNumber: number | null) => void;
  scrollToLine?: number | null;
}

const FONT_SIZE_STEPS = [12, 13, 14, 15, 16, 18, 20];
const DEFAULT_FONT_SIZE = 14;
const FONT_SIZE_STORAGE_KEY = "queryflow-editor-font-size";
const HIGHLIGHT_STORAGE_KEY = "queryflow-editor-highlights";

function getStoredFontSize(): number {
  try {
    const stored = localStorage.getItem(FONT_SIZE_STORAGE_KEY);
    if (stored) {
      const val = parseInt(stored, 10);
      if (FONT_SIZE_STEPS.includes(val)) return val;
    }
  } catch {}
  return DEFAULT_FONT_SIZE;
}

export function SqlEditor({ query, onContentChange, maxChars, modelName, highlightedLines, onLineHover, onCursorLineChange, scrollToLine }: SqlEditorProps) {
  // The editor always works with the latest version: draft if available, otherwise saved content
  const [content, setContent] = useState(query.draftContent ?? query.content);
  const [title, setTitle] = useState(query.title);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hoveredLineNum, setHoveredLineNum] = useState<number | null>(null);
  const [cursorLine, setCursorLine] = useState<number | null>(null);
  const [hoveredCodeLine, setHoveredCodeLine] = useState<number | null>(null);
  const [fontSize, setFontSize] = useState(getStoredFontSize);
  const [highlightsEnabled, setHighlightsEnabled] = useState(() => {
    try { return localStorage.getItem(HIGHLIGHT_STORAGE_KEY) !== "off"; } catch { return true; }
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const updateMutation = useUpdateSqlQuery();
  const { toast } = useToast();
  const draftTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const charCount = content.length;
  const isOverLimit = charCount > maxChars;
  const usagePercent = Math.min((charCount / maxChars) * 100, 100);
  const isNearLimit = usagePercent > 80;

  // Track whether current editor content differs from the last-saved version
  const hasDraft = content !== query.content;

  // Sync content when switching to a different query
  useEffect(() => {
    setContent(query.draftContent ?? query.content);
    setTitle(query.title);
  }, [query.id, query.content, query.title, query.draftContent]);

  // Auto-save draft with debounce (crash-recovery copy only)
  // Skip for virtual/demo queries (id <= 0)
  const debouncedDraftSave = useCallback(
    (newContent: string) => {
      if (query.id <= 0) return;
      if (draftTimeoutRef.current) {
        clearTimeout(draftTimeoutRef.current);
      }
      draftTimeoutRef.current = setTimeout(() => {
        updateMutation.mutate({ id: query.id, data: { draftContent: newContent } });
      }, 1500);
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
      debouncedDraftSave(truncated);
      toast({
        title: "Character limit reached",
        description: `Max ${formatCharCount(maxChars)} characters for ${modelName}. Content has been truncated.`,
        variant: "destructive",
      });
      return;
    }

    setContent(newContent);
    onContentChange(newContent);
    debouncedDraftSave(newContent);
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
      debouncedDraftSave(newContent);
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      });
    }
  };

  // Manual Save: persists content + title, clears draft
  // Skip for virtual/demo queries (id <= 0)
  const handleSave = () => {
    if (query.id <= 0) return;
    if (draftTimeoutRef.current) {
      clearTimeout(draftTimeoutRef.current);
    }
    setIsSaving(true);
    updateMutation.mutate(
      { id: query.id, data: { content, title, draftContent: null } },
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

  const handleTitleSave = () => {
    setIsEditingTitle(false);
    if (query.id > 0) {
      updateMutation.mutate({ id: query.id, data: { title } });
    }
  };

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      let text = ev.target?.result as string;
      if (text.length > maxChars) {
        text = text.slice(0, maxChars);
        toast({
          title: "File truncated",
          description: `File exceeded ${formatCharCount(maxChars)} character limit and was truncated.`,
          variant: "destructive",
        });
      }
      setContent(text);
      onContentChange(text);
      debouncedDraftSave(text);
      // Use filename (without extension) as title
      const name = file.name.replace(/\.[^.]+$/, "");
      if (name) {
        setTitle(name);
        if (query.id > 0) {
          updateMutation.mutate({ id: query.id, data: { title: name } });
        }
      }
      toast({ title: "File loaded", description: `Loaded ${file.name}` });
    };
    reader.onerror = () => {
      toast({ title: "Error", description: "Failed to read file.", variant: "destructive" });
    };
    reader.readAsText(file);
    // Reset input so the same file can be re-uploaded
    e.target.value = "";
  }, [maxChars, onContentChange, debouncedDraftSave, query.id, updateMutation, toast]);

  const lineHeight = Math.round(fontSize * 1.857);

  // Scroll-to-line: when triggered, scroll the editor so the target line
  // sits at approximately the top 25% of the visible area.
  const scrollToLineRef = useRef<number | null>(null);
  useEffect(() => {
    if (scrollToLine == null || scrollToLine === scrollToLineRef.current) return;
    scrollToLineRef.current = scrollToLine;
    const textarea = textareaRef.current;
    if (!textarea) return;
    const actualLine = Math.round(scrollToLine);
    const viewportHeight = textarea.clientHeight;
    const padding = 12; // py-3
    const targetOffset = padding + (actualLine - 1) * lineHeight;
    // Position at top 25% of visible area so analyst can read context before and after
    const scrollTarget = targetOffset - viewportHeight * 0.25;
    textarea.scrollTop = Math.max(0, scrollTarget);
    // Also sync highlight overlay
    if (highlightRef.current) {
      highlightRef.current.scrollTop = textarea.scrollTop;
    }
  }, [scrollToLine, lineHeight]);

  const changeFontSize = useCallback((direction: 1 | -1) => {
    setFontSize((prev) => {
      const idx = FONT_SIZE_STEPS.indexOf(prev);
      const nextIdx = idx + direction;
      if (nextIdx < 0 || nextIdx >= FONT_SIZE_STEPS.length) return prev;
      const next = FONT_SIZE_STEPS[nextIdx];
      try { localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(next)); } catch {}
      return next;
    });
  }, []);

  const toggleHighlights = useCallback(() => {
    setHighlightsEnabled((prev) => {
      const next = !prev;
      try { localStorage.setItem(HIGHLIGHT_STORAGE_KEY, next ? "on" : "off"); } catch {}
      return next;
    });
  }, []);

  const lineCount = content.split("\n").length;

  // Handle line hover for feedback linking
  const handleLineNumberHover = useCallback((lineNum: number | null) => {
    setHoveredLineNum(lineNum);
    onLineHover?.(highlightsEnabled ? lineNum : null);
  }, [onLineHover, highlightsEnabled]);

  // Track cursor (caret) line from textarea selection
  const updateCursorLine = useCallback(() => {
    if (!textareaRef.current) return;
    const pos = textareaRef.current.selectionStart;
    const line = content.substring(0, pos).split("\n").length;
    if (line !== cursorLine) {
      setCursorLine(line);
      onCursorLineChange?.(highlightsEnabled ? line : null);
    }
  }, [content, cursorLine, onCursorLineChange, highlightsEnabled]);

  // Track hover over code area (not just line numbers)
  const handleCodeMouseMove = useCallback((e: React.MouseEvent<HTMLTextAreaElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const scrollTop = e.currentTarget.scrollTop;
    const y = e.clientY - rect.top + scrollTop;
    const padding = 12; // py-3 = 0.75rem = 12px
    const line = Math.floor((y - padding) / lineHeight) + 1;
    if (line >= 1 && line <= lineCount) {
      setHoveredCodeLine(line);
    } else {
      setHoveredCodeLine(null);
    }
  }, [lineHeight, lineCount]);

  const handleCodeMouseLeave = useCallback(() => {
    setHoveredCodeLine(null);
  }, []);

  // Merge highlighted lines from feedback hover + locally hovered line
  const activeHighlightedLines = useMemo(() => {
    const lines = new Set(highlightedLines);
    return lines;
  }, [highlightedLines]);

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

          {/* Draft indicator */}
          {hasDraft && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/15 text-amber-500 border border-amber-500/20">
              Draft
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-mono text-muted-foreground">
            {lineCount} {lineCount === 1 ? "ln" : "lns"}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono ${
                isOverLimit
                  ? "bg-red-500/15 text-red-500"
                  : isNearLimit
                    ? "bg-amber-500/15 text-amber-500"
                    : "text-muted-foreground"
              }`}>
                {isOverLimit && <AlertTriangle className="w-2.5 h-2.5" />}
                <span>{formatCharCount(charCount)}</span>
                <span className="opacity-40">/</span>
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
          <div className="w-px h-3.5 bg-border mx-0.5" />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className={`p-1 rounded hover:bg-accent disabled:opacity-30 disabled:pointer-events-none transition-colors ${
                  hasDraft
                    ? "text-amber-500 hover:text-amber-400"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {isSaving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="text-xs">{hasDraft ? "Save query (unsaved changes)" : "Save query"}</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              >
                <Upload className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom"><p className="text-xs">Upload query from file</p></TooltipContent>
          </Tooltip>
          <input
            ref={fileInputRef}
            type="file"
            accept=".sql,.txt,.hql,.ddl,.dml,.pgsql,.plsql,.mysql"
            onChange={handleFileUpload}
            className="hidden"
          />
          <div className="w-px h-3.5 bg-border mx-0.5" />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={toggleHighlights}
                className={`p-1 rounded transition-colors ${
                  highlightsEnabled
                    ? "text-primary hover:bg-accent"
                    : "text-muted-foreground/40 hover:bg-accent hover:text-muted-foreground"
                }`}
              >
                <Highlighter className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom"><p className="text-xs">{highlightsEnabled ? "Disable line highlights" : "Enable line highlights"}</p></TooltipContent>
          </Tooltip>
          <div className="w-px h-3.5 bg-border mx-0.5" />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => changeFontSize(-1)}
                disabled={fontSize <= FONT_SIZE_STEPS[0]}
                className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom"><p className="text-xs">Decrease font size</p></TooltipContent>
          </Tooltip>
          <span className="text-[10px] font-mono text-muted-foreground w-6 text-center">{fontSize}</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => changeFontSize(1)}
                disabled={fontSize >= FONT_SIZE_STEPS[FONT_SIZE_STEPS.length - 1]}
                className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom"><p className="text-xs">Increase font size</p></TooltipContent>
          </Tooltip>
        </div>
      </div>


      {/* Editor area */}
      <div className="flex-1 relative overflow-hidden">
        <div className="absolute inset-0 flex">
          {/* Line numbers */}
          <div className="flex-shrink-0 bg-card border-r border-border select-none overflow-hidden">
            <div className="px-3 py-3 font-mono" style={{ fontSize: `${fontSize - 2}px`, lineHeight: `${lineHeight}px` }}>
              {Array.from({ length: Math.max(lineCount, 20) }, (_, i) => {
                const lineNum = i + 1;
                const isHighlighted = highlightsEnabled && activeHighlightedLines.has(lineNum);
                const isCursor = highlightsEnabled && cursorLine === lineNum;
                const isHovered = highlightsEnabled && (hoveredLineNum === lineNum || hoveredCodeLine === lineNum);
                return (
                  <div
                    key={i}
                    className={`text-right cursor-pointer transition-colors ${
                      isHighlighted
                        ? "text-primary font-bold bg-primary/10 -mx-3 px-3 rounded-sm"
                        : isCursor
                          ? "text-foreground font-semibold"
                          : isHovered
                            ? "text-foreground"
                            : "text-muted-foreground/40"
                    }`}
                    onMouseEnter={() => handleLineNumberHover(lineNum)}
                    onMouseLeave={() => handleLineNumberHover(null)}
                  >
                    {lineNum}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Code area with syntax highlighting overlay */}
          <div className="flex-1 relative overflow-hidden">
            {/* Line highlight layer (behind syntax, behind textarea) */}
            <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 0 }}>
              <div className="py-3 font-mono" style={{ fontSize: `${fontSize}px`, lineHeight: `${lineHeight}px` }}>
                {content.split("\n").map((_, i) => {
                  const lineNum = i + 1;
                  const isHighlighted = highlightsEnabled && activeHighlightedLines.has(lineNum);
                  const isCursor = highlightsEnabled && cursorLine === lineNum;
                  const isHovered = highlightsEnabled && (hoveredCodeLine === lineNum || hoveredLineNum === lineNum);
                  return (
                    <div
                      key={i}
                      style={{ height: `${lineHeight}px` }}
                      className={
                        isHighlighted
                          ? "bg-primary/10 border-l-2 border-primary"
                          : isCursor
                            ? "bg-foreground/[0.06]"
                            : isHovered
                              ? "bg-foreground/[0.03]"
                              : ""
                      }
                    />
                  );
                })}
              </div>
            </div>

            {/* Syntax highlight layer */}
            <div
              ref={highlightRef}
              className="absolute inset-0 px-4 py-3 font-mono whitespace-pre-wrap break-words overflow-hidden pointer-events-none"
              style={{ fontSize: `${fontSize}px`, lineHeight: `${lineHeight}px`, zIndex: 1 }}
              dangerouslySetInnerHTML={{ __html: highlightSQL(content) || '<span class="text-muted-foreground/30">Write your SQL query here...</span>' }}
            />
            {/* Textarea layer */}
            <textarea
              ref={textareaRef}
              value={content}
              onChange={handleContentChange}
              onScroll={handleScroll}
              onKeyDown={handleKeyDown}
              onClick={updateCursorLine}
              onSelect={updateCursorLine}
              onKeyUp={updateCursorLine}
              onMouseMove={handleCodeMouseMove}
              onMouseLeave={handleCodeMouseLeave}
              maxLength={maxChars}
              className="absolute inset-0 w-full h-full px-4 py-3 font-mono bg-transparent text-transparent caret-foreground resize-none outline-none selection:bg-primary/30 selection:text-transparent"
              style={{ fontSize: `${fontSize}px`, lineHeight: `${lineHeight}px`, zIndex: 2 }}
              spellCheck={false}
              placeholder="Write your SQL query here..."
            />
          </div>
        </div>
      </div>
    </div>
  );
}
