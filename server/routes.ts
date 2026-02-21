import type { Express } from "express";
import type { Server } from "http";
import { clerkMiddleware, getAuth } from "@clerk/express";
import { storage } from "./storage";
import { api, buildUrl } from "@shared/routes";
import { z } from "zod";
import { formatSQL } from "./formatter";
import { isLLMConfigured, llmFormatQuery, llmAnalyzeQuery, llmValidateRecommendations, llmAskQuestion, llmParseSchema } from "./llm";
import { requireAdmin, resolveAppUser, logActivity } from "./auth";

// All available analysis categories
const ALL_CATEGORIES = ["structure", "optimization", "error", "style", "formatting", "documentation"] as const;
type AnalysisCategory = typeof ALL_CATEGORIES[number];

// Descriptions used for agent settings seeding and UI
export const CATEGORY_DESCRIPTIONS: Record<AnalysisCategory, { name: string; description: string }> = {
  structure: {
    name: "Structure",
    description: "Query structure, nesting depth, complexity, and readability.",
  },
  optimization: {
    name: "Performance",
    description: "Performance patterns, index usage, and query efficiency.",
  },
  error: {
    name: "Correctness",
    description: "Potential SQL bugs, typos, and syntax issues.",
  },
  style: {
    name: "Style",
    description: "Keyword casing, naming conventions, and coding consistency.",
  },
  formatting: {
    name: "Formatting",
    description: "Whitespace, line breaks, alignment, and visual layout.",
  },
  documentation: {
    name: "Documentation",
    description: "Comments, query purpose clarity, and team maintainability.",
  },
};

import type { UserSchema } from "@shared/schema";

/** Build schema context string for LLM prompts, including descriptions as SQL comments. */
function buildSchemaContext(schemas: UserSchema[]): string | undefined {
  if (schemas.length === 0) return undefined;
  const combined = schemas.map(s => {
    const parts: string[] = [];
    if (s.description) {
      parts.push(s.description.split('\n').map(l => `-- ${l}`).join('\n'));
    }
    if (s.parsedDdl) parts.push(s.parsedDdl);
    return parts.join('\n');
  }).filter(s => s.length > 0).join('\n\n');
  return combined || undefined;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.use(clerkMiddleware({
    publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    secretKey: process.env.CLERK_SECRET_KEY,
  }));

  // ─── Document Routes ───────────────────────────────────────────────

  app.get(api.documents.list.path, async (req, res) => {
    const docs = await storage.getDocuments();
    res.json(docs);
  });

  app.post(api.documents.create.path, async (req, res) => {
    try {
      const input = api.documents.create.input.parse(req.body);
      const doc = await storage.createDocument(input);
      res.status(201).json(doc);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  // ─── SQL Query Routes ──────────────────────────────────────────────

  app.get(api.sqlQueries.list.path, async (req, res) => {
    const { userId } = getAuth(req);
    const queries = await storage.getSqlQueries(userId || undefined);
    res.json(queries);
  });

  app.get("/api/sql-queries/:id", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ message: "Invalid query ID" });
    }
    const query = await storage.getSqlQuery(id);
    if (!query) {
      return res.status(404).json({ message: "Query not found" });
    }
    res.json(query);
  });

  app.post(api.sqlQueries.create.path, async (req, res) => {
    try {
      const input = api.sqlQueries.create.input.parse(req.body);
      const { userId } = getAuth(req);
      if (userId) resolveAppUser(req).catch(() => {});
      const query = await storage.createSqlQuery({ ...input, userId: userId || null });
      logActivity(userId, "query.create", "query", query.id);
      res.status(201).json(query);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  app.patch("/api/sql-queries/:id", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ message: "Invalid query ID" });
    }
    try {
      const input = api.sqlQueries.update.input.parse(req.body);
      const query = await storage.updateSqlQuery(id, input);
      if (!query) {
        return res.status(404).json({ message: "Query not found" });
      }

      // Auto-clear feedback when query content is cleared
      if (input.content !== undefined && input.content.trim() === "") {
        await storage.deleteFeedbackByQueryId(id);
      }

      res.json(query);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  app.delete("/api/sql-queries/:id", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ message: "Invalid query ID" });
    }
    const deleted = await storage.deleteSqlQuery(id);
    if (!deleted) {
      return res.status(404).json({ message: "Query not found" });
    }
    res.json({ message: "Query deleted" });
  });

  // ─── Feedback Routes ───────────────────────────────────────────────

  app.get("/api/sql-queries/:id/feedback", async (req, res) => {
    const queryId = parseInt(req.params.id, 10);
    if (isNaN(queryId)) {
      return res.status(400).json({ message: "Invalid query ID" });
    }
    const feedback = await storage.getFeedbackByQueryId(queryId);
    res.json(feedback);
  });

  app.post("/api/sql-queries/:id/analyze", async (req, res) => {
    const queryId = parseInt(req.params.id, 10);
    if (isNaN(queryId)) {
      return res.status(400).json({ message: "Invalid query ID" });
    }

    const query = await storage.getSqlQuery(queryId);
    if (!query) {
      return res.status(404).json({ message: "Query not found" });
    }

    if (!query.content.trim()) {
      return res.json([]);
    }

    if (!isLLMConfigured()) {
      return res.status(503).json({
        message: "LLM not configured. Set AI_INTEGRATIONS_OPENAI_API_KEY to enable analysis.",
      });
    }

    const { userId: analysisUserId } = getAuth(req);
    logActivity(analysisUserId, "query.analyze", "query", queryId);

    const dialect = req.body.dialect || "Standard SQL";

    // Determine which categories are enabled
    const allSettings = await storage.getAgentSettings();
    const enabledCategories = allSettings.length > 0
      ? allSettings.filter(s => s.enabled).map(s => s.agentType)
      : [...ALL_CATEGORIES];

    // Gather schema context
    const schemas = await storage.getUserSchemas();
    const schemaContext = buildSchemaContext(schemas);

    // Gather document context
    const docs = await storage.getDocuments();
    const docContext = docs.length > 0
      ? docs.map(d => d.content).join("\n\n---\n\n")
      : undefined;

    // Gather previously resolved feedback as preference signal.
    // Resolved items represent patterns the user has already reviewed —
    // the LLM should not flag the same patterns again.
    const existingFeedback = await storage.getFeedbackByQueryId(queryId);
    const resolvedFeedback = existingFeedback
      .filter(f => f.isResolved)
      .map(f => ({ title: f.title, suggestion: f.suggestion }));

    // Clear only unresolved feedback; keep resolved items as a persistent
    // dismissal record so context survives across multiple analyses.
    const unresolvedIds = existingFeedback.filter(f => !f.isResolved).map(f => f.id);
    for (const uid of unresolvedIds) {
      await storage.deleteFeedbackById(uid);
    }

    try {
      // Step 1: Generate recommendations
      const llmResults = await llmAnalyzeQuery(query.content, {
        dialect,
        schemas: schemaContext,
        documents: docContext,
        acceptedFeedback: resolvedFeedback.length > 0 ? resolvedFeedback : undefined,
        enabledCategories,
      });

      // Step 2: QA validation – remove suggestions that would silently
      // change semantics, logic, or degrade performance. Bug-fix
      // suggestions are kept but flagged for user review.
      const validated = await llmValidateRecommendations(
        query.content,
        llmResults,
        dialect
      );

      const feedbackItems = validated.map(r => ({
        queryId,
        agentType: r.agentType,
        severity: r.severity,
        title: r.title,
        message: r.message,
        suggestion: r.suggestion ?? null,
        lineNumber: r.lineNumber ?? null,
        isResolved: false,
      }));

      const created = await storage.createFeedbackBatch(feedbackItems);
      res.json(created);
    } catch (err) {
      console.error("LLM analysis failed:", err);
      res.status(500).json({ message: "Analysis failed. Please try again." });
    }
  });

  app.patch("/api/feedback/:id/resolve", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ message: "Invalid feedback ID" });
    }
    const feedback = await storage.resolveFeedback(id);
    if (!feedback) {
      return res.status(404).json({ message: "Feedback not found" });
    }
    res.json(feedback);
  });

  // ─── Format Route (LLM-powered with local fallback) ────────────────

  app.post(api.format.formatQuery.path, async (req, res) => {
    try {
      const input = api.format.formatQuery.input.parse(req.body);
      const dialect = req.body.dialect || "Standard SQL";

      const { userId: fmtUserId } = getAuth(req);
      logActivity(fmtUserId, "format.run", "format");

      if (isLLMConfigured()) {
        // Gather schemas for context
        const schemas = await storage.getUserSchemas();
        const schemaContext = schemas.length > 0
          ? schemas.map(s => s.parsedDdl).filter(Boolean).join("\n\n")
          : undefined;

        const result = await llmFormatQuery(input.sql, dialect, schemaContext);
        res.json({ formatted: result.formatted, notes: result.notes, llm: true });
      } else {
        // Fallback to local formatter
        const formatted = formatSQL(input.sql);
        res.json({ formatted, notes: "", llm: false });
      }
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      // If LLM fails, fallback to local formatter
      try {
        const input = z.object({ sql: z.string() }).parse(req.body);
        const formatted = formatSQL(input.sql);
        res.json({ formatted, notes: "LLM unavailable, used local formatter.", llm: false });
      } catch {
        throw err;
      }
    }
  });

  // ─── Agent Settings Routes ─────────────────────────────────────────

  app.get(api.agentSettings.list.path, async (req, res) => {
    const settings = await storage.getAgentSettings();
    res.json(settings);
  });

  app.patch("/api/agent-settings/:agentType", async (req, res) => {
    const { agentType } = req.params;
    try {
      const input = api.agentSettings.update.input.parse(req.body);
      const settings = await storage.updateAgentSettings(agentType, input);
      if (!settings) {
        return res.status(404).json({ message: "Agent settings not found" });
      }
      res.json(settings);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  // ─── Ask Route (LLM Q&A) ─────────────────────────────────────────

  app.post("/api/ask", async (req, res) => {
    try {
      const input = z.object({
        question: z.string().min(1),
        queryContent: z.string().optional(),
        dialect: z.string().optional(),
      }).parse(req.body);

      if (!isLLMConfigured()) {
        return res.status(503).json({
          message: "LLM not configured. Set AI_INTEGRATIONS_OPENAI_API_KEY in your environment.",
        });
      }

      const { userId: askUserId } = getAuth(req);
      logActivity(askUserId, "chat.ask", "chat");

      // Gather schema context
      const schemas = await storage.getUserSchemas();
      const schemaContext = schemas.length > 0
        ? schemas.map(s => s.parsedDdl).filter(Boolean).join("\n\n")
        : undefined;

      const answer = await llmAskQuestion(
        input.question,
        input.queryContent,
        schemaContext,
        input.dialect
      );

      res.json({ answer });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      console.error("Ask endpoint error:", err);
      res.status(500).json({ message: "Failed to process question." });
    }
  });

  // ─── User Schema Routes ─────────────────────────────────────────────

  app.get("/api/schemas", async (req, res) => {
    const { userId } = getAuth(req);
    const schemas = await storage.getUserSchemas(userId || undefined);
    res.json(schemas);
  });

  app.get("/api/schemas/:id", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid schema ID" });
    const schema = await storage.getUserSchema(id);
    if (!schema) return res.status(404).json({ message: "Schema not found" });
    res.json(schema);
  });

  app.post("/api/schemas", async (req, res) => {
    try {
      const input = z.object({
        name: z.string().min(1),
        rawContent: z.string().min(1),
        fileName: z.string().optional(),
        description: z.string().optional(),
      }).parse(req.body);

      const { userId } = getAuth(req);

      let parsedDdl = input.rawContent;
      let tables: Array<{ name: string; columns: string[] }> = [];
      let parseError: string | undefined;

      // Always use LLM for schema parsing (per CLAUDE.md: all parsers must be LLM-based)
      if (isLLMConfigured()) {
        try {
          const result = await llmParseSchema(input.rawContent, input.fileName || "schema.sql");
          parsedDdl = result.parsed;
          tables = result.tables;
          if (result.error) parseError = result.error;
        } catch (err) {
          parseError = `LLM schema parsing failed: ${err instanceof Error ? err.message : String(err)}`;
          console.error("[schema-route]", parseError, err);
        }
      } else {
        parseError = "LLM not configured. Set AI_INTEGRATIONS_OPENAI_API_KEY to enable schema parsing.";
        console.warn("[schema-route]", parseError);
      }

      const schema = await storage.createUserSchema({
        name: input.name,
        rawContent: input.rawContent,
        parsedDdl,
        tables,
        fileName: input.fileName ?? null,
        userId: userId || null,
        description: input.description ?? "",
      });

      logActivity(userId, "schema.upload", "schema", schema.id);
      res.status(201).json({ ...schema, parseError });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.patch("/api/schemas/:id", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid schema ID" });
    try {
      const input = z.object({
        name: z.string().min(1).optional(),
        rawContent: z.string().optional(),
        parsedDdl: z.string().optional(),
        tables: z.array(z.object({ name: z.string(), columns: z.array(z.string()) })).optional(),
        description: z.string().optional(),
      }).parse(req.body);

      // If rawContent changes and LLM is available, re-parse
      if (input.rawContent && isLLMConfigured()) {
        try {
          const result = await llmParseSchema(input.rawContent, "schema.sql");
          input.parsedDdl = result.parsed;
          input.tables = result.tables;
        } catch (err) {
          console.error("LLM schema re-parse failed:", err);
        }
      }

      const schema = await storage.updateUserSchema(id, input);
      if (!schema) return res.status(404).json({ message: "Schema not found" });
      res.json(schema);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.delete("/api/schemas/:id", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid schema ID" });
    const deleted = await storage.deleteUserSchema(id);
    if (!deleted) return res.status(404).json({ message: "Schema not found" });
    res.json({ message: "Schema deleted" });
  });

  // ─── Chat Message Routes ────────────────────────────────────────────

  app.get("/api/chat", async (req, res) => {
    const { userId } = getAuth(req);
    const messages = await storage.getChatMessages(userId || undefined);
    res.json(messages);
  });

  app.post("/api/chat", async (req, res) => {
    try {
      const input = z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1),
        queryId: z.number().optional(),
      }).parse(req.body);

      const { userId } = getAuth(req);
      const message = await storage.createChatMessage({
        ...input,
        userId: userId || null,
        queryId: input.queryId ?? null,
      });
      res.status(201).json(message);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.delete("/api/chat", async (req, res) => {
    const { userId } = getAuth(req);
    await storage.clearChatMessages(userId || undefined);
    res.json({ message: "Chat history cleared" });
  });

  // ─── Current User (RBAC) ─────────────────────────────────────────

  app.get("/api/me", async (req, res) => {
    const user = await resolveAppUser(req);
    if (!user) return res.json({ authenticated: false });
    res.json({ authenticated: true, ...user });
  });

  // ─── Admin Routes ──────────────────────────────────────────────────

  // List all users
  app.get("/api/admin/users", requireAdmin, async (_req, res) => {
    const users = await storage.getAllAppUsers();
    res.json(users);
  });

  // Per-user metrics (activity counts by action)
  app.get("/api/admin/users/:clerkId/metrics", requireAdmin, async (req, res) => {
    const clerkId = req.params.clerkId as string;
    const events = await storage.getActivityEvents({ userId: clerkId, limit: 5000 });
    // Group by action
    const byAction: Record<string, number> = {};
    for (const e of events) {
      byAction[e.action] = (byAction[e.action] || 0) + 1;
    }
    // Daily activity (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const dailyCounts: Record<string, number> = {};
    for (const e of events) {
      const d = e.createdAt ? new Date(e.createdAt).toISOString().slice(0, 10) : null;
      if (d && new Date(d) >= thirtyDaysAgo) {
        dailyCounts[d] = (dailyCounts[d] || 0) + 1;
      }
    }
    res.json({ clerkId, totalEvents: events.length, byAction, dailyCounts });
  });

  // Global activity feed
  app.get("/api/admin/activity", requireAdmin, async (req, res) => {
    const limit = parseInt(req.query.limit as string) || 200;
    const offset = parseInt(req.query.offset as string) || 0;
    const events = await storage.getActivityEvents({ limit, offset });
    const total = await storage.getActivityCount();
    res.json({ events, total });
  });

  // Adoption dashboard: aggregate metrics across all users
  app.get("/api/admin/adoption", requireAdmin, async (_req, res) => {
    const users = await storage.getAllAppUsers();
    const totalUsers = users.length;

    // Compute feature adoption: per action, how many unique users + total uses
    const allEvents = await storage.getActivityEvents({ limit: 50000 });
    const featureAdoption: Record<string, { uniqueUsers: Set<string>; count: number }> = {};
    const userEventCounts: Record<string, number> = {};

    for (const e of allEvents) {
      if (!featureAdoption[e.action]) {
        featureAdoption[e.action] = { uniqueUsers: new Set(), count: 0 };
      }
      featureAdoption[e.action].count++;
      if (e.userId) {
        featureAdoption[e.action].uniqueUsers.add(e.userId);
        userEventCounts[e.userId] = (userEventCounts[e.userId] || 0) + 1;
      }
    }

    // Serialize
    const features = Object.entries(featureAdoption).map(([action, data]) => ({
      action,
      uniqueUsers: data.uniqueUsers.size,
      totalUses: data.count,
      adoptionRate: totalUsers > 0 ? Math.round((data.uniqueUsers.size / totalUsers) * 100) : 0,
    }));

    // Per-user summary for adoption table
    const perUser = users.map(u => ({
      clerkId: u.clerkId,
      email: u.email,
      displayName: u.displayName,
      role: u.role,
      firstSeen: u.firstSeen,
      lastActive: u.lastActive,
      totalActions: userEventCounts[u.clerkId] || 0,
    }));

    // Signups over time (by day)
    const signupsByDay: Record<string, number> = {};
    for (const u of users) {
      const d = u.firstSeen ? new Date(u.firstSeen).toISOString().slice(0, 10) : "unknown";
      signupsByDay[d] = (signupsByDay[d] || 0) + 1;
    }

    res.json({ totalUsers, totalEvents: allEvents.length, features, perUser, signupsByDay });
  });

  // ─── Seed Data ─────────────────────────────────────────────────────

  // Seed documents
  storage.getDocuments().then(async (docs) => {
    if (docs.length === 0) {
      await storage.createDocument({ content: "Hello, World!", contentType: "text" });
      await storage.createDocument({ content: '{"message": "Hello World"}', contentType: "json" });
      await storage.createDocument({ content: "# Hello World\n\nThis is markdown.", contentType: "md" });
    }
  }).catch(console.error);

  // Seed agent settings for all analysis categories
  storage.getAgentSettings().then(async (settings) => {
    const existingTypes = new Set(settings.map(s => s.agentType));
    for (const category of ALL_CATEGORIES) {
      if (!existingTypes.has(category)) {
        await storage.upsertAgentSettings({
          agentType: category,
          enabled: true,
          priority: category === "error" ? 3 : category === "optimization" ? 2 : 1,
          config: {},
        });
      }
    }
  }).catch(console.error);

  return httpServer;
}
