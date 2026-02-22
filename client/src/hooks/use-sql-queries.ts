import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, buildUrl } from "@shared/routes";
import type { SqlQuery, InsertSqlQuery, UpdateSqlQuery, QueryFeedbackRow, AgentSettings, UserSchema, ParsedTable, SchemaVoiceContext } from "@shared/schema";

// ─── SQL Queries ─────────────────────────────────────────────────────

export function useSqlQueries() {
  return useQuery<SqlQuery[]>({
    queryKey: ["sql-queries"],
    queryFn: async () => {
      const res = await fetch(api.sqlQueries.list.path);
      if (!res.ok) throw new Error("Failed to fetch SQL queries");
      return res.json();
    },
  });
}

export function useSqlQuery(id: number | null) {
  return useQuery<SqlQuery>({
    queryKey: ["sql-queries", id],
    queryFn: async () => {
      const res = await fetch(buildUrl(api.sqlQueries.get.path, { id: id! }));
      if (!res.ok) throw new Error("Failed to fetch SQL query");
      return res.json();
    },
    enabled: id !== null,
  });
}

export function useCreateSqlQuery() {
  const queryClient = useQueryClient();
  return useMutation<SqlQuery, Error, InsertSqlQuery>({
    mutationFn: async (data) => {
      const res = await fetch(api.sqlQueries.create.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create SQL query");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sql-queries"] });
    },
  });
}

export function useUpdateSqlQuery() {
  const queryClient = useQueryClient();
  return useMutation<SqlQuery, Error, { id: number; data: UpdateSqlQuery }>({
    mutationFn: async ({ id, data }) => {
      const res = await fetch(buildUrl(api.sqlQueries.update.path, { id }), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update SQL query");
      return res.json();
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["sql-queries"] });
      queryClient.invalidateQueries({ queryKey: ["sql-queries", id] });
    },
  });
}

export function useDeleteSqlQuery() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, number>({
    mutationFn: async (id) => {
      const res = await fetch(buildUrl(api.sqlQueries.delete.path, { id }), {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete SQL query");
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["sql-queries"] });
      queryClient.removeQueries({ queryKey: ["sql-queries", id] });
      queryClient.removeQueries({ queryKey: ["feedback", id] });
    },
  });
}

// ─── Feedback ────────────────────────────────────────────────────────

export interface ContextBlock {
  key: string;
  label: string;
  content: string;
  itemCount?: number;
  charCount?: number;
  description?: string;
}

export function useAnalysisContext() {
  return useMutation<ContextBlock[], Error, { queryId: number; dialect?: string; content?: string }>({
    mutationFn: async ({ queryId, dialect, content }) => {
      const res = await fetch(buildUrl("/api/sql-queries/:id/analysis-context" as any, { id: queryId }), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dialect, content }),
      });
      if (!res.ok) throw new Error("Failed to fetch analysis context");
      return res.json();
    },
  });
}

export function useQueryFeedback(queryId: number | null) {
  return useQuery<QueryFeedbackRow[]>({
    queryKey: ["feedback", queryId],
    queryFn: async () => {
      const res = await fetch(buildUrl(api.feedback.listByQuery.path, { id: queryId! }));
      if (!res.ok) throw new Error("Failed to fetch feedback");
      return res.json();
    },
    // Disable DB fetch for demo queries (negative IDs) — feedback is held in cache only
    enabled: queryId !== null && queryId > 0,
  });
}

export interface AnalysisProgress {
  step: number;
  total: number;
  label: string;
}

export function useAnalyzeQuery() {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);

  const mutation = useMutation<QueryFeedbackRow[], Error, { queryId: number; dialect?: string; content?: string }>({
    mutationFn: async ({ queryId, dialect, content }) => {
      setProgress({ step: 0, total: 2, label: "Starting analysis" });

      const res = await fetch(buildUrl(api.feedback.analyze.path, { id: queryId }), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dialect, content }),
      });

      if (!res.ok) throw new Error("Failed to analyze query");

      // Read SSE stream for step progress
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let results: QueryFeedbackRow[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events (separated by double newlines)
        const parts = buffer.split("\n\n");
        buffer = parts.pop()!;

        for (const part of parts) {
          const dataLine = part.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          const data = JSON.parse(dataLine.slice(6));
          if (data.step) {
            setProgress({ step: data.step, total: data.total, label: data.label });
          }
          if (data.done) {
            results = data.results;
          }
          if (data.error) {
            throw new Error(data.message || "Analysis failed");
          }
        }
      }

      return results;
    },
    onSuccess: (results, { queryId }) => {
      setProgress(null);
      if (queryId > 0) {
        queryClient.invalidateQueries({ queryKey: ["feedback", queryId] });
      } else {
        // Demo mode: seed feedback cache directly (no DB persistence)
        queryClient.setQueryData(["feedback", queryId], results);
      }
    },
    onError: () => {
      setProgress(null);
    },
  });

  return { ...mutation, progress };
}

export function useResolveFeedback() {
  const queryClient = useQueryClient();
  return useMutation<QueryFeedbackRow, Error, { id: number; queryId: number }>({
    mutationFn: async ({ id }) => {
      const res = await fetch(buildUrl(api.feedback.resolve.path, { id }), {
        method: "PATCH",
      });
      if (!res.ok) throw new Error("Failed to resolve feedback");
      return res.json();
    },
    onSuccess: (_, { queryId }) => {
      queryClient.invalidateQueries({ queryKey: ["feedback", queryId] });
    },
  });
}

export function useDeleteFeedbackItem() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { id: number; queryId: number }>({
    mutationFn: async ({ id }) => {
      const res = await fetch(buildUrl(api.feedback.delete.path, { id }), {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete feedback");
    },
    onSuccess: (_, { queryId }) => {
      queryClient.invalidateQueries({ queryKey: ["feedback", queryId] });
    },
  });
}

export function useDismissFeedback() {
  const queryClient = useQueryClient();
  return useMutation<QueryFeedbackRow, Error, { id: number; queryId: number }>({
    mutationFn: async ({ id }) => {
      const res = await fetch(buildUrl(api.feedback.dismiss.path, { id }), {
        method: "PATCH",
      });
      if (!res.ok) throw new Error("Failed to dismiss feedback");
      return res.json();
    },
    onSuccess: (_, { queryId }) => {
      queryClient.invalidateQueries({ queryKey: ["feedback", queryId] });
    },
  });
}

// ─── Demo Bootstrap ──────────────────────────────────────────────────

export interface DemoBootstrapResult {
  query: { title: string; content: string };
  schema: { name: string; ddl: string; tables: unknown[] };
}

export function useDemoBootstrap() {
  return useMutation<DemoBootstrapResult, Error>({
    mutationFn: async () => {
      const res = await fetch("/api/demo/bootstrap", { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Demo generation failed" }));
        throw new Error(err.message);
      }
      return res.json();
    },
    // No cache invalidation needed — demo data is virtual (not stored in sql_queries/user_schemas)
  });
}

// ─── Format ──────────────────────────────────────────────────────────

export function useFormatQuery() {
  return useMutation<{ formatted: string; notes?: string; llm?: boolean }, Error, { sql: string; dialect?: string }>({
    mutationFn: async ({ sql, dialect }) => {
      const res = await fetch(api.format.formatQuery.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql, dialect }),
      });
      if (!res.ok) throw new Error("Failed to format query");
      return res.json();
    },
  });
}

// ─── Waterfall Flow Analysis ─────────────────────────────────────────

export function useWaterfallAnalysis() {
  return useMutation<
    import("@shared/waterfall").WaterfallMergeResult,
    Error,
    { content: string; dialect?: string; queryId?: number }
  >({
    mutationFn: async ({ content, dialect, queryId }) => {
      const res = await fetch(api.waterfall.analyze.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, dialect, queryId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Waterfall analysis failed" }));
        throw new Error(err.message);
      }
      return res.json();
    },
  });
}

export function useWaterfallData(queryId: number | null | undefined) {
  return useQuery<import("@shared/waterfall").WaterfallAnalysis | null>({
    queryKey: ["waterfall-data", queryId],
    queryFn: async () => {
      if (!queryId) return null;
      const res = await fetch(buildUrl(api.waterfall.get.path, { id: queryId }));
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!queryId,
  });
}

export function useSaveWaterfallData() {
  const queryClient = useQueryClient();
  return useMutation<
    import("@shared/waterfall").WaterfallAnalysis,
    Error,
    { queryId: number; analysis: import("@shared/waterfall").WaterfallAnalysis }
  >({
    mutationFn: async ({ queryId, analysis }) => {
      const res = await fetch(buildUrl(api.waterfall.save.path, { id: queryId }), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(analysis),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Failed to save waterfall data" }));
        throw new Error(err.message);
      }
      return res.json();
    },
    onSuccess: (_data, { queryId }) => {
      queryClient.invalidateQueries({ queryKey: ["waterfall-data", queryId] });
    },
  });
}

// ─── Agent Settings ──────────────────────────────────────────────────

export function useAgentSettings() {
  return useQuery<AgentSettings[]>({
    queryKey: ["agent-settings"],
    queryFn: async () => {
      const res = await fetch(api.agentSettings.list.path);
      if (!res.ok) throw new Error("Failed to fetch agent settings");
      return res.json();
    },
  });
}

export function useUpdateAgentSettings() {
  const queryClient = useQueryClient();
  return useMutation<AgentSettings, Error, { agentType: string; data: { enabled?: boolean; priority?: number } }>({
    mutationFn: async ({ agentType, data }) => {
      const res = await fetch(buildUrl(api.agentSettings.update.path, { agentType }), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update agent settings");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-settings"] });
    },
  });
}

// ─── Ask (LLM Q&A) ──────────────────────────────────────────────────

export function useAskQuestion() {
  return useMutation<{ answer: string }, Error, { question: string; queryContent?: string; dialect?: string }>({
    mutationFn: async (data) => {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Failed to ask question" }));
        throw new Error(err.message);
      }
      return res.json();
    },
  });
}

// ─── Chat Messages (persistent conversations) ──────────────────────

export function useChatMessages() {
  return useQuery<Array<{ id: number; userId: string | null; role: string; content: string; queryId: number | null; createdAt: string }>>({
    queryKey: ["chat-messages"],
    queryFn: async () => {
      const res = await fetch("/api/chat");
      if (!res.ok) throw new Error("Failed to fetch chat messages");
      return res.json();
    },
  });
}

export function useSaveChatMessage() {
  const queryClient = useQueryClient();
  return useMutation<any, Error, { role: "user" | "assistant"; content: string; queryId?: number }>({
    mutationFn: async (data) => {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to save chat message");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-messages"] });
    },
  });
}

export function useClearChatMessages() {
  const queryClient = useQueryClient();
  return useMutation<void, Error>({
    mutationFn: async () => {
      const res = await fetch("/api/chat", { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to clear chat messages");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-messages"] });
    },
  });
}

// ─── User Schemas ────────────────────────────────────────────────────

export function useUserSchemas() {
  return useQuery<UserSchema[]>({
    queryKey: ["schemas"],
    queryFn: async () => {
      const res = await fetch("/api/schemas");
      if (!res.ok) throw new Error("Failed to fetch schemas");
      return res.json();
    },
  });
}

export function useCreateUserSchema() {
  const queryClient = useQueryClient();
  return useMutation<UserSchema, Error, { name: string; rawContent: string; fileName?: string; description?: string }>({
    mutationFn: async (data) => {
      const res = await fetch("/api/schemas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create schema");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["schemas"] });
    },
  });
}

export function useUpdateUserSchema() {
  const queryClient = useQueryClient();
  return useMutation<UserSchema, Error, { id: number; data: { name?: string; rawContent?: string; parsedDdl?: string; tables?: ParsedTable[]; description?: string } }>({
    mutationFn: async ({ id, data }) => {
      const res = await fetch(`/api/schemas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update schema");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["schemas"] });
    },
  });
}

export function useDeleteUserSchema() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, number>({
    mutationFn: async (id) => {
      const res = await fetch(`/api/schemas/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete schema");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["schemas"] });
    },
  });
}

// ─── Schema Voice Context ───────────────────────────────────────────

export function useSchemaVoiceContexts(schemaId: number | null) {
  return useQuery<SchemaVoiceContext[]>({
    queryKey: ["voice-context", schemaId],
    queryFn: async () => {
      const res = await fetch(`/api/schemas/${schemaId}/voice-context`);
      if (!res.ok) throw new Error("Failed to fetch voice contexts");
      return res.json();
    },
    enabled: schemaId !== null,
  });
}

export function useUpsertSchemaVoiceContext() {
  const queryClient = useQueryClient();
  return useMutation<SchemaVoiceContext, Error, {
    schemaId: number;
    targetType: "schema" | "table" | "column";
    targetTable?: string | null;
    targetColumn?: string | null;
    transcript: string;
  }>({
    mutationFn: async ({ schemaId, ...data }) => {
      const res = await fetch(`/api/schemas/${schemaId}/voice-context`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to save voice context");
      return res.json();
    },
    onSuccess: (_, { schemaId }) => {
      queryClient.invalidateQueries({ queryKey: ["voice-context", schemaId] });
    },
  });
}

export function useDeleteSchemaVoiceContext() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { schemaId: number; id: number }>({
    mutationFn: async ({ schemaId, id }) => {
      const res = await fetch(`/api/schemas/${schemaId}/voice-context/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete voice context");
    },
    onSuccess: (_, { schemaId }) => {
      queryClient.invalidateQueries({ queryKey: ["voice-context", schemaId] });
    },
  });
}

export function useVoiceToQuery() {
  return useMutation<{ title: string; content: string }, Error, { transcript: string; dialect?: string }>({
    mutationFn: async (data) => {
      const res = await fetch("/api/voice-to-query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Failed to generate query" }));
        throw new Error(err.message);
      }
      return res.json();
    },
  });
}

export function useTranscribeAudio() {
  return useMutation<{ transcript: string }, Error, { schemaId: number; audio: string }>({
    mutationFn: async ({ schemaId, audio }) => {
      const res = await fetch(`/api/schemas/${schemaId}/voice-context/transcribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio }),
      });
      if (!res.ok) throw new Error("Failed to transcribe audio");
      return res.json();
    },
  });
}
