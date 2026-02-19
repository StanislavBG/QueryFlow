import { useState, useCallback, useMemo, useEffect } from "react";
import { useSqlQuery, useSqlQueries, useCreateSqlQuery } from "@/hooks/use-sql-queries";
import { QueryDocumentList } from "@/components/QueryDocumentList";
import { SqlEditor } from "@/components/SqlEditor";
import { FeedbackPanel } from "@/components/FeedbackPanel";
import { SettingsDialog } from "@/components/SettingsDialog";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FileCode2, Loader2, Cpu, Database, Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";

import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/clerk-react";
import {
  LLM_MODELS,
  DEFAULT_MODEL_ID,
  getModelById,
  detectSqlDialect,
  DIALECT_META,
  type LLMModel,
  type SqlDialect,
} from "@/lib/models";

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

export default function Editor() {
  const [selectedQueryId, setSelectedQueryId] = useState<number | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string>(DEFAULT_MODEL_ID);
  const [currentContent, setCurrentContent] = useState<string>("");
  const { data: queries, isLoading: queriesLoading } = useSqlQueries();
  const { data: selectedQuery, isLoading: queryLoading } = useSqlQuery(selectedQueryId);
  const createMutation = useCreateSqlQuery();
  const { dark, toggle: toggleTheme } = useTheme();

  const selectedModel = getModelById(selectedModelId) || LLM_MODELS[0];

  // Detect dialect from current editor content
  const detectedDialect: SqlDialect = useMemo(
    () => detectSqlDialect(currentContent),
    [currentContent]
  );
  const dialectMeta = DIALECT_META[detectedDialect];

  const [autoCreating, setAutoCreating] = useState(false);

  // Auto-select first query if none selected
  useEffect(() => {
    if (!selectedQueryId && queries && queries.length > 0 && !queriesLoading) {
      setSelectedQueryId(queries[0].id);
    }
  }, [selectedQueryId, queries, queriesLoading]);

  // Auto-create a blank query when the list is empty so the editor is immediately ready for paste
  useEffect(() => {
    if (!queriesLoading && queries && queries.length === 0 && !autoCreating && !createMutation.isPending) {
      setAutoCreating(true);
      createMutation.mutate(
        { title: "Untitled Query", content: "" },
        {
          onSuccess: (query) => {
            setSelectedQueryId(query.id);
            setAutoCreating(false);
          },
          onError: () => {
            setAutoCreating(false);
          },
        }
      );
    }
  }, [queriesLoading, queries, autoCreating, createMutation]);

  const handleContentChange = useCallback((content: string) => {
    setCurrentContent(content);
  }, []);

  // Sync content when the selected query data loads
  useEffect(() => {
    if (selectedQuery && !currentContent) {
      setCurrentContent(selectedQuery.content);
    }
  }, [selectedQuery?.id]);

  const handleQuerySelect = useCallback((id: number) => {
    setSelectedQueryId(id);
    setCurrentContent("");
  }, []);

  const modelsByProvider = useMemo(() => {
    const grouped: Record<string, LLMModel[]> = {};
    for (const m of LLM_MODELS) {
      if (!grouped[m.provider]) grouped[m.provider] = [];
      grouped[m.provider].push(m);
    }
    return grouped;
  }, []);

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

        {/* Right: model picker + theme + auth + settings */}
        <div className="flex items-center gap-2">
          {/* Model picker */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Cpu className="w-3.5 h-3.5 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="text-xs">LLM for feedback generation</p>
            </TooltipContent>
          </Tooltip>
          <Select value={selectedModelId} onValueChange={setSelectedModelId}>
            <SelectTrigger className="h-7 w-[170px] text-xs bg-background border-border">
              <SelectValue placeholder="Select model" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(modelsByProvider).map(([provider, models]) => (
                <div key={provider}>
                  <div className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    {provider}
                  </div>
                  {models.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      <div className="flex items-center justify-between gap-3 w-full">
                        <span>{model.name}</span>
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {(model.maxQueryChars / 1000).toFixed(0)}k
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </div>
              ))}
            </SelectContent>
          </Select>

          <div className="h-4 w-px bg-border" />

          {/* Dark / Light toggle */}
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

          {/* Auth controls */}
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
          {/* Left sidebar */}
          <ResizablePanel defaultSize={18} minSize={14} maxSize={30}>
            <div className="h-full border-r border-border bg-card">
              <QueryDocumentList
                selectedId={selectedQueryId}
                onSelect={handleQuerySelect}
              />
            </div>
          </ResizablePanel>

          <ResizableHandle className="w-px bg-border hover:bg-primary/50" />

          {/* Center - SQL Editor */}
          <ResizablePanel defaultSize={52} minSize={30}>
            <div className="h-full">
              {(queriesLoading || queryLoading || autoCreating) ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : selectedQuery ? (
                <SqlEditor
                  query={selectedQuery}
                  onContentChange={handleContentChange}
                  maxChars={selectedModel.maxQueryChars}
                  modelName={selectedModel.name}
                />
              ) : (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
          </ResizablePanel>

          <ResizableHandle className="w-px bg-border hover:bg-primary/50" />

          {/* Right panel - Feedback */}
          <ResizablePanel defaultSize={30} minSize={20} maxSize={45}>
            <div className="h-full border-l border-border bg-card">
              <FeedbackPanel queryId={selectedQueryId} />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
