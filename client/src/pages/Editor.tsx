import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useSqlQuery, useSqlQueries, useCreateSqlQuery, useUserSchemas } from "@/hooks/use-sql-queries";
import { QueryDocumentList } from "@/components/QueryDocumentList";
import { SqlEditor } from "@/components/SqlEditor";
import { FeedbackPanel } from "@/components/FeedbackPanel";
import { SettingsDialog } from "@/components/SettingsDialog";
import { AskModule } from "@/components/AskModule";
import { SchemaModule } from "@/components/SchemaModule";
import { VisualExplorer } from "@/components/VisualExplorer";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FileCode2, Loader2, Database, Sun, Moon, MessageSquare, Table2, GitBranch, Plus, X, Boxes } from "lucide-react";
import { Button } from "@/components/ui/button";

import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/clerk-react";
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

  // Hover linking state between editor and feedback panel
  const [hoveredEditorLine, setHoveredEditorLine] = useState<number | null>(null);
  const [feedbackHighlightedLines, setFeedbackHighlightedLines] = useState<Set<number>>(new Set());

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
  }, []);

  const handleEditorLineHover = useCallback((lineNumber: number | null) => {
    setHoveredEditorLine(lineNumber);
  }, []);

  const handleFeedbackHover = useCallback((lineNumbers: Set<number>) => {
    setFeedbackHighlightedLines(lineNumbers);
  }, []);

  const editorHighlightedLines = useMemo(() => {
    return feedbackHighlightedLines;
  }, [feedbackHighlightedLines]);

  // Prepare schema data for VisualExplorer
  const schemaData = useMemo(() => {
    if (!schemas) return undefined;
    return schemas.map(s => ({
      name: s.name,
      tables: (s.tables as Array<{ name: string; columns: string[] }>) || [],
    }));
  }, [schemas]);

  // --- workspace tab actions ---
  const addTab = useCallback((type: WorkspaceTabType) => {
    const titles: Record<WorkspaceTabType, string> = {
      query: "Query",
      schemas: "Schemas",
      visual: "Visual",
    };
    const tab: WorkspaceTab = { id: newTabId(), type, title: titles[type] };
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
                {leftTab === "queries" && (
                  <QueryDocumentList
                    selectedId={selectedQueryId}
                    onSelect={handleQuerySelect}
                  />
                )}
                {leftTab === "ask" && (
                  <AskModule
                    queryContent={currentContent}
                    dialect={detectedDialect}
                  />
                )}
                {leftTab === "schemas" && (
                  <SchemaModule />
                )}
                {leftTab === "visual" && (
                  <VisualExplorer
                    queryContent={currentContent}
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
              <div className="flex items-center border-b border-border bg-card flex-shrink-0 overflow-x-auto">
                {tabs.map((tab) => {
                  const Icon = TAB_ICON[tab.type];
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
                      <Icon className="w-3 h-3 flex-shrink-0" />
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

                {/* "+" dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex items-center justify-center w-8 h-8 text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors flex-shrink-0">
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-52">
                    <DropdownMenuItem onClick={() => addTab("query")}>
                      <FileCode2 className="w-4 h-4 mr-2" />
                      <div>
                        <div className="font-medium">New Query</div>
                        <div className="text-[10px] text-muted-foreground">Open a new SQL editor</div>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => addTab("schemas")}>
                      <Table2 className="w-4 h-4 mr-2" />
                      <div>
                        <div className="font-medium">Manage Schemas</div>
                        <div className="text-[10px] text-muted-foreground">Explore ERD &amp; schema definitions</div>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => addTab("visual")}>
                      <Boxes className="w-4 h-4 mr-2" />
                      <div>
                        <div className="font-medium">Visual</div>
                        <div className="text-[10px] text-muted-foreground">Visual table &amp; transformation view</div>
                      </div>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Workspace tab content */}
              <div className="flex-1 overflow-hidden">
                {activeTab.type === "query" && (
                  <>
                    {(queriesLoading || queryLoading) ? (
                      <div className="flex items-center justify-center h-full">
                        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : selectedQuery ? (
                      <SqlEditor
                        query={selectedQuery}
                        onContentChange={handleContentChange}
                        maxChars={MODEL.maxQueryChars}
                        modelName={MODEL.name}
                        dialect={detectedDialect}
                        highlightedLines={editorHighlightedLines}
                        onLineHover={handleEditorLineHover}
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
                        <FileCode2 className="w-10 h-10 opacity-30" />
                        <p className="text-sm font-medium">No query selected</p>
                        <p className="text-xs opacity-60 max-w-[240px] text-center">
                          Create a new query from the sidebar or select an existing one to get started.
                        </p>
                      </div>
                    )}
                  </>
                )}

                {activeTab.type === "schemas" && (
                  <div className="h-full overflow-auto">
                    <SchemaModule />
                  </div>
                )}

                {activeTab.type === "visual" && (
                  <div className="h-full overflow-auto">
                    <VisualExplorer
                      queryContent={currentContent}
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
                  queryId={selectedQueryId}
                  dialect={detectedDialect}
                  hoveredLine={hoveredEditorLine}
                  onFeedbackHover={handleFeedbackHover}
                />
              )}

              {activeTab.type === "schemas" && (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground px-6 text-center">
                  <Table2 className="w-8 h-8 mb-3 opacity-40" />
                  <p className="text-sm font-medium">Schema Details</p>
                  <p className="text-xs mt-1 opacity-60">
                    Select a schema in the left panel to view details, relationships, and ERD visualization.
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
