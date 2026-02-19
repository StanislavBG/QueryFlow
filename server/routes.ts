import type { Express } from "express";
import type { Server } from "http";
import { clerkMiddleware } from "@clerk/express";
import { storage } from "./storage";
import { api, buildUrl } from "@shared/routes";
import { z } from "zod";
import { runAgents, AGENT_DESCRIPTIONS, type AgentType } from "./agents";
import { formatSQL } from "./formatter";

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

    // Clear previous feedback for this query
    await storage.deleteFeedbackByQueryId(queryId);

    // Run agents
    const feedbackItems = runAgents(queryId, query.content, enabledAgents);

    // Store feedback
    const created = await storage.createFeedbackBatch(feedbackItems);

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

  // ─── Format Route ──────────────────────────────────────────────────

  app.post(api.format.formatQuery.path, async (req, res) => {
    try {
      const input = api.format.formatQuery.input.parse(req.body);
      const formatted = formatSQL(input.sql);
      res.json({ formatted });
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
