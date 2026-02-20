import type { Express } from "express";
import type { Server } from "http";
import { clerkMiddleware } from "@clerk/express";
import { storage } from "./storage";
import { api, buildUrl } from "@shared/routes";
import { z } from "zod";
import { runAgents, AGENT_DESCRIPTIONS, type AgentType } from "./agents";
import { formatSQL } from "./formatter";
import { isLLMConfigured, llmFormatQuery, llmAnalyzeQuery, llmAskQuestion, llmParseSchema } from "./llm";

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
    const queries = await storage.getSqlQueries();
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
      const query = await storage.createSqlQuery(input);
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

    // Get enabled agents from settings
    const allSettings = await storage.getAgentSettings();
    const enabledAgents = allSettings.length > 0
      ? allSettings
          .filter(s => s.enabled)
          .map(s => s.agentType as AgentType)
      : ["structure", "optimization", "error", "style"] as AgentType[];

    const dialect = req.body.dialect || "Standard SQL";

    // Clear previous feedback for this query
    await storage.deleteFeedbackByQueryId(queryId);

    // Run heuristic agents
    const feedbackItems = runAgents(queryId, query.content, enabledAgents);

    // Run LLM documentation analysis in parallel if configured
    let llmFeedbackItems: typeof feedbackItems = [];
    if (isLLMConfigured()) {
      try {
        const schemas = await storage.getUserSchemas();
        const schemaContext = schemas.length > 0
          ? schemas.map(s => s.parsedDdl).filter(Boolean).join("\n\n")
          : undefined;

        const docResults = await llmAnalyzeQuery(query.content, dialect, schemaContext);
        llmFeedbackItems = docResults.map(r => ({
          queryId,
          agentType: r.agentType || "documentation",
          severity: r.severity || "info",
          title: r.title,
          message: r.message,
          suggestion: r.suggestion ?? null,
          lineNumber: r.lineNumber ?? null,
          isResolved: false,
        }));
      } catch (err) {
        console.error("LLM documentation analysis failed:", err);
      }
    }

    // Store all feedback
    const allFeedback = [...feedbackItems, ...llmFeedbackItems];
    const created = await storage.createFeedbackBatch(allFeedback);

    res.json(created);
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

  // ─── Formatting Rules Routes ───────────────────────────────────────

  app.get(api.formattingRules.list.path, async (req, res) => {
    const rules = await storage.getFormattingRules();
    res.json(rules);
  });

  app.patch("/api/formatting-rules/:name", async (req, res) => {
    const { name } = req.params;
    try {
      const input = api.formattingRules.update.input.parse(req.body);
      const rule = await storage.updateFormattingRule(name, input);
      if (!rule) {
        return res.status(404).json({ message: "Formatting rule not found" });
      }
      res.json(rule);
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
          message: "LLM not configured. Set ANTHROPIC_API_KEY in your environment.",
        });
      }

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

  app.get("/api/schemas", async (_req, res) => {
    const schemas = await storage.getUserSchemas();
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
      }).parse(req.body);

      let parsedDdl = input.rawContent;
      let tables: Array<{ name: string; columns: string[] }> = [];

      // Use LLM to parse raw content into structured schema if available
      if (isLLMConfigured()) {
        try {
          const result = await llmParseSchema(input.rawContent, input.fileName || "schema.sql");
          parsedDdl = result.parsed;
          tables = result.tables;
        } catch (err) {
          console.error("LLM schema parsing failed:", err);
        }
      }

      const schema = await storage.createUserSchema({
        name: input.name,
        rawContent: input.rawContent,
        parsedDdl,
        tables,
        fileName: input.fileName ?? null,
      });

      res.status(201).json(schema);
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

  // ─── Seed Data ─────────────────────────────────────────────────────

  // Seed documents
  storage.getDocuments().then(async (docs) => {
    if (docs.length === 0) {
      await storage.createDocument({ content: "Hello, World!", contentType: "text" });
      await storage.createDocument({ content: '{"message": "Hello World"}', contentType: "json" });
      await storage.createDocument({ content: "# Hello World\n\nThis is markdown.", contentType: "md" });
    }
  }).catch(console.error);

  // Seed a default blank query so the editor is immediately ready for paste
  storage.getSqlQueries().then(async (queries) => {
    if (queries.length === 0) {
      await storage.createSqlQuery({
        title: "Untitled Query",
        content: "",
      });
    }
  }).catch(console.error);

  // Seed agent settings
  storage.getAgentSettings().then(async (settings) => {
    if (settings.length === 0) {
      const agentTypes: AgentType[] = ["structure", "optimization", "error", "style"];
      for (const agentType of agentTypes) {
        const desc = AGENT_DESCRIPTIONS[agentType];
        await storage.upsertAgentSettings({
          agentType,
          enabled: true,
          priority: agentType === "error" ? 3 : agentType === "optimization" ? 2 : 1,
          config: {},
        });
      }
    }
  }).catch(console.error);

  // Seed formatting rules
  storage.getFormattingRules().then(async (rules) => {
    if (rules.length === 0) {
      const defaultRules = [
        { name: "uppercaseKeywords", description: "Convert SQL keywords to UPPERCASE", enabled: true, value: "true" },
        { name: "indentSize", description: "Number of spaces per indentation level", enabled: true, value: "2" },
        { name: "commaPosition", description: "Position of commas: 'trailing' or 'leading'", enabled: true, value: "trailing" },
        { name: "maxLineLength", description: "Maximum characters per line before wrapping", enabled: true, value: "120" },
      ];
      for (const rule of defaultRules) {
        await storage.upsertFormattingRule(rule);
      }
    }
  }).catch(console.error);

  return httpServer;
}
