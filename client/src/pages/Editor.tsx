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
import { FileCode2, Loader2, Database, Sun, Moon, MessageSquare, Table2, GitBranch, Plus, X, Boxes, Shield, Play, Sparkles, AlertCircle, Mic, Key, Columns3, Lock, ExternalLink, Scale } from "lucide-react";
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
// Terms of Service Modal
// ---------------------------------------------------------------------------

function TermsOfServiceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const el = dialogRef.current;
    if (el) el.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab" || !el) return;
      const focusable = el.querySelectorAll<HTMLElement>(
        'button, a[href], [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tos-title"
        tabIndex={-1}
        className="bg-card border border-border rounded-xl shadow-2xl max-w-lg w-full mx-4 max-h-[80vh] overflow-auto outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Scale className="w-5 h-5 text-primary" />
            <h2 id="tos-title" className="text-lg font-bold">Terms of Service</h2>
          </div>

          <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
            <div>
              <h3 className="text-foreground font-semibold mb-1">Acceptance of Terms</h3>
              <p>
                By accessing or using QueryFlow, you agree to be bound by these terms. If you do not
                agree, do not use the service.
              </p>
            </div>

            <div>
              <h3 className="text-foreground font-semibold mb-1">Description of Service</h3>
              <p>
                QueryFlow is an AI-powered SQL query editor that provides analysis, formatting, and
                optimization suggestions. The service uses third-party AI providers (including OpenAI)
                to process your queries.
              </p>
            </div>

            <div>
              <h3 className="text-foreground font-semibold mb-1">User Responsibilities</h3>
              <p>
                You are solely responsible for the content you submit, including SQL queries and
                schema definitions. Do not submit content containing sensitive credentials, PII,
                or data subject to regulatory restrictions unless you have confirmed compliance with
                your organization's policies.
              </p>
            </div>

            <div>
              <h3 className="text-foreground font-semibold mb-1">No Warranty</h3>
              <p>
                QueryFlow is provided "as is" without warranties of any kind. AI-generated analysis
                and suggestions may be incorrect or incomplete. Always review and validate suggestions
                before applying them to production systems.
              </p>
            </div>

            <div>
              <h3 className="text-foreground font-semibold mb-1">Limitation of Liability</h3>
              <p>
                QueryFlow and its creators shall not be liable for any damages arising from the use
                or inability to use the service, including but not limited to data loss, security
                breaches, or incorrect query suggestions.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-full mt-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            I Understand
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data Policy Modal
// ---------------------------------------------------------------------------

function DataPolicyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const el = dialogRef.current;
    if (el) el.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab" || !el) return;
      const focusable = el.querySelectorAll<HTMLElement>(
        'button, a[href], [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="data-policy-title"
        tabIndex={-1}
        className="bg-card border border-border rounded-xl shadow-2xl max-w-lg w-full mx-4 max-h-[80vh] overflow-auto outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            <h2 id="data-policy-title" className="text-lg font-bold">How We Handle Your Data</h2>
          </div>

          <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
            <div>
              <h3 className="text-foreground font-semibold mb-1 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-emerald-500" />
                Encryption at Rest
              </h3>
              <p>
                All data stored in QueryFlow — including your SQL queries, schemas, voice context, and
                analysis feedback — is encrypted at rest using AES-256 encryption via the database
                provider's built-in encryption layer. Backups are also encrypted. Your data is never
                stored in plaintext on disk.
              </p>
            </div>

            <div>
              <h3 className="text-foreground font-semibold mb-1 flex items-center gap-1.5">
                <ExternalLink className="w-3.5 h-3.5 text-amber-500" />
                AI Processing via OpenAI
              </h3>
              <p>
                QueryFlow sends your SQL queries, schema definitions, and associated context to
                OpenAI's API for analysis, formatting, and query generation. This means your SQL
                content is transmitted to and processed by OpenAI's servers. By using QueryFlow's
                AI features, you acknowledge and consent to this data transmission.
              </p>
              <p className="mt-1.5">
                OpenAI's data usage policy applies to content sent through their API. We recommend
                reviewing <a href="https://openai.com/policies/api-data-usage-policies" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">OpenAI's API data usage policies</a> to
                understand how they handle data received via their API.
              </p>
            </div>

            <div>
              <h3 className="text-foreground font-semibold mb-1">Your Responsibility</h3>
              <p>
                You are responsible for determining whether your SQL queries and schema data are
                appropriate to process through third-party AI services. Do not submit queries
                containing sensitive credentials, personally identifiable information (PII), or
                data subject to regulatory restrictions (HIPAA, GDPR, etc.) unless you have
                confirmed compliance with your organization's data policies.
              </p>
            </div>

            <div>
              <h3 className="text-foreground font-semibold mb-1">Data Retention</h3>
              <p>
                Your queries and schemas are stored only in your QueryFlow account database.
                You can delete any query, schema, or context at any time. Deletion is permanent
                and immediate from our database. Data previously sent to OpenAI for processing
                is subject to OpenAI's retention policies.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-full mt-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            I Understand
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Waterfall Detail Panel — right sidebar for visual tab
// ---------------------------------------------------------------------------

const EDGE_TYPE_LABELS: Record<string, { label: string; colorClass: string }> = {
  join:           { label: "JOIN",            colorClass: "bg-blue-500/10 text-blue-500 border-blue-500/30" },
  create_insert:  { label: "CREATE / INSERT", colorClass: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30" },
  cte_definition: { label: "CTE",            colorClass: "bg-purple-500/10 text-purple-500 border-purple-500/30" },
  subquery_ref:   { label: "SUBQUERY",        colorClass: "bg-amber-500/10 text-amber-500 border-amber-500/30" },
  select_from:    { label: "SELECT",          colorClass: "bg-muted text-muted-foreground" },
};

function WaterfallDetailPanel({
  selectedEdge,
  analysis,
}: {
  selectedEdge: import("@shared/waterfall").WaterfallEdge | null;
  analysis: import("@shared/waterfall").WaterfallAnalysis | null;
}) {
  if (!selectedEdge || !analysis) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground px-6 text-center">
        <Boxes className="w-8 h-8 mb-3 opacity-40" />
        <p className="text-sm font-medium">Flow Detail</p>
        <p className="text-xs mt-1 opacity-60">
          Hover or click a connector in the waterfall to see the SQL statement
          that moves data between tables.
        </p>
      </div>
    );
  }

  const fromNode = analysis.nodes.find((n) => n.id === selectedEdge.fromNodeId);
  const toNode = analysis.nodes.find((n) => n.id === selectedEdge.toNodeId);
  const edgeMeta = EDGE_TYPE_LABELS[selectedEdge.edgeType] || EDGE_TYPE_LABELS.select_from;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-2 mb-2">
          <Badge
            variant="outline"
            className={`text-[10px] h-5 px-2 ${edgeMeta.colorClass}`}
          >
            {edgeMeta.label}
          </Badge>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="font-mono font-semibold text-foreground">
            {fromNode?.name || "?"}
          </span>
          <span className="text-muted-foreground">→</span>
          <span className="font-mono font-semibold text-foreground">
            {toNode?.name || "?"}
          </span>
        </div>
      </div>

      {/* SQL statement */}
      <div className="flex-1 overflow-auto p-4">
        {selectedEdge.joinDetails && (
          <div className="mb-3">
            <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Join Condition
            </h4>
            <p className="text-xs font-mono text-foreground bg-muted/50 rounded px-2 py-1">
              {selectedEdge.joinDetails}
            </p>
          </div>
        )}
        <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
          SQL Statement
        </h4>
        <pre className="text-xs font-mono text-foreground bg-muted/50 rounded p-3 whitespace-pre-wrap break-words overflow-auto max-h-[60vh] border border-border">
          {selectedEdge.sqlStatement || "No SQL captured for this connection."}
        </pre>
      </div>
    </div>
  );
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

  // --- landing page modals ---
  const [showTos, setShowTos] = useState(false);
  const [showDataPolicy, setShowDataPolicy] = useState(false);

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

  // Waterfall flow state (for visual tab)
  const [waterfallAnalysis, setWaterfallAnalysis] = useState<import("@shared/waterfall").WaterfallAnalysis | null>(null);
  const [selectedWaterfallEdge, setSelectedWaterfallEdge] = useState<import("@shared/waterfall").WaterfallEdge | null>(null);

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
          /* ── Full-viewport landing page for unauthenticated users — no scroll ── */
          <div className="h-full flex flex-col bg-background overflow-hidden">
            {/* Main content — fills available space, centered */}
            <div className="flex-1 flex flex-col items-center justify-center px-6 min-h-0">
              <div className="max-w-5xl w-full space-y-6">
                {/* Hero */}
                <div className="text-center space-y-4">
                  <div className="inline-flex p-3 rounded-2xl bg-gradient-to-br from-primary/10 to-purple-600/10 border border-primary/10">
                    <FileCode2 className="w-10 h-10 text-primary" />
                  </div>

                  <h1 className="text-2xl md:text-3xl font-bold text-foreground tracking-tight">
                    Your SQL Query Analyzer
                  </h1>

                  <p className="text-sm md:text-base text-muted-foreground max-w-2xl mx-auto leading-relaxed">
                    QueryFlow challenges you to write better SQL. Multi-agent AI analysis catches bugs,
                    performance issues, and security risks — you stay in complete control of every decision.
                  </p>

                  <Button
                    onClick={handleDemoBootstrap}
                    disabled={demoMutation.isPending}
                    className="h-10 px-8 text-sm gap-2 rounded-full shadow-lg hover:shadow-primary/25 hover:-translate-y-0.5 transition-all duration-300 bg-gradient-to-r from-primary to-purple-600 text-primary-foreground font-semibold"
                  >
                    {demoMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Generating flawed query...
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4" />
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
                <div className="grid md:grid-cols-2 gap-3 max-w-4xl mx-auto">
                  <div className="rounded-lg border border-destructive/20 bg-card overflow-hidden">
                    <div className="px-3 py-1.5 bg-destructive/10 border-b border-destructive/20">
                      <p className="text-xs font-semibold text-destructive flex items-center gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5" /> Before — Common Mistakes
                      </p>
                    </div>
                    <pre className="p-3 text-[11px] font-mono text-muted-foreground leading-relaxed overflow-x-auto whitespace-pre">
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
                    <div className="px-3 py-1.5 bg-emerald-500/10 border-b border-emerald-500/20">
                      <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5" /> After — With QueryFlow Fixes
                      </p>
                    </div>
                    <pre className="p-3 text-[11px] font-mono text-muted-foreground leading-relaxed overflow-x-auto whitespace-pre">
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
                <div className="grid md:grid-cols-3 gap-4 max-w-4xl mx-auto">
                  {([
                    {
                      icon: Database,
                      title: "Schema Context",
                      desc: "Add voice or text annotations at the schema, table, or column level so AI analysis deeply understands your data model.",
                      color: "text-cyan-500",
                    },
                    {
                      icon: Sparkles,
                      title: "AI Analysis",
                      desc: "Multi-agent analyzer that challenges you to improve every query. Catch bugs, performance issues, and security risks.",
                      color: "text-primary",
                    },
                    {
                      icon: Boxes,
                      title: "Visual Explorer",
                      desc: "Visualize stored procedures and queries. Complete lineage tracking with a dynamic visual query editor.",
                      color: "text-emerald-500",
                    },
                  ] as const).map((feat) => {
                    const Icon = feat.icon;
                    return (
                      <div key={feat.title} className="p-4 rounded-xl border border-border bg-card/50 space-y-2">
                        <div className="p-2 rounded-lg bg-accent/50 w-fit">
                          <Icon className={`w-4 h-4 ${feat.color}`} />
                        </div>
                        <h3 className="text-xs font-semibold text-foreground">{feat.title}</h3>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">{feat.desc}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Footer — pinned to bottom, never scrolled */}
            <footer className="flex-shrink-0 border-t border-border/30 px-6 py-2.5">
              <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground/60">
                <p>&copy; {new Date().getFullYear()} QueryFlow. All rights reserved.</p>
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => setShowTos(true)}
                    className="hover:text-foreground transition-colors underline-offset-2 hover:underline"
                  >
                    Terms of Service
                  </button>
                  <span className="text-muted-foreground/20">|</span>
                  <button
                    onClick={() => setShowDataPolicy(true)}
                    className="hover:text-foreground transition-colors underline-offset-2 hover:underline"
                  >
                    Data Handling &amp; Privacy
                  </button>
                </div>
              </div>
            </footer>

            <TermsOfServiceModal open={showTos} onClose={() => setShowTos(false)} />
            <DataPolicyModal open={showDataPolicy} onClose={() => setShowDataPolicy(false)} />
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
                    dialect={detectedDialect}
                    onEdgeSelect={setSelectedWaterfallEdge}
                    selectedEdgeId={selectedWaterfallEdge?.id ?? null}
                    onAnalysisComplete={setWaterfallAnalysis}
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
                      dialect={detectedDialect}
                      onEdgeSelect={setSelectedWaterfallEdge}
                      selectedEdgeId={selectedWaterfallEdge?.id ?? null}
                      onAnalysisComplete={setWaterfallAnalysis}
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
                <WaterfallDetailPanel
                  selectedEdge={selectedWaterfallEdge}
                  analysis={waterfallAnalysis}
                />
              )}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
        )}
      </div>
    </div>
  );
}
