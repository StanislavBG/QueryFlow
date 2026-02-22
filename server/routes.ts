import type { Express } from "express";
import type { Server } from "http";
import { clerkMiddleware, getAuth } from "@clerk/express";
import { storage } from "./storage";
import { api, buildUrl } from "@shared/routes";
import { z } from "zod";
import { formatSQL } from "./formatter";
import { isLLMConfigured, llmFormatQuery, llmAnalyzeQuery, llmValidateRecommendations, llmAskQuestion, llmParseSchema, llmGenerateDemo, llmGenerateQueryFromVoice, llmAnalyzeWaterfall, logLlmError, getLlmErrors, clearLlmErrors } from "./llm";
import { requireAdmin, resolveAppUser, logActivity } from "./auth";
import { mergeWaterfallAnalysis } from "./waterfall-merge";
import type { WaterfallAnalysis } from "@shared/waterfall";

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

import type { UserSchema, ParsedTable, ParsedColumn, ParsedRelationship } from "@shared/schema";

/** Build schema context string for LLM prompts, including descriptions and voice annotations as SQL comments. */
async function buildSchemaContext(schemas: UserSchema[]): Promise<string | undefined> {
  if (schemas.length === 0) return undefined;
  const parts: string[] = [];

  for (const s of schemas) {
    const schemaParts: string[] = [];
    if (s.description) {
      schemaParts.push(s.description.split('\n').map(l => `-- ${l}`).join('\n'));
    }
    if (s.parsedDdl) schemaParts.push(s.parsedDdl);

    // Append voice context annotations for this schema
    const voiceContexts = await storage.getSchemaVoiceContexts(s.id);
    for (const vc of voiceContexts) {
      if (!vc.transcript) continue;
      let label = "";
      if (vc.targetType === "schema") {
        label = `schema "${s.name}"`;
      } else if (vc.targetType === "table") {
        label = `table "${vc.targetTable}"`;
      } else if (vc.targetType === "column") {
        label = `column "${vc.targetTable}.${vc.targetColumn}"`;
      }
      schemaParts.push(`-- User context for ${label}: ${vc.transcript}`);
    }

    if (schemaParts.length > 0) parts.push(schemaParts.join('\n'));
  }

  const combined = parts.join('\n\n');
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

    // Demo mode: queryId <= 0 means virtual/in-memory query (no DB persistence)
    const isDemoMode = queryId <= 0;

    let sqlContent: string;
    if (isDemoMode) {
      sqlContent = (req.body.content || "").toString();
    } else {
      const query = await storage.getSqlQuery(queryId);
      if (!query) {
        return res.status(404).json({ message: "Query not found" });
      }
      // Prefer the live editor content sent from the client; fall back to stored content
      sqlContent = (req.body.content || query.draftContent || query.content || "").toString();
    }

    if (!sqlContent.trim()) {
      return res.json([]);
    }

    if (!isLLMConfigured()) {
      return res.status(503).json({
        message: "LLM not configured. Set AI_INTEGRATIONS_OPENAI_API_KEY to enable analysis.",
      });
    }

    // Switch to SSE so the client can track progress across LLM calls
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const sendEvent = (data: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const { userId: analysisUserId } = getAuth(req);
    logActivity(analysisUserId, "query.analyze", "query", queryId);

    const dialect = req.body.dialect || "Standard SQL";

    // Determine which categories are enabled
    const allSettings = await storage.getAgentSettings();
    const enabledCategories = allSettings.length > 0
      ? allSettings.filter(s => s.enabled).map(s => s.agentType)
      : [...ALL_CATEGORIES];

    // Gather schema context (includes voice annotations) — skip for demo
    const schemas = isDemoMode ? [] : await storage.getUserSchemas();
    const schemaContext = await buildSchemaContext(schemas);

    // Gather document context
    const docs = isDemoMode ? [] : await storage.getDocuments();
    const docContext = docs.length > 0
      ? docs.map(d => d.content).join("\n\n---\n\n")
      : undefined;

    // Gather full previous feedback state so the LLM can learn from user
    // decisions — skip for demo (no persisted feedback).
    const existingFeedback = isDemoMode ? [] : await storage.getFeedbackByQueryId(queryId);
    const previousFeedback = existingFeedback.map(f => ({
      agentType: f.agentType,
      severity: f.severity,
      title: f.title,
      message: f.message,
      suggestion: f.suggestion,
      lineNumber: f.lineNumber,
      isResolved: f.isResolved,
      isDismissed: f.isDismissed,
    }));

    // Clear only unresolved feedback; keep resolved items as a persistent
    // dismissal record so context survives across multiple analyses.
    if (!isDemoMode) {
      const unresolvedIds = existingFeedback.filter(f => !f.isResolved).map(f => f.id);
      for (const uid of unresolvedIds) {
        await storage.deleteFeedbackById(uid);
      }
    }

    try {
      // Step 1: Generate recommendations
      sendEvent({ step: 1, total: 2, label: "Analyzing query" });
      const llmResults = await llmAnalyzeQuery(sqlContent, {
        dialect,
        schemas: schemaContext,
        documents: docContext,
        previousFeedback: previousFeedback.length > 0 ? previousFeedback : undefined,
        enabledCategories,
      });

      // Step 2: Independent QA validation
      sendEvent({ step: 2, total: 2, label: "Validating recommendations" });
      const validated = await llmValidateRecommendations(
        sqlContent,
        llmResults,
        dialect
      );

      const feedbackItems = validated.map(r => {
        const { agentType, severity, title, message, suggestion, lineNumber, ...extra } = r;
        return {
          queryId,
          agentType,
          severity,
          title,
          message,
          suggestion: suggestion ?? null,
          lineNumber: lineNumber ?? null,
          metadata: Object.keys(extra).length > 0 ? extra : {},
          isResolved: false,
          isDismissed: false,
        };
      });

      if (isDemoMode) {
        // Demo mode: return virtual results without persisting to DB
        const virtualResults = feedbackItems.map((item, idx) => ({
          ...item,
          id: -(idx + 1),
          createdAt: new Date(),
        }));
        sendEvent({ done: true, results: virtualResults });
      } else {
        const created = await storage.createFeedbackBatch(feedbackItems);
        sendEvent({ done: true, results: created });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("LLM analysis failed:", err);
      logLlmError("analyze", errMsg, { inputPreview: sqlContent?.slice(0, 500) });
      sendEvent({ error: true, message: `Analysis failed: ${errMsg}` });
    } finally {
      res.end();
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

  app.patch("/api/feedback/:id/dismiss", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ message: "Invalid feedback ID" });
    }
    const feedback = await storage.dismissFeedback(id);
    if (!feedback) {
      return res.status(404).json({ message: "Feedback not found" });
    }
    res.json(feedback);
  });

  app.delete("/api/feedback/:id", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ message: "Invalid feedback ID" });
    }
    await storage.deleteFeedbackById(id);
    res.json({ success: true });
  });

  // ─── Analysis Context Preview ──────────────────────────────────────
  // Returns the exact context blocks that would be sent to llmAnalyzeQuery,
  // without running the LLM. Each block is a { key, label, content } object.
  // New block types (e.g. Metrics, Logs) appear automatically when data exists.

  app.post("/api/sql-queries/:id/analysis-context", async (req, res) => {
    const queryId = parseInt(req.params.id, 10);
    if (isNaN(queryId)) {
      return res.status(400).json({ message: "Invalid query ID" });
    }

    const query = await storage.getSqlQuery(queryId);
    if (!query) {
      return res.status(404).json({ message: "Query not found" });
    }

    const sqlContent = (req.body.content || query.draftContent || query.content || "").toString();
    const dialect = req.body.dialect || "Standard SQL";

    // Assemble all the same context the analyze pipeline would use
    const blocks: Array<{ key: string; label: string; content: string; itemCount?: number; charCount?: number; description?: string }> = [];

    // 1. Query
    blocks.push({
      key: "query",
      label: "Query",
      content: sqlContent || "(empty)",
    });

    // 2. Dialect
    blocks.push({
      key: "dialect",
      label: "Dialect",
      content: dialect,
    });

    // 3. Enabled categories
    const allSettings = await storage.getAgentSettings();
    const enabledCategories = allSettings.length > 0
      ? allSettings.filter(s => s.enabled).map(s => s.agentType)
      : [...ALL_CATEGORIES];
    blocks.push({
      key: "categories",
      label: "Enabled Categories",
      content: enabledCategories.join(", "),
      itemCount: enabledCategories.length,
    });

    // 4. Schemas
    const schemas = await storage.getUserSchemas();
    const schemaContext = await buildSchemaContext(schemas);
    if (schemaContext) {
      blocks.push({
        key: "schemas",
        label: "Schema Definitions",
        description: "Table and column definitions parsed from your uploaded schemas. Helps the LLM validate column references, types, and joins.",
        content: schemaContext,
        itemCount: schemas.length,
      });
    }

    // 5. Documents (user-uploaded reference docs from Schemas tab)
    const docs = await storage.getDocuments();
    if (docs.length > 0) {
      blocks.push({
        key: "documents",
        label: "Reference Documents",
        description: "Uploaded via the Documents section in the Schemas tab. Sent as additional context to help the LLM understand your database environment.",
        content: docs.map(d => d.content).join("\n\n---\n\n"),
        itemCount: docs.length,
      });
    }

    // 6. Previous feedback (accepted / dismissed / unresolved)
    const existingFeedback = await storage.getFeedbackByQueryId(queryId);
    const accepted = existingFeedback.filter(f => f.isResolved && !f.isDismissed);
    const dismissed = existingFeedback.filter(f => f.isResolved && f.isDismissed);
    const unresolved = existingFeedback.filter(f => !f.isResolved);

    if (accepted.length > 0) {
      blocks.push({
        key: "feedback_accepted",
        label: "Accepted Feedback",
        content: accepted.map(f => `[${f.agentType}/${f.severity}] ${f.title}: ${f.message}`).join("\n\n"),
        itemCount: accepted.length,
      });
    }

    if (dismissed.length > 0) {
      blocks.push({
        key: "feedback_dismissed",
        label: "Dismissed Feedback",
        content: dismissed.map(f => `[${f.agentType}/${f.severity}] ${f.title}: ${f.message}`).join("\n\n"),
        itemCount: dismissed.length,
      });
    }

    if (unresolved.length > 0) {
      blocks.push({
        key: "feedback_unresolved",
        label: "Unresolved Feedback",
        content: unresolved.map(f => `[${f.agentType}/${f.severity}] ${f.title}: ${f.message}`).join("\n\n"),
        itemCount: unresolved.length,
      });
    }

    // 7. LLM status
    blocks.push({
      key: "llm_status",
      label: "LLM Status",
      content: isLLMConfigured() ? "Configured" : "Not configured — set AI_INTEGRATIONS_OPENAI_API_KEY",
    });

    // Add charCount to each block so client can estimate tokens
    for (const block of blocks) {
      block.charCount = block.content.length;
    }

    // Estimate system prompt overhead (~2800 chars for the analyze prompt template)
    const systemPromptChars = 2800;
    blocks.unshift({
      key: "system_prompt",
      label: "System Prompt",
      description: "Fixed LLM instructions covering analysis rules, output format, and dialect handling. Not editable.",
      content: `~${systemPromptChars} characters of LLM instructions (dialect rules, output schema, category definitions)`,
      charCount: systemPromptChars,
    });

    res.json(blocks);
  });

  // ─── Format Route (LLM-powered with local fallback) ────────────────

  app.post(api.format.formatQuery.path, async (req, res) => {
    try {
      const input = api.format.formatQuery.input.parse(req.body);
      const dialect = req.body.dialect || "Standard SQL";

      const { userId: fmtUserId } = getAuth(req);
      logActivity(fmtUserId, "format.run", "format");

      if (isLLMConfigured()) {
        // Gather schemas for context (includes voice annotations)
        const schemas = await storage.getUserSchemas();
        const schemaContext = await buildSchemaContext(schemas);

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

  // ─── Waterfall Flow Analysis ──────────────────────────────────────

  app.post(api.waterfall.analyze.path, async (req, res) => {
    try {
      const input = api.waterfall.analyze.input.parse(req.body);

      if (!isLLMConfigured()) {
        return res.status(503).json({ message: "LLM is not configured. Add AI_INTEGRATIONS_OPENAI_API_KEY to enable waterfall analysis." });
      }

      const { userId: wfUserId } = getAuth(req);
      logActivity(wfUserId, "waterfall.analyze", "waterfall");

      // Gather schema context for richer analysis (non-fatal if it fails)
      let schemaContext: string | undefined;
      try {
        const schemas = await storage.getUserSchemas();
        schemaContext = await buildSchemaContext(schemas);
      } catch (schemaErr) {
        console.warn("[waterfall] Could not load schema context:", schemaErr);
      }

      const llmResult = await llmAnalyzeWaterfall(input.content, {
        dialect: input.dialect,
        schemas: schemaContext,
      });

      // If a queryId was provided, try to merge with existing user-evolved data
      if (input.queryId) {
        const query = await storage.getSqlQuery(input.queryId);
        if (query?.waterfallData) {
          const mergeResult = mergeWaterfallAnalysis(
            query.waterfallData as WaterfallAnalysis,
            llmResult
          );
          // Auto-save the merged result back
          await storage.updateSqlQuery(input.queryId, {
            waterfallData: mergeResult.analysis,
          } as any);
          return res.json(mergeResult);
        }
        // No existing data — save the fresh result
        await storage.updateSqlQuery(input.queryId, {
          waterfallData: llmResult,
        } as any);
      }

      // Return as a WaterfallMergeResult with empty conflicts
      res.json({
        analysis: llmResult,
        conflicts: [],
        newNodes: [],
        removedNodes: [],
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[waterfall] Analysis failed:", errMsg);
      if (!errMsg.includes("Failed to parse waterfall") && !errMsg.includes("no valid nodes")) {
        logLlmError("waterfall", errMsg, { inputPreview: (req.body?.content || "").slice(0, 500) });
      }
      res.status(500).json({ message: errMsg || "Waterfall analysis failed" });
    }
  });

  // ─── Waterfall: Save user modifications ─────────────────────────────

  app.put("/api/sql-queries/:id/waterfall", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const input = api.waterfall.save.input.parse(req.body);
      const query = await storage.getSqlQuery(id);
      if (!query) {
        return res.status(404).json({ message: "Query not found" });
      }

      const { userId: wfUserId } = getAuth(req);
      logActivity(wfUserId, "waterfall.save", "waterfall", id);

      await storage.updateSqlQuery(id, {
        waterfallData: input as WaterfallAnalysis,
      } as any);

      res.json(input);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[waterfall] Save failed:", errMsg);
      res.status(500).json({ message: errMsg || "Failed to save waterfall data" });
    }
  });

  // ─── Waterfall: Get stored data ─────────────────────────────────────

  app.get("/api/sql-queries/:id/waterfall", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const query = await storage.getSqlQuery(id);
      if (!query) {
        return res.status(404).json({ message: "Query not found" });
      }
      res.json(query.waterfallData ?? null);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[waterfall] Get failed:", errMsg);
      res.status(500).json({ message: errMsg || "Failed to get waterfall data" });
    }
  });

  // ─── LLM Error Log ──────────────────────────────────────────────────

  app.get("/api/llm-errors", (_req, res) => {
    res.json(getLlmErrors());
  });

  app.delete("/api/llm-errors", (_req, res) => {
    clearLlmErrors();
    res.json({ message: "Cleared" });
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

      // Gather schema context (includes voice annotations)
      const schemas = await storage.getUserSchemas();
      const schemaContext = await buildSchemaContext(schemas);

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

  // ─── Schema Parse Test Endpoint ──────────────────────────────────────
  // Exercises the full LLM schema-parsing pipeline with the mandatory
  // 4-table GSM DESCRIBE fixture and returns a detailed diagnostic report.
  // Usage: GET /api/schemas/test-parse
  app.get("/api/schemas/test-parse", async (_req, res) => {
    const FIXTURE = `USE gsm;
SHOW TABLES;
DESCRIBE gsm.temp_lan_wlan_cbom;
TYPE\tvarchar(4)\tYES\tMUL\t\t
Date_Uploaded\tdate\tNO\t\t\t
ITEM_IN_BOM\tvarchar(10)\tNO\tPRI\t\t
FYFQ\tvarchar(6)\tNO\tPRI\t\t
Partner\tvarchar(15)\tNO\tPRI\t\t
Product_SKU\tvarchar(20)\tNO\tPRI\t\t
FY\tint\tNO\t\t\t
FQ\tvarchar(3)\tNO\t\t\t
Product_Used_In\tvarchar(25)\tNO\t\t\t
Customer_Part_Number\tvarchar(42)\tYES\t\t\t
CM_ODM_Part_Number\tvarchar(26)\tYES\t\t\t
Manufacturer_Part_Number_MPN\tvarchar(110)\tYES\t\t\t
Manufacturer\tvarchar(100)\tYES\t\t\t
MPN_Description\tvarchar(190)\tYES\t\t\t
CM_ODM_Control_Y_N\tvarchar(10)\tYES\t\t\t
Commodity\tvarchar(50)\tYES\tMUL\t\t
Quantity_Used\tdecimal(12,7)\tYES\t\t\t
Current_Quarter_MPN_Cost\tdecimal(15,7)\tYES\t\t\t
Dual_Sourced_Y_N\tvarchar(2)\tYES\t\t\t
Current_Quarter_MPN_Allocation\tdecimal(10,7)\tYES\t\t\t
Lead_Time_wks\tdecimal(6,2)\tYES\t\t\t
Supplier_Location\tvarchar(60)\tYES\t\t\t
Commodity_gr\tvarchar(50)\tYES\t\t\t
Current_Qtr_PCA_Allocation\tdecimal(15,7)\tYES\t\t\t
DESCRIBE gsm.lan_wlan_actuals;
Date_Uploaded\tdate\tYES\t\t\t
TYPE\tvarchar(4)\tYES\tMUL\t\t
Partner\tvarchar(15)\tNO\tPRI\t\t
FYFQ\tvarchar(6)\tNO\tPRI\t\t
FY\tint\tNO\t\t\t
FQ\tvarchar(3)\tNO\t\t\t
Product_SKU\tvarchar(20)\tNO\tPRI\t\t
Product_Used_In\tvarchar(20)\tNO\tPRI\t\t
Qty_Ship\tdecimal(10,2)\tYES\t\t\t
DESCRIBE gsm.lan_wlan_build_plan_of_rec_qtr;
TYPE\tvarchar(4)\tYES\t\t\t
CAL_MO_UPDATE\tdate\tNO\tPRI\t\t
FYFQ\tvarchar(6)\tNO\tPRI\t\t
FY\tint\tNO\t\t\t
FQ\tvarchar(3)\tNO\t\t\t
Partner\tvarchar(15)\tNO\tPRI\t\t
Product_SKU\tvarchar(20)\tNO\tPRI\t\t
Product_Used_In\tvarchar(25)\tNO\tPRI\t\t
Frcs_Build_Qty\tdecimal(15,8)\tYES\t\t0.00000000\t
Product_Used_In_upd\tvarchar(25)\tNO\t\t\t
Current_location\tvarchar(45)\tYES\t\t\t
New_location\tvarchar(45)\tYES\t\t\t
Alloc_per_new_loc\tdecimal(10,7)\tYES\t\t\t
Open_PO_Qty\tdecimal(15,8)\tYES\t\t0.00000000\t
Only_BP_qty\tdecimal(15,8)\tYES\t\t\t
DESCRIBE gsm.lan_wlan_tc;
TYPE\tvarchar(4)\tNO\tPRI\tWLAN\t
Date_Uploaded\tdate\tNO\t\t\t
ITEM_IN_BOM\tvarchar(10)\tNO\tPRI\t\t
FYFQ\tvarchar(6)\tNO\tPRI\t\t
FY\tint\tNO\t\t\t
FQ\tvarchar(3)\tNO\t\t\t
Partner\tvarchar(15)\tNO\tPRI\t\t
Product_SKU\tvarchar(20)\tNO\tPRI\t\t
Product_Used_In\tvarchar(25)\tYES\t\t\t
Product_Description\tvarchar(60)\tYES\t\t\t
CM_ODM_Location\tchar(20)\tYES\t\t\t
Total_BOM_Cost\tdecimal(15,7)\tYES\t\t\t
Total_CM_ODM_Product_Cost\tdecimal(15,7)\tYES\t\t\t
Total_MVA_Cost\tdecimal(15,7)\tYES\t\t\t
ELF\tdecimal(15,7)\tYES\t\t\t
FINAL_PRODUCT_COST\tdecimal(15,7)\tYES\t\t\t
Product_Cycle\tvarchar(10)\tYES\t\t\t
NPI_Product_Cost\tdecimal(15,7)\tYES\t\t\t
NPI_BOM_Cost\tdecimal(15,7)\tYES\t\t\t
NPI_Aruba_BOM_Cost\tdecimal(15,7)\tYES\t\t\t
NPI_JDM_BOM_Cost\tdecimal(15,7)\tYES\t\t\t
NPI_MVA\tdecimal(15,7)\tYES\t\t\t
NPI_ELF\tdecimal(15,7)\tYES\t\t\t
Aruba_BOM\tdecimal(15,7)\tYES\t\t\t
JDM_BOM\tdecimal(15,7)\tYES\t\t\t`;

    // ── Expected results ──
    const EXPECTED_TABLES: Record<string, { minColumns: number; primaryKeys: string[] }> = {
      temp_lan_wlan_cbom: {
        minColumns: 23,
        primaryKeys: ["ITEM_IN_BOM", "FYFQ", "Partner", "Product_SKU"],
      },
      lan_wlan_actuals: {
        minColumns: 9,
        primaryKeys: ["Partner", "FYFQ", "Product_SKU", "Product_Used_In"],
      },
      lan_wlan_build_plan_of_rec_qtr: {
        minColumns: 15,
        primaryKeys: ["CAL_MO_UPDATE", "FYFQ", "Partner", "Product_SKU", "Product_Used_In"],
      },
      lan_wlan_tc: {
        minColumns: 24,
        primaryKeys: ["TYPE", "ITEM_IN_BOM", "FYFQ", "Partner", "Product_SKU"],
      },
    };

    const report: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      llmConfigured: isLLMConfigured(),
      fixtureLength: FIXTURE.length,
    };

    if (!isLLMConfigured()) {
      report.error = "LLM not configured — cannot run test";
      return res.json(report);
    }

    try {
      const startMs = Date.now();
      const result = await llmParseSchema(FIXTURE, "gsm-describe-test.txt");
      const elapsedMs = Date.now() - startMs;

      report.elapsedMs = elapsedMs;
      report.parseError = result.error || null;
      report.tablesReturned = result.tables.length;
      report.ddlLength = result.parsed.length;
      report.ddlPreview = result.parsed.slice(0, 500);

      // ── Validate each expected table ──
      const tableValidation: Record<string, unknown> = {};

      for (const [expectedName, expected] of Object.entries(EXPECTED_TABLES)) {
        const found = result.tables.find(
          (t) => t.name.toLowerCase() === expectedName.toLowerCase()
        );

        if (!found) {
          tableValidation[expectedName] = {
            status: "MISSING",
            message: `Table "${expectedName}" not found in LLM output`,
            availableTables: result.tables.map((t) => t.name),
          };
          continue;
        }

        const issues: string[] = [];

        // Check column count
        if (found.columns.length < expected.minColumns) {
          issues.push(
            `Expected >= ${expected.minColumns} columns, got ${found.columns.length}`
          );
        }

        // Check primary keys
        const actualPKs = found.columns
          .filter((c) => c.isPrimaryKey)
          .map((c) => c.name);

        for (const pk of expected.primaryKeys) {
          if (!actualPKs.some((a) => a.toLowerCase() === pk.toLowerCase())) {
            issues.push(`Missing PK: "${pk}" (actual PKs: ${actualPKs.join(", ") || "(none)"})`);
          }
        }

        // Check column types are not empty
        const missingTypes = found.columns.filter((c) => !c.type || c.type.trim() === "");
        if (missingTypes.length > 0) {
          issues.push(
            `${missingTypes.length} columns with empty type: ${missingTypes.map((c) => c.name).join(", ")}`
          );
        }

        tableValidation[expectedName] = {
          status: issues.length === 0 ? "PASS" : "FAIL",
          columnCount: found.columns.length,
          primaryKeys: actualPKs,
          issues: issues.length > 0 ? issues : undefined,
          columns: found.columns.map((c) => ({
            name: c.name,
            type: c.type,
            isPrimaryKey: c.isPrimaryKey,
          })),
        };
      }

      // Check for unexpected extra tables
      const expectedNames = new Set(Object.keys(EXPECTED_TABLES).map((n) => n.toLowerCase()));
      const unexpected = result.tables.filter(
        (t) => !expectedNames.has(t.name.toLowerCase())
      );
      if (unexpected.length > 0) {
        report.unexpectedTables = unexpected.map((t) => t.name);
      }

      report.tableValidation = tableValidation;

      // Overall verdict
      const allStatuses = Object.values(tableValidation).map(
        (v) => (v as Record<string, unknown>).status
      );
      report.verdict =
        allStatuses.every((s) => s === "PASS") && unexpected.length === 0
          ? "ALL PASS"
          : "FAILURES DETECTED";

      console.log("[schema-test] Test result:", report.verdict);
    } catch (err) {
      report.error = err instanceof Error ? err.message : String(err);
      report.stack = err instanceof Error ? err.stack : undefined;
    }

    res.json(report);
  });

  app.get("/api/schemas", async (req, res) => {
    const { userId } = getAuth(req);
    const schemas = await storage.getUserSchemas(userId || undefined);
    console.log("[schema-route] GET /api/schemas — returning", schemas.length, "schemas:",
      schemas.map(s => `id=${s.id} "${s.name}" tables=${Array.isArray(s.tables) ? s.tables.length : typeof s.tables}`).join(" | ")
    );
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
      let tables: ParsedTable[] = [];
      let parseError: string | undefined;

      // Always use LLM for schema parsing (per CLAUDE.md: all parsers must be LLM-based)
      console.log("[schema-route] POST /api/schemas — name:", input.name, "| rawContent length:", input.rawContent.length, "| LLM configured:", isLLMConfigured());
      if (isLLMConfigured()) {
        try {
          const result = await llmParseSchema(input.rawContent, input.fileName || "schema.sql");
          parsedDdl = result.parsed;
          tables = result.tables;
          if (result.error) parseError = result.error;
          console.log("[schema-route] llmParseSchema returned:", tables.length, "tables |", parsedDdl.length, "chars DDL | error:", result.error || "(none)");
        } catch (err) {
          parseError = `LLM schema parsing failed: ${err instanceof Error ? err.message : String(err)}`;
          console.error("[schema-route]", parseError, err);
        }
      } else {
        parseError = "LLM not configured. Set AI_INTEGRATIONS_OPENAI_API_KEY to enable schema parsing.";
        console.warn("[schema-route]", parseError);
      }

      console.log("[schema-route] Storing schema — tables count:", tables.length, "| parsedDdl length:", parsedDdl.length);
      if (tables.length > 0) {
        console.log("[schema-route] Tables being stored:", tables.map(t => `${t.name}(${t.columns.length}cols)`).join(", "));
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

      console.log("[schema-route] Schema saved — id:", schema.id, "| stored tables:", JSON.stringify(schema.tables).slice(0, 200));

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
        tables: z.array(z.object({
          name: z.string(),
          columns: z.array(z.object({
            name: z.string(),
            type: z.string(),
            isPrimaryKey: z.boolean(),
          })),
          relationships: z.array(z.object({
            fromCol: z.string(),
            toTable: z.string(),
            toCol: z.string(),
          })).optional(),
        })).optional(),
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

  // ─── Schema Voice Context Routes ──────────────────────────────────

  app.get("/api/schemas/:schemaId/voice-context", async (req, res) => {
    const schemaId = parseInt(req.params.schemaId, 10);
    if (isNaN(schemaId)) return res.status(400).json({ message: "Invalid schema ID" });
    const contexts = await storage.getSchemaVoiceContexts(schemaId);
    res.json(contexts);
  });

  app.post("/api/schemas/:schemaId/voice-context", async (req, res) => {
    const schemaId = parseInt(req.params.schemaId, 10);
    if (isNaN(schemaId)) return res.status(400).json({ message: "Invalid schema ID" });

    try {
      const input = z.object({
        targetType: z.enum(["schema", "table", "column"]),
        targetTable: z.string().nullable().optional(),
        targetColumn: z.string().nullable().optional(),
        transcript: z.string(),
      }).parse(req.body);

      const { userId } = getAuth(req);

      const result = await storage.upsertSchemaVoiceContext({
        schemaId,
        userId: userId || null,
        targetType: input.targetType,
        targetTable: input.targetTable ?? null,
        targetColumn: input.targetColumn ?? null,
        transcript: input.transcript,
      });

      logActivity(userId, "voice_context.upsert", "schema", schemaId);
      res.json(result);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.delete("/api/schemas/:schemaId/voice-context/:id", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const deleted = await storage.deleteSchemaVoiceContext(id);
    if (!deleted) return res.status(404).json({ message: "Voice context not found" });
    res.json({ message: "Voice context deleted" });
  });

  app.post("/api/schemas/:schemaId/voice-context/transcribe", async (req, res) => {
    const schemaId = parseInt(req.params.schemaId, 10);
    if (isNaN(schemaId)) return res.status(400).json({ message: "Invalid schema ID" });

    try {
      const input = z.object({ audio: z.string().min(1) }).parse(req.body);
      const audioBuffer = Buffer.from(input.audio, "base64");

      // Use the existing speechToText function from the audio integration
      const { speechToText } = await import("./replit_integrations/audio/client");
      const transcript = await speechToText(audioBuffer, "webm");

      res.json({ transcript });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      console.error("Transcription failed:", err);
      res.status(500).json({ message: "Transcription failed" });
    }
  });

  // ─── Voice-to-Query Route ──────────────────────────────────────────
  // Generates a SQL query from a voice transcript using schemas, context,
  // and existing queries as full context for the LLM.

  app.post("/api/voice-to-query", async (req, res) => {
    try {
      const input = z.object({
        transcript: z.string().trim().min(1).max(10000),
        dialect: z.string().optional(),
      }).parse(req.body);

      const { userId } = getAuth(req);

      // Require authentication — voice-to-query uses user-scoped data
      if (!userId) {
        return res.status(401).json({ message: "Authentication required for voice-to-query." });
      }

      if (!isLLMConfigured()) {
        return res.status(503).json({
          message: "LLM not configured. Set AI_INTEGRATIONS_OPENAI_API_KEY to enable voice-to-query.",
        });
      }

      logActivity(userId, "voice.query", "query");

      // Gather full context: schemas + voice annotations (user-scoped)
      const schemas = await storage.getUserSchemas(userId);
      const schemaContext = await buildSchemaContext(schemas);

      // Gather recent existing queries for pattern learning (bounded to 20 most recent)
      const existingQueries = await storage.getSqlQueries(userId);
      const queryContext = existingQueries
        .filter((q) => q.content && q.content.trim().length > 0)
        .slice(0, 20)
        .map((q) => ({ title: q.title, content: q.content.slice(0, 2000) }));

      const result = await llmGenerateQueryFromVoice(input.transcript, {
        dialect: input.dialect,
        schemas: schemaContext,
        existingQueries: queryContext.length > 0 ? queryContext : undefined,
      });

      res.json(result);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      console.error("Voice-to-query failed:", err);
      res.status(500).json({ message: "Failed to generate query from voice." });
    }
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

  // ─── Demo Bootstrap ────────────────────────────────────────────────
  // Returns a pre-seeded demo version (schema + flawed query) without
  // writing anything to sql_queries or user_schemas. Fast and cost-free.

  app.post("/api/demo/bootstrap", async (req, res) => {
    try {
      // Pick a random pre-seeded demo version
      let demo = await storage.getRandomDemoVersion();

      if (!demo) {
        // Fallback: no seeded versions yet — generate one and store it
        if (!isLLMConfigured()) {
          return res.status(503).json({
            message: "No demo versions available and LLM not configured.",
          });
        }
        const generated = await llmGenerateDemo();
        demo = await storage.createDemoVersion({
          schemaName: "Online Store (Demo)",
          schemaDdl: generated.schema.ddl,
          schemaTables: generated.schema.tables,
          queryTitle: generated.query.title,
          queryContent: generated.query.content,
        });
      }

      // Return demo data without creating any sql_queries/user_schemas rows
      res.json({
        query: { title: demo.queryTitle, content: demo.queryContent },
        schema: { name: demo.schemaName, ddl: demo.schemaDdl, tables: demo.schemaTables },
      });
    } catch (err) {
      console.error("Demo bootstrap failed:", err);
      res.status(500).json({
        message: "Failed to load demo. Please try again.",
      });
    }
  });

  // ─── Demo Seed (admin-only) ───────────────────────────────────────
  // Generates and stores one demo version per call, up to 10 total.

  app.post("/api/demo/seed", requireAdmin, async (req, res) => {
    if (!isLLMConfigured()) {
      return res.status(503).json({
        message: "LLM not configured. Set AI_INTEGRATIONS_OPENAI_API_KEY to enable seeding.",
      });
    }

    const currentCount = await storage.getDemoVersionCount();
    if (currentCount >= 10) {
      return res.json({ message: "Already have 10 demo versions.", count: currentCount });
    }

    try {
      const generated = await llmGenerateDemo();
      await storage.createDemoVersion({
        schemaName: "Online Store (Demo)",
        schemaDdl: generated.schema.ddl,
        schemaTables: generated.schema.tables,
        queryTitle: generated.query.title,
        queryContent: generated.query.content,
      });
      const newCount = await storage.getDemoVersionCount();
      res.json({ message: `Demo version created. ${newCount}/10 seeded.`, count: newCount });
    } catch (err) {
      console.error("Demo seed failed:", err);
      res.status(500).json({ message: "Failed to generate demo version." });
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
