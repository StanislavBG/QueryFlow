import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import type { SqlQuery, InsertSqlQuery, UpdateSqlQuery, QueryFeedbackRow, AgentSettings, FormattingRule } from "@shared/schema";

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sql-queries"] });
    },
  });
}

// ─── Feedback ────────────────────────────────────────────────────────

export function useQueryFeedback(queryId: number | null) {
  return useQuery<QueryFeedbackRow[]>({
    queryKey: ["feedback", queryId],
    queryFn: async () => {
      const res = await fetch(buildUrl(api.feedback.listByQuery.path, { id: queryId! }));
      if (!res.ok) throw new Error("Failed to fetch feedback");
      return res.json();
    },
    enabled: queryId !== null,
  });
}

export function useAnalyzeQuery() {
  const queryClient = useQueryClient();
  return useMutation<QueryFeedbackRow[], Error, number>({
    mutationFn: async (queryId) => {
      const res = await fetch(buildUrl(api.feedback.analyze.path, { id: queryId }), {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to analyze query");
      return res.json();
    },
    onSuccess: (_, queryId) => {
      queryClient.invalidateQueries({ queryKey: ["feedback", queryId] });
    },
  });
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

// ─── Format ──────────────────────────────────────────────────────────

export function useFormatQuery() {
  return useMutation<{ formatted: string }, Error, string>({
    mutationFn: async (sql) => {
      const res = await fetch(api.format.formatQuery.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql }),
      });
      if (!res.ok) throw new Error("Failed to format query");
      return res.json();
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

// ─── Formatting Rules ────────────────────────────────────────────────

export function useFormattingRules() {
  return useQuery<FormattingRule[]>({
    queryKey: ["formatting-rules"],
    queryFn: async () => {
      const res = await fetch(api.formattingRules.list.path);
      if (!res.ok) throw new Error("Failed to fetch formatting rules");
      return res.json();
    },
  });
}

export function useUpdateFormattingRule() {
  const queryClient = useQueryClient();
  return useMutation<FormattingRule, Error, { name: string; data: { enabled?: boolean; value?: string } }>({
    mutationFn: async ({ name, data }) => {
      const res = await fetch(buildUrl(api.formattingRules.update.path, { name }), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update formatting rule");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["formatting-rules"] });
    },
  });
}
