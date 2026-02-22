import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useSqlQuery, useSqlQueries, useCreateSqlQuery, useUserSchemas, useSchemaVoiceContexts, useUpsertSchemaVoiceContext, useDemoBootstrap, type DemoBootstrapResult } from "@/hooks/use-sql-queries";
import type { SqlQuery, SchemaVoiceContext } from "@shared/schema";
import { QueryDocumentList } from "@/components/QueryDocumentList";
import { SqlEditor } from "@/components/SqlEditor";
import { FeedbackPanel } from "@/components/FeedbackPanel";
import { SettingsDialog } from "@/components/SettingsDialog";
import { ContextPlanDialog } from "@/components/ContextPlanDialog";
import { AskModule } from "@/components/AskModule";
import { QueryOnboarding } from "@/components/QueryOnboarding";
import { SchemaTreePanel, normalizeTables } from "@/components/SchemaModule";
import type { SchemaSelection } from "@/components/SchemaModule";
import { SchemaDetailView } from "@/components/SchemaDetailView";
import { VisualExplorer } from "@/components/VisualExplorer";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FileCode2, Loader2, Database, Sun, Moon, MessageSquare, Table2, GitBranch, Plus, X, Boxes, Shield, Play, Sparkles, AlertCircle, Mic, Key, Columns3 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

import { SignedIn, SignedOut, SignInButton, UserButton, useAuth } from "@clerk/clerk-react";
import { useCurrentUser } from "@/hooks/use-admin";
import { useLocation } from "wouter";
import {
  MODEL,
  detectSqlDialect,
  DIALECT_META,
  type SqlDialect,
} from "@/lib/models";

// ---------------------------------------------------------------------------
// Workspace tab types
// ---------------------------------------------------------------------------

type WorkspaceTabType = "query" | "schemas" | "visual";

interface WorkspaceTab {
  id: string;
  type: WorkspaceTabType;
  title: string;
  queryId?: number; // only for query tabs
}

let _nextTabId = 1;
function newTabId(): string {
  return `tab-${_nextTabId++}`;
}

const TAB_ICON: Record<WorkspaceTabType, React.ElementType> = {
  query: FileCode2,
  schemas: Table2,
  visual: Boxes,
};

// ---------------------------------------------------------------------------
// Schema Context Panel — right sidebar for schemas tab
// ---------------------------------------------------------------------------

function SchemaContextPanel({ selection }: { selection: SchemaSelection | null }) {
  const { data: schemas } = useUserSchemas();
  const { data: voiceContexts } = useSchemaVoiceContexts(selection?.schemaId ?? null);
  const upsertMutation = useUpsertSchemaVoiceContext();
  const { toast } = useToast();
  const [editTranscript, setEditTranscript] = useState("");
  const [editTarget, setEditTarget] = useState<{
    type: "schema" | "table" | "column";
    table?: string | null;
    column?: string | null;
  } | null>(null);

  // Determine what context to show based on selection
  const contextInfo = useMemo(() => {
    if (!selection?.schemaId || !schemas) return null;
    const schema = schemas.find((s) => s.id === selection.schemaId);
    if (!schema) return null;

    const tables = normalizeTables(schema.tables);

    if (selection.columnName && selection.tableName) {
      const table = tables.find((t) => t.name === selection.tableName);
      const column = table?.columns.find((c) => c.name === selection.columnName);
      return {
        level: "column" as const,
        label: `${selection.tableName}.${selection.columnName}`,
        icon: column?.isPrimaryKey ? "pk" : "col",
        type: column?.type || "",
        targetType: "column" as const,
        targetTable: selection.tableName,
        targetColumn: selection.columnName,
      };
    }

    if (selection.tableName) {
      const table = tables.find((t) => t.name === selection.tableName);
      return {
        level: "table" as const,
        label: selection.tableName,
        icon: "table",
        type: table ? `${table.columns.length} columns` : "",
        targetType: "table" as const,
        targetTable: selection.tableName,
        targetColumn: null,
      };
    }

    return {
      level: "schema" as const,
      label: schema.name,
      icon: "schema",
      type: `${tables.length} tables`,
      targetType: "schema" as const,
      targetTable: null,
      targetColumn: null,
    };
  }, [selection, schemas]);

  // Find existing voice context for current selection
  const currentContext = useMemo(() => {
    if (!voiceContexts || !contextInfo) return undefined;
    return voiceContexts.find(
      (c) =>
        c.targetType === contextInfo.targetType &&
        (c.targetTable ?? null) === (contextInfo.targetTable ?? null) &&
        (c.targetColumn ?? null) === (contextInfo.targetColumn ?? null)
    );
  }, [voiceContexts, contextInfo]);

  // Sync edit state when selection changes
  useEffect(() => {
    if (currentContext?.transcript) {
      setEditTranscript(currentContext.transcript);
    } else {
      setEditTranscript("");
    }
    if (contextInfo) {
      setEditTarget({
        type: contextInfo.targetType,
        table: contextInfo.targetTable,
        column: contextInfo.targetColumn,
      });
    }
  }, [currentContext?.transcript, currentContext?.id, contextInfo?.targetType, contextInfo?.targetTable, contextInfo?.targetColumn]);

  const handleSave = useCallback(() => {
    if (!selection?.schemaId || !editTarget || !editTranscript.trim()) return;
    upsertMutation.mutate(
      {
        schemaId: selection.schemaId,
        targetType: editTarget.type,
        targetTable: editTarget.table ?? null,
        targetColumn: editTarget.column ?? null,
        transcript: editTranscript.trim(),
      },
      {
        onSuccess: () => toast({ title: "Context saved" }),
        onError: () => toast({ title: "Failed to save", variant: "destructive" }),
      }
    );
  }, [selection?.schemaId, editTarget, editTranscript, upsertMutation, toast]);

  // No selection — show guide
  if (!selection?.schemaId || !contextInfo) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground px-6 text-center">
        <Mic className="w-8 h-8 mb-3 opacity-40" />
        <p className="text-sm font-medium">Schema Context</p>
        <p className="text-xs mt-1 opacity-60">
          Select a schema, table, or column to view and edit context.
          Context feeds into query analysis and voice-to-query generation.
        </p>
      </div>
    );
  }

  const hasContext = !!currentContext?.transcript;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          {contextInfo.icon === "pk" && <Key className="w-4 h-4 text-amber-500" />}
          {contextInfo.icon === "col" && <Columns3 className="w-4 h-4 text-muted-foreground" />}
          {contextInfo.icon === "table" && <Table2 className="w-4 h-4 text-emerald-500" />}
          {contextInfo.icon === "schema" && <Database className="w-4 h-4 text-primary" />}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold truncate">{contextInfo.label}</p>
            <p className="text-[10px] text-muted-foreground">{contextInfo.type}</p>
          </div>
          <Mic className={`w-4 h-4 flex-shrink-0 ${hasContext ? "text-muted-foreground/40" : "text-red-500"}`} />
        </div>
      </div>

      {/* Context editor */}
      <div className="flex-1 flex flex-col p-3 gap-3">
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
            Context for {contextInfo.level}
          </p>
          <p className="text-[10px] text-muted-foreground/60 mb-2">
            Describe what this {contextInfo.level} represents. This context is used by AI when analyzing queries and generating SQL from voice input.
          </p>
        </div>

        <Textarea
          value={editTranscript}
          onChange={(e) => setEditTranscript(e.target.value)}
          placeholder={`Add context about this ${contextInfo.level}... e.g., business meaning, typical values, relationships, constraints`}
          aria-label={`Context for ${contextInfo.label}`}
          className="text-xs flex-1 min-h-[100px] resize-none"
        />

        <Button
          size="sm"
          className="h-8 text-xs w-full"
          onClick={handleSave}
          disabled={!editTranscript.trim() || upsertMutation.isPending}
        >
          {upsertMutation.isPending ? (
            <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
          ) : null}
          {currentContext ? "Update Context" : "Save Context"}
        </Button>

        {/* Show all contexts for this schema */}
        {voiceContexts && voiceContexts.length > 0 && (
          <div className="mt-2 border-t border-border pt-3">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              All Context ({voiceContexts.length})
            </p>
            <div className="space-y-2 max-h-[300px] overflow-auto">
              {voiceContexts.map((vc) => {
                const label =
                  vc.targetType === "column" ? `${vc.targetTable}.${vc.targetColumn}` :
                  vc.targetType === "table" ? vc.targetTable :
                  "Schema";
                return (
                  <div key={vc.id} className="rounded border border-border/50 p-2 bg-muted/20">
                    <div className="flex items-center gap-1.5 mb-1">
                      {vc.targetType === "column" && <Columns3 className="w-2.5 h-2.5 text-muted-foreground" />}
                      {vc.targetType === "table" && <Table2 className="w-2.5 h-2.5 text-emerald-500" />}
                      {vc.targetType === "schema" && <Database className="w-2.5 h-2.5 text-primary" />}
                      <span className="text-[10px] font-mono font-medium">{label}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-relaxed line-clamp-3">{vc.transcript}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Theme hook
// ---------------------------------------------------------------------------

function useTheme() {
  const [dark, setDark] = useState(() => {
    return document.documentElement.classList.contains("dark");
  });

  const toggle = useCallback(() => {
    setDark((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle("dark", next);
      localStorage.setItem("theme", next ? "dark" : "light");
      return next;
    });
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("theme");
    if (saved === "light") {
      document.documentElement.classList.remove("dark");
      setDark(false);
    } else {
      document.documentElement.classList.add("dark");
      setDark(true);
    }
  }, []);

  return { dark, toggle };
}

// ---------------------------------------------------------------------------
// Demo constants
// ---------------------------------------------------------------------------

const DEMO_QUERY_ID = -1;

function makeDemoQuery(result: DemoBootstrapResult): SqlQuery {
  return {
    id: DEMO_QUERY_ID,
    userId: null,
    title: result.query.title,
    content: result.query.content,
    draftContent: null,
    formattedContent: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Editor page
// ---------------------------------------------------------------------------

export default function Editor() {
  // --- workspace tabs ---
  const [tabs, setTabs] = useState<WorkspaceTab[]>([
    { id: newTabId(), type: "query", title: "Query" },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>(tabs[0].id);
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  // --- query state ---
  const [selectedQueryId, setSelectedQueryId] = useState<number | null>(null);
  const [currentContent, setCurrentContent] = useState<string>("");
  const { data: queries, isLoading: queriesLoading } = useSqlQueries();
  const { data: selectedQuery, isLoading: queryLoading } = useSqlQuery(selectedQueryId);
  const { data: schemas } = useUserSchemas();
  const createMutation = useCreateSqlQuery();
  const { dark, toggle: toggleTheme } = useTheme();
  const { data: currentUser } = useCurrentUser();
  const [, setLocation] = useLocation();
  const isAdmin = currentUser?.authenticated && currentUser?.role === "admin";

  // --- demo state ---
  const { isSignedIn } = useAuth();
  const demoMutation = useDemoBootstrap();
  const [autoAnalyze, setAutoAnalyze] = useState(false);
  const [demoQuery, setDemoQuery] = useState<SqlQuery | null>(null);
  const isDemoActive = demoQuery !== null;
  const showOnboarding = !isSignedIn && !isDemoActive;

  // When user signs in, drop any demo query/schema from local state
  const prevSignedIn = useRef(isSignedIn);
  useEffect(() => {
    if (isSignedIn && !prevSignedIn.current) {
      // User just signed in — clear demo state
      if (isDemoActive) {
        setDemoQuery(null);
        setCurrentContent("");
        setAutoAnalyze(false);
      }
    }
    prevSignedIn.current = isSignedIn;
  }, [isSignedIn, isDemoActive]);

  // Schema drill-down selection state (for schemas tab)
  const [schemaSelection, setSchemaSelection] = useState<SchemaSelection | null>(null);

  // Hover/cursor linking state between editor and feedback panel
  const [hoveredEditorLine, setHoveredEditorLine] = useState<number | null>(null);
  const [cursorLine, setCursorLine] = useState<number | null>(null);
  const [feedbackHighlightedLines, setFeedbackHighlightedLines] = useState<Set<number>>(new Set());
  // Scroll-to-line: incremented counter + target line to trigger scroll
  const [scrollToLine, setScrollToLine] = useState<number | null>(null);
  const scrollToLineCounter = useRef(0);

  // Detect dialect from current editor content
  const detectedDialect: SqlDialect = useMemo(
    () => detectSqlDialect(currentContent),
    [currentContent]
  );
  const dialectMeta = DIALECT_META[detectedDialect];

  // --- left sidebar tab (contextual to workspace tab type) ---
  type LeftTabKey = "queries" | "ask" | "schemas" | "visual";

  const leftTabOptions: LeftTabKey[] = useMemo(() => {
    switch (activeTab.type) {
      case "query":
        return ["queries", "ask"];
      case "schemas":
        return ["schemas"];
      case "visual":
        return ["queries", "visual"];
    }
  }, [activeTab.type]);

  const [leftTab, setLeftTab] = useState<LeftTabKey>("queries");

  // Reset left tab when workspace tab type changes
  useEffect(() => {
    if (!leftTabOptions.includes(leftTab)) {
      setLeftTab(leftTabOptions[0]);
    }
  }, [leftTabOptions, leftTab]);

  // Auto-select first query if none selected
  useEffect(() => {
    if (!selectedQueryId && queries && queries.length > 0 && !queriesLoading) {
      setSelectedQueryId(queries[0].id);
    }
  }, [selectedQueryId, queries, queriesLoading]);

  const handleContentChange = useCallback((content: string) => {
    setCurrentContent(content);
  }, []);

  // Sync content when the selected query data loads
  useEffect(() => {
    if (selectedQuery && !currentContent) {
      setCurrentContent(selectedQuery.content);
    }
  }, [selectedQuery?.id]);

  const handleQuerySelect = useCallback((id: number | null) => {
    setSelectedQueryId(id);
    setCurrentContent("");
    // Selecting a real query clears demo mode
    if (demoQuery) setDemoQuery(null);
  }, [demoQuery]);

  const handleEditorLineHover = useCallback((lineNumber: number | null) => {
    setHoveredEditorLine(lineNumber);
  }, []);

  const handleCursorLineChange = useCallback((lineNumber: number | null) => {
    setCursorLine(lineNumber);
  }, []);

  const handleFeedbackHover = useCallback((lineNumbers: Set<number>) => {
    setFeedbackHighlightedLines(lineNumbers);
  }, []);

  const handleScrollToLine = useCallback((line: number) => {
    // Use a unique counter-based value so repeated clicks on the same line still trigger
    scrollToLineCounter.current += 1;
    setScrollToLine(line + scrollToLineCounter.current * 0.001);
  }, []);

  const editorHighlightedLines = useMemo(() => {
    return feedbackHighlightedLines;
  }, [feedbackHighlightedLines]);

  const handleDemoBootstrap = useCallback(() => {
    demoMutation.mutate(undefined, {
      onSuccess: (result) => {
        const virtualQuery = makeDemoQuery(result);
        setDemoQuery(virtualQuery);
        setSelectedQueryId(null); // no real DB query selected
        setCurrentContent(virtualQuery.content);
        // Delay auto-analyze slightly to let state settle
        setTimeout(() => setAutoAnalyze(true), 500);
      },
    });
  }, [demoMutation]);

  // Effective query: demo takes priority, then DB-selected query
  const effectiveQuery = isDemoActive ? demoQuery : selectedQuery;
  const effectiveQueryId = isDemoActive ? DEMO_QUERY_ID : selectedQueryId;

  // Resolve the best available query content – prefer the live editor text,
  // but fall back to the persisted draft or saved content so the Visual tab
  // (and other consumers) always have something even while a query is loading.
  const resolvedQueryContent = currentContent || effectiveQuery?.draftContent || effectiveQuery?.content || "";

  // Prepare schema data for VisualExplorer (needs column names as strings)
  const schemaData = useMemo(() => {
    if (!schemas) return undefined;
    return schemas.map(s => ({
      name: s.name,
      tables: normalizeTables(s.tables).map(t => ({
        name: t.name,
        columns: t.columns.map(c => c.name),
      })),
    }));
  }, [schemas]);

  // --- workspace tab actions ---
  const addTab = useCallback((type: WorkspaceTabType) => {
    // Schemas and Visual are singletons — focus the existing tab if one exists
    if (type === "schemas" || type === "visual") {
      setTabs((prev) => {
        const existing = prev.find((t) => t.type === type);
        if (existing) {
          setActiveTabId(existing.id);
          return prev;
        }
        const titles: Record<WorkspaceTabType, string> = {
          query: "Query",
          schemas: "Schemas",
          visual: "Visual",
        };
        const tab: WorkspaceTab = { id: newTabId(), type, title: titles[type] };
        setActiveTabId(tab.id);
        return [...prev, tab];
      });
      return;
    }
    const tab: WorkspaceTab = { id: newTabId(), type, title: "Query" };
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }, []);

  const closeTab = useCallback((tabId: string) => {
    setTabs((prev) => {
      if (prev.length <= 1) return prev; // never close last tab
      const idx = prev.findIndex((t) => t.id === tabId);
      const next = prev.filter((t) => t.id !== tabId);
      if (tabId === activeTabId) {
        const newIdx = Math.min(idx, next.length - 1);
        setActiveTabId(next[newIdx].id);
      }
      return next;
    });
  }, [activeTabId]);

  // --- left sidebar tab definitions ---
  const LEFT_TABS: Record<string, { icon: React.ElementType; label: string; tooltip: string }> = {
    queries: { icon: FileCode2, label: "Queries", tooltip: "Manage SQL queries" },
    ask: { icon: MessageSquare, label: "Ask", tooltip: "Ask questions about your SQL" },
    schemas: { icon: Table2, label: "Schemas", tooltip: "Manage schema definitions" },
    visual: { icon: GitBranch, label: "Visual", tooltip: "Visual query explorer" },
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Global top bar */}
      <header className="flex items-center justify-between px-4 py-1.5 border-b border-border bg-card flex-shrink-0">
        {/* Left: branding + dialect */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <FileCode2 className="w-4 h-4 text-primary" />
            <h1 className="text-sm font-semibold text-foreground">QueryFlow</h1>
          </div>

          {!showOnboarding && (
            <>
              <div className="h-4 w-px bg-border" />

              {/* Detected SQL dialect — only shown when content exists */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5 text-muted-foreground" />
                    <Badge
                      variant="outline"
                      className={`text-[10px] h-5 px-2 font-mono ${dialectMeta.color}`}
                    >
                      {detectedDialect}
                    </Badge>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="text-xs">Detected SQL dialect based on query syntax</p>
                </TooltipContent>
              </Tooltip>
            </>
          )}
        </div>

        {/* Right: theme + auth + settings */}
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" onClick={() => setLocation("/admin")} className="h-7 w-7 p-0">
                  <Shield className="w-3.5 h-3.5 text-primary" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">Admin Dashboard</p>
              </TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" onClick={toggleTheme} className="h-7 w-7 p-0">
                {dark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="text-xs">{dark ? "Switch to light mode" : "Switch to dark mode"}</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <ContextPlanDialog
                  queryId={effectiveQueryId}
                  dialect={detectedDialect}
                  queryContent={resolvedQueryContent}
                />
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="text-xs">Analysis Context Plan</p>
            </TooltipContent>
          </Tooltip>

          <SettingsDialog />

          <div className="h-4 w-px bg-border" />

          <SignedOut>
            <SignInButton mode="modal">
              <Button variant="outline" size="sm" className="h-7 text-xs">
                Sign In
              </Button>
            </SignInButton>
          </SignedOut>
          <SignedIn>
            <UserButton />
          </SignedIn>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 overflow-hidden">
        {showOnboarding ? (
          /* ── Full-width landing page for unauthenticated users ── */
          <div className="h-full overflow-auto bg-background">
            <div className="max-w-5xl mx-auto px-8 py-16 space-y-14">
              {/* Hero */}
              <div className="text-center space-y-6">
                <div className="inline-flex p-4 rounded-2xl bg-gradient-to-br from-primary/10 to-purple-600/10 border border-primary/10">
                  <FileCode2 className="w-14 h-14 text-primary" />
                </div>

                <h1 className="text-3xl md:text-4xl font-bold text-foreground tracking-tight">
                  Your SQL Query Analyzer
                </h1>

                <p className="text-base md:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
                  QueryFlow challenges you to write better SQL. Multi-agent AI analysis catches bugs,
                  performance issues, and security risks — you stay in complete control of every decision.
                </p>

                <Button
                  onClick={handleDemoBootstrap}
                  disabled={demoMutation.isPending}
                  className="h-12 px-10 text-base gap-2.5 rounded-full shadow-lg hover:shadow-primary/25 hover:-translate-y-0.5 transition-all duration-300 bg-gradient-to-r from-primary to-purple-600 text-primary-foreground font-semibold"
                >
                  {demoMutation.isPending ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Generating flawed query...
                    </>
                  ) : (
                    <>
                      <Play className="w-5 h-5" />
                      Try It — Find 9 Mistakes in a Real Query
                    </>
                  )}
                </Button>

                {demoMutation.isPending && (
                  <p className="text-xs text-muted-foreground/60">
                    Loading e-commerce schema &amp; analytics query with intentional mistakes...
                  </p>
                )}
              </div>

              {/* Before / After showcase */}
              <div className="grid md:grid-cols-2 gap-4 max-w-4xl mx-auto">
                <div className="rounded-lg border border-destructive/20 bg-card overflow-hidden">
                  <div className="px-4 py-2 bg-destructive/10 border-b border-destructive/20">
                    <p className="text-xs font-semibold text-destructive flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5" /> Before — Common Mistakes
                    </p>
                  </div>
                  <pre className="p-4 text-[11px] font-mono text-muted-foreground leading-relaxed overflow-x-auto whitespace-pre">
{`SELECT *
FROM orders
LEFT JOIN order_items
  ON orders.id = order_items.order_id
-- no date filter, scans all history
-- LEFT JOIN inflates revenue with returns
-- SELECT * pulls unnecessary columns
GROUP BY DATE_TRUNC('month', order_date)`}
                  </pre>
                </div>

                <div className="rounded-lg border border-emerald-500/20 bg-card overflow-hidden">
                  <div className="px-4 py-2 bg-emerald-500/10 border-b border-emerald-500/20">
                    <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5" /> After — With QueryFlow Fixes
                    </p>
                  </div>
                  <pre className="p-4 text-[11px] font-mono text-muted-foreground leading-relaxed overflow-x-auto whitespace-pre">
{`SELECT
  DATE_TRUNC('month', o.order_date) AS month,
  SUM(oi.amount) AS revenue
FROM orders o
INNER JOIN order_items oi
  ON o.id = oi.order_id
WHERE o.status NOT IN ('refunded','cancelled')
  AND o.order_date >= CURRENT_DATE
      - INTERVAL '12 months'
GROUP BY 1 ORDER BY 1`}
                  </pre>
                </div>
              </div>

              {/* Feature highlights */}
              <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
                {([
                  {
                    icon: Database,
                    title: "Schema Context",
                    desc: "Enrich your schema with domain knowledge. Add voice or text annotations at the schema, table, or column level so AI analysis deeply understands your data model.",
                    color: "text-cyan-500",
                  },
                  {
                    icon: Sparkles,
                    title: "AI Analysis",
                    desc: "Multi-agent analyzer that challenges you to improve every query. Catch bugs, performance issues, and security risks — with complete control over your decisions.",
                    color: "text-primary",
                  },
                  {
                    icon: Boxes,
                    title: "Visual Explorer",
                    desc: "Visualize stored procedures and queries like never before. Complete lineage tracking with a dynamic visual query editor.",
                    color: "text-emerald-500",
                  },
                ] as const).map((feat) => {
                  const Icon = feat.icon;
                  return (
                    <div key={feat.title} className="p-5 rounded-xl border border-border bg-card/50 space-y-3">
                      <div className="p-2.5 rounded-lg bg-accent/50 w-fit">
                        <Icon className={`w-5 h-5 ${feat.color}`} />
                      </div>
                      <h3 className="text-sm font-semibold text-foreground">{feat.title}</h3>
                      <p className="text-xs text-muted-foreground leading-relaxed">{feat.desc}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
        <ResizablePanelGroup direction="horizontal" className="h-full">
          {/* Left sidebar – contextual to active workspace tab */}
          <ResizablePanel defaultSize={20} minSize={16} maxSize={32}>
            <div className="h-full border-r border-border bg-card flex flex-col">
              {/* Contextual tab bar */}
              <div className="flex border-b border-border flex-shrink-0">
                {leftTabOptions.map((key) => {
                  const def = LEFT_TABS[key];
                  const Icon = def.icon;
                  return (
                    <Tooltip key={key}>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => setLeftTab(key as any)}
                          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-[10px] font-medium border-b-2 transition-colors ${
                            leftTab === key
                              ? "border-primary text-primary"
                              : "border-transparent text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                          {def.label}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom"><p className="text-xs">{def.tooltip}</p></TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>

              {/* Tab content */}
              <div className="flex-1 overflow-hidden">
                {leftTab === "queries" && (
                  <QueryDocumentList
                    selectedId={selectedQueryId}
                    onSelect={handleQuerySelect}
                  />
                )}
                {leftTab === "ask" && (
                  <AskModule
                    queryContent={resolvedQueryContent}
                    dialect={detectedDialect}
                  />
                )}
                {leftTab === "schemas" && (
                  <SchemaTreePanel
                    selection={schemaSelection}
                    onSelect={setSchemaSelection}
                  />
                )}
                {leftTab === "visual" && (
                  <VisualExplorer
                    queryContent={resolvedQueryContent}
                    schemas={schemaData}
                  />
                )}
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle className="w-px bg-border hover:bg-primary/50" />

          {/* Center panel – workspace tab bar + content */}
          <ResizablePanel defaultSize={52} minSize={30}>
            <div className="h-full flex flex-col">
              {/* Workspace tab bar */}
              <div className="flex items-center border-b border-border bg-card flex-shrink-0">
                {/* Left: query tabs + "+" button */}
                <div className="flex items-center overflow-x-auto flex-1 min-w-0">
                  {tabs.filter((t) => t.type === "query").map((tab) => {
                    const isActive = tab.id === activeTabId;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTabId(tab.id)}
                        className={`group relative flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 text-xs font-medium border-r border-border whitespace-nowrap transition-colors ${
                          isActive
                            ? "bg-background text-foreground"
                            : "bg-card text-muted-foreground hover:text-foreground hover:bg-accent/50"
                        }`}
                      >
                        <FileCode2 className="w-3 h-3 flex-shrink-0" />
                        <span>{tab.title}</span>
                        {tabs.length > 1 && (
                          <span
                            role="button"
                            onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                            className="ml-1 p-0.5 rounded hover:bg-muted-foreground/20 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X className="w-2.5 h-2.5" />
                          </span>
                        )}
                        {isActive && (
                          <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
                        )}
                      </button>
                    );
                  })}

                  {/* + new query tab */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => addTab("query")}
                        className="flex items-center justify-center w-8 h-8 text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors flex-shrink-0"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom"><p className="text-xs">New query tab</p></TooltipContent>
                  </Tooltip>
                </div>

                {/* Right: pinned singleton tabs */}
                <div className="flex items-center border-l border-border flex-shrink-0">
                  {(["schemas", "visual"] as const).map((type) => {
                    const isActive = activeTab.type === type;
                    const icon = type === "schemas" ? Table2 : Boxes;
                    const Icon = icon;
                    const label = type === "schemas" ? "Schemas" : "Visual";
                    const tab = tabs.find((t) => t.type === type);
                    return (
                      <Tooltip key={type}>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => addTab(type)}
                            className={`relative flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                              isActive
                                ? "bg-background text-foreground"
                                : "bg-card text-muted-foreground hover:text-foreground hover:bg-accent/50"
                            }`}
                          >
                            <Icon className="w-3 h-3 flex-shrink-0" />
                            <span>{label}</span>
                            {tab && tabs.length > 1 && (
                              <span
                                role="button"
                                onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                                className="ml-1 p-0.5 rounded hover:bg-muted-foreground/20 opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <X className="w-2.5 h-2.5" />
                              </span>
                            )}
                            {isActive && (
                              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
                            )}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          <p className="text-xs">{type === "schemas" ? "ERD & schema definitions" : "Visual query explorer"}</p>
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              </div>

              {/* Workspace tab content */}
              <div className="flex-1 overflow-hidden">
                {activeTab.type === "query" && (
                  <>
                    {(queriesLoading || queryLoading) && !isDemoActive ? (
                      <div className="flex items-center justify-center h-full">
                        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : effectiveQuery ? (
                      <SqlEditor
                        query={effectiveQuery}
                        onContentChange={handleContentChange}
                        maxChars={MODEL.maxQueryChars}
                        modelName={MODEL.name}
                        highlightedLines={editorHighlightedLines}
                        onLineHover={handleEditorLineHover}
                        onCursorLineChange={handleCursorLineChange}
                        scrollToLine={scrollToLine}
                      />
                    ) : (
                      /* ── Authenticated empty state — query onboarding ── */
                      <QueryOnboarding
                        onQueryCreated={(id) => {
                          setSelectedQueryId(id);
                          setCurrentContent("");
                        }}
                      />
                    )}
                  </>
                )}

                {activeTab.type === "schemas" && (
                  <div className="h-full overflow-auto">
                    <SchemaDetailView
                      selection={schemaSelection}
                      onNavigate={setSchemaSelection}
                    />
                  </div>
                )}

                {activeTab.type === "visual" && (
                  <div className="h-full overflow-auto">
                    <VisualExplorer
                      queryContent={resolvedQueryContent}
                      schemas={schemaData}
                    />
                  </div>
                )}
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle className="w-px bg-border hover:bg-primary/50" />

          {/* Right panel – contextual */}
          <ResizablePanel defaultSize={30} minSize={20} maxSize={45}>
            <div className="h-full border-l border-border bg-card">
              {activeTab.type === "query" && (
                <FeedbackPanel
                  queryId={effectiveQueryId}
                  dialect={detectedDialect}
                  queryContent={resolvedQueryContent}
                  hoveredLine={hoveredEditorLine}
                  activeLine={cursorLine}
                  onFeedbackHover={handleFeedbackHover}
                  onScrollToLine={handleScrollToLine}
                  onApplySuggestion={(beforeSql, afterSql) => {
                    const current = resolvedQueryContent;
                    if (current.includes(beforeSql)) {
                      setCurrentContent(current.replace(beforeSql, afterSql));
                    }
                  }}
                  autoAnalyze={autoAnalyze}
                  onAutoAnalyzed={() => setAutoAnalyze(false)}
                />
              )}

              {activeTab.type === "schemas" && (
                <SchemaContextPanel selection={schemaSelection} />
              )}

              {activeTab.type === "visual" && (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground px-6 text-center">
                  <Boxes className="w-8 h-8 mb-3 opacity-40" />
                  <p className="text-sm font-medium">Visual Properties</p>
                  <p className="text-xs mt-1 opacity-60">
                    Select tables and transformations in the visual view to inspect and edit their properties.
                  </p>
                </div>
              )}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
        )}
      </div>
    </div>
  );
}
