import { useState, useCallback } from "react";
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
import { FileCode2, Loader2, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export default function Editor() {
  const [selectedQueryId, setSelectedQueryId] = useState<number | null>(null);
  const { data: queries, isLoading: queriesLoading } = useSqlQueries();
  const { data: selectedQuery, isLoading: queryLoading } = useSqlQuery(selectedQueryId);
  const createMutation = useCreateSqlQuery();
  const { toast } = useToast();

  // Auto-select first query if none selected
  if (!selectedQueryId && queries && queries.length > 0 && !queriesLoading) {
    setSelectedQueryId(queries[0].id);
  }

  const handleContentChange = useCallback((_content: string) => {
    // Content changes are handled by the SqlEditor component via auto-save
  }, []);

  const handleCreateFirst = () => {
    createMutation.mutate(
      {
        title: "Example Query",
        content: "SELECT\n  u.id,\n  u.name,\n  u.email,\n  COUNT(o.id) AS order_count\nFROM users u\nLEFT JOIN orders o ON o.user_id = u.id\nWHERE u.active = true\nGROUP BY u.id, u.name, u.email\nORDER BY order_count DESC\nLIMIT 50;",
      },
      {
        onSuccess: (query) => {
          setSelectedQueryId(query.id);
          toast({ title: "Query created", description: "Example query created. Try clicking 'Analyze'!" });
        },
      }
    );
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Top bar */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-card/30 flex-shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="sm" className="h-7 px-2 hover:bg-white/10">
              <ArrowLeft className="w-4 h-4 mr-1" />
              <span className="text-xs">Home</span>
            </Button>
          </Link>
          <div className="h-4 w-px bg-white/10" />
          <div className="flex items-center gap-2">
            <FileCode2 className="w-4 h-4 text-primary" />
            <h1 className="text-sm font-semibold">
              <span className="text-gradient">QueryFlow</span> Editor
            </h1>
          </div>
        </div>
        <SettingsDialog />
      </header>

      {/* Main content */}
      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup direction="horizontal" className="h-full">
          {/* Left sidebar - Query list */}
          <ResizablePanel defaultSize={18} minSize={14} maxSize={30}>
            <div className="h-full border-r border-white/10 bg-card/20">
              <QueryDocumentList
                selectedId={selectedQueryId}
                onSelect={setSelectedQueryId}
              />
            </div>
          </ResizablePanel>

          <ResizableHandle className="w-px bg-white/10 hover:bg-primary/50 transition-colors" />

          {/* Center - SQL Editor */}
          <ResizablePanel defaultSize={52} minSize={30}>
            <div className="h-full">
              {queriesLoading ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
              ) : !queries || queries.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full px-8">
                  <div className="p-4 rounded-full bg-primary/10 mb-4">
                    <FileCode2 className="w-10 h-10 text-primary" />
                  </div>
                  <h2 className="text-lg font-semibold mb-2">No SQL Queries Yet</h2>
                  <p className="text-sm text-muted-foreground text-center mb-6 max-w-md">
                    Create your first SQL query to get started. Our intelligent agents will analyze your queries and provide actionable feedback.
                  </p>
                  <Button
                    onClick={handleCreateFirst}
                    disabled={createMutation.isPending}
                    className="bg-gradient-to-r from-primary to-purple-600"
                  >
                    {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Create Example Query
                  </Button>
                </div>
              ) : queryLoading ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
              ) : selectedQuery ? (
                <SqlEditor
                  query={selectedQuery}
                  onContentChange={handleContentChange}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <p className="text-sm">Select a query from the sidebar</p>
                </div>
              )}
            </div>
          </ResizablePanel>

          <ResizableHandle className="w-px bg-white/10 hover:bg-primary/50 transition-colors" />

          {/* Right panel - Feedback */}
          <ResizablePanel defaultSize={30} minSize={20} maxSize={45}>
            <div className="h-full border-l border-white/10 bg-card/20">
              <FeedbackPanel queryId={selectedQueryId} />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
