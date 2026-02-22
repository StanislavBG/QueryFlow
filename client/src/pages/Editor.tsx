import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useSqlQuery, useSqlQueries, useCreateSqlQuery, useUserSchemas, useDemoBootstrap, type DemoBootstrapResult } from "@/hooks/use-sql-queries";
import type { SqlQuery } from "@shared/schema";
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
import { FileCode2, Loader2, Database, Sun, Moon, MessageSquare, Table2, GitBranch, Plus, X, Boxes, Shield, Play, Sparkles, Zap, AlertCircle, AlertTriangle, Info, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

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

          <div className="h-4 w-px bg-border" />

          {/* Detected SQL dialect */}
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
                {showOnboarding ? (
                  /* ── Onboarding: feature overview ── */
                  <div className="h-full overflow-auto p-4 space-y-5">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <FileCode2 className="w-5 h-5 text-primary" />
                        <h2 className="text-base font-bold text-gradient">QueryFlow</h2>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        AI-powered SQL analysis that catches what code review misses.
                      </p>
                    </div>

                    <div className="h-px bg-border" />

                    <div className="space-y-3">
                      {([
                        { icon: Sparkles, title: "AI Analysis", desc: "Multi-agent analysis catches bugs, performance issues, and security risks across 10+ categories.", color: "text-primary" },
                        { icon: Table2, title: "Schema-Aware", desc: "Upload DDL schemas for context-aware validation of joins, column references, and types.", color: "text-cyan-500" },
                        { icon: MessageSquare, title: "Ask AI", desc: "Chat with AI about your SQL queries. Get explanations, alternatives, and best practices.", color: "text-violet-500" },
                        { icon: Boxes, title: "Visual Explorer", desc: "See query relationships and data flow as an interactive visual graph.", color: "text-emerald-500" },
                        { icon: Zap, title: "Smart Format", desc: "One-click LLM-powered formatting to ISO/IEC 9075 standards.", color: "text-amber-500" },
                      ] as const).map((feat) => {
                        const Icon = feat.icon;
                        return (
                          <div key={feat.title} className="flex items-start gap-2.5">
                            <div className="mt-0.5 p-1.5 rounded-md bg-accent/50">
                              <Icon className={`w-3.5 h-3.5 ${feat.color}`} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold text-foreground">{feat.title}</p>
                              <p className="text-[10px] text-muted-foreground leading-relaxed">{feat.desc}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="h-px bg-border" />

                    <div className="text-center space-y-2">
                      <p className="text-[10px] text-muted-foreground">Try the interactive demo to see it in action</p>
                      <ArrowRight className="w-3.5 h-3.5 text-muted-foreground mx-auto animate-pulse" />
                    </div>
                  </div>
                ) : (
                  /* ── Normal tab content ── */
                  <>
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
                  </>
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
                    ) : showOnboarding ? (
                      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-4 px-6">
                        {/* ── Onboarding: center hero ── */}
                        <div className="p-4 rounded-2xl bg-gradient-to-br from-primary/10 to-purple-600/10 border border-primary/10">
                          <FileCode2 className="w-12 h-12 text-primary" />
                        </div>

                        <h2 className="text-xl md:text-2xl font-bold text-foreground text-center">
                          Write SQL. Get instant AI feedback.
                        </h2>

                        <p className="text-sm text-muted-foreground max-w-md text-center leading-relaxed">
                          See QueryFlow analyze a real-world analytics query with 9 intentional business analyst mistakes — revenue inflation, missing filters, wrong JOINs, and more.
                        </p>

                        <Button
                          onClick={handleDemoBootstrap}
                          disabled={demoMutation.isPending}
                          className="h-11 px-8 text-sm gap-2 rounded-full shadow-lg hover:shadow-primary/25 hover:-translate-y-0.5 transition-all duration-300 bg-gradient-to-r from-primary to-purple-600 text-primary-foreground font-semibold"
                        >
                          {demoMutation.isPending ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Loading demo...
                            </>
                          ) : (
                            <>
                              <Play className="w-4 h-4" />
                              Try Demo
                              <ArrowRight className="w-4 h-4" />
                            </>
                          )}
                        </Button>

                        {demoMutation.isPending && (
                          <p className="text-[10px] text-muted-foreground/60 max-w-[280px] text-center">
                            Loading a pre-generated e-commerce schema and analytical query...
                          </p>
                        )}

                        {/* Decorative SQL preview */}
                        <div className="mt-4 w-full max-w-lg rounded-lg border border-border/50 bg-card/50 p-4 font-mono text-[11px] leading-relaxed text-muted-foreground/40 select-none overflow-hidden">
                          <p><span className="text-primary/30 font-semibold">WITH</span> monthly_revenue <span className="text-primary/30 font-semibold">AS</span> (</p>
                          <p className="pl-4"><span className="text-primary/30 font-semibold">SELECT</span> DATE_TRUNC(<span className="text-emerald-500/30">'month'</span>, order_date),</p>
                          <p className="pl-8">SUM(total_amount) <span className="text-primary/30 font-semibold">AS</span> revenue</p>
                          <p className="pl-4"><span className="text-primary/30 font-semibold">FROM</span> orders</p>
                          <p className="pl-4"><span className="text-primary/30 font-semibold">LEFT JOIN</span> order_items <span className="text-primary/30 font-semibold">ON</span> ...</p>
                          <p>)</p>
                          <p><span className="text-primary/30 font-semibold">SELECT</span> * <span className="text-primary/30 font-semibold">FROM</span> monthly_revenue;</p>
                        </div>
                      </div>
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
                showOnboarding ? (
                  /* ── Onboarding: mock feedback preview ── */
                  <div className="flex flex-col h-full">
                    <div className="p-3 border-b border-border">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-primary" />
                        <h3 className="text-sm font-semibold text-foreground">AI Analysis Preview</h3>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        This is what real feedback looks like
                      </p>
                    </div>

                    <div className="flex-1 overflow-auto p-3 space-y-2.5">
                      {/* Mock error card */}
                      <div className="rounded-md border border-destructive/20 bg-destructive/5 p-3">
                        <div className="flex items-start gap-2.5">
                          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-destructive" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground leading-tight">Revenue Inflation Risk</p>
                            <div className="flex items-center gap-1.5 mt-1 mb-1.5">
                              <Badge variant="outline" className="text-[10px] h-4">
                                <Zap className="w-2.5 h-2.5 mr-1 text-muted-foreground" />
                                Performance
                              </Badge>
                              <span className="text-[10px] text-muted-foreground">Line 12</span>
                            </div>
                            <p className="text-xs text-muted-foreground leading-relaxed">
                              The SUM(total_amount) doesn't subtract returns or refunds, overstating revenue by up to 15%. This is a common mistake in analytics queries...
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Mock warning card */}
                      <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3">
                        <div className="flex items-start gap-2.5">
                          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground leading-tight">Missing Date Range Filter</p>
                            <div className="flex items-center gap-1.5 mt-1 mb-1.5">
                              <Badge variant="outline" className="text-[10px] h-4">
                                <AlertCircle className="w-2.5 h-2.5 mr-1 text-muted-foreground" />
                                Correctness
                              </Badge>
                              <span className="text-[10px] text-muted-foreground">Line 5</span>
                            </div>
                            <p className="text-xs text-muted-foreground leading-relaxed">
                              No date boundary on a "monthly" report — this scans all historical data, increasing query cost and returning misleading aggregates...
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Mock info card */}
                      <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
                        <div className="flex items-start gap-2.5">
                          <Info className="w-4 h-4 mt-0.5 flex-shrink-0 text-primary" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground leading-tight">Consider Window Functions</p>
                            <div className="flex items-center gap-1.5 mt-1 mb-1.5">
                              <Badge variant="outline" className="text-[10px] h-4">
                                <Sparkles className="w-2.5 h-2.5 mr-1 text-muted-foreground" />
                                Alternative
                              </Badge>
                              <span className="text-[10px] text-muted-foreground">Line 28</span>
                            </div>
                            <p className="text-xs text-muted-foreground leading-relaxed">
                              ROW_NUMBER() could replace the self-join for ranking, improving readability and reducing the query's execution plan complexity...
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="p-3 border-t border-border">
                      <p className="text-[10px] text-muted-foreground text-center">
                        These are examples — try the demo to see real analysis
                      </p>
                    </div>
                  </div>
                ) : (
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
                )
              )}

              {activeTab.type === "schemas" && (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground px-6 text-center">
                  <Table2 className="w-8 h-8 mb-3 opacity-40" />
                  <p className="text-sm font-medium">
                    {schemaSelection?.columnName ? "Column Details" :
                     schemaSelection?.tableName ? "Table Details" :
                     schemaSelection?.schemaId ? "Schema Details" : "Schema Details"}
                  </p>
                  <p className="text-xs mt-1 opacity-60">
                    {schemaSelection?.schemaId
                      ? "Use the mic icons to add voice or text context to schema items. This context feeds into query analysis."
                      : "Select a schema in the left panel to view details, relationships, and ERD visualization."}
                  </p>
                </div>
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
      </div>
    </div>
  );
}
