import OpenAI from "openai";

let client: OpenAI | null = null;

/** Default model for Replit AI integrations (OpenAI-compatible proxy). */
const MODEL = "gpt-4o";

function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;

    if (!apiKey && !baseURL) {
      throw new Error("AI_INTEGRATIONS_OPENAI_API_KEY is not set. Add it to your Replit Secrets to enable LLM features.");
    }

    client = new OpenAI({
      apiKey: apiKey || "proxy-handled",
      ...(baseURL ? { baseURL } : {}),
    });
  }
  return client;
}

export function isLLMConfigured(): boolean {
  return !!(process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_BASE_URL);
}

/** Helper: extract text from an OpenAI chat completion response. */
function extractText(response: OpenAI.Chat.Completions.ChatCompletion): string {
  return response.choices[0]?.message?.content ?? "";
}

/**
 * Format a SQL query per international SQL documentation standards
 * (ISO/IEC 9075 style conventions, human readability best practices).
 */
export async function llmFormatQuery(
  sql: string,
  dialect: string = "Standard SQL",
  schemas?: string
): Promise<{ formatted: string; notes: string }> {
  const openai = getClient();

  const schemaContext = schemas
    ? `\n\nThe user has the following schema definitions for context:\n${schemas}`
    : "";

  const response = await openai.chat.completions.create({
    model: MODEL,
    max_tokens: 8192,
    messages: [
      {
        role: "user",
        content: `You are a SQL formatting expert. Format the following SQL query according to international SQL documentation standards (ISO/IEC 9075 conventions) optimized for human readability.

Formatting rules:
- UPPERCASE all SQL keywords (SELECT, FROM, WHERE, JOIN, etc.)
- Indent with 4 spaces for readability
- Each major clause (SELECT, FROM, WHERE, JOIN, GROUP BY, ORDER BY, HAVING) starts on a new line at the base indent level
- Column lists: one column per line, indented, with trailing commas
- JOIN conditions: ON clause indented under the JOIN
- Subqueries: indented one level deeper with aligned parentheses
- CASE expressions: WHEN/THEN/ELSE each on their own indented line
- CTEs (WITH clauses): each CTE clearly separated
- Align related clauses for visual scanning
- Add a blank line between major logical sections (CTEs, main query)
- Consistent spacing around operators (=, <>, >=, etc.)
- End with a semicolon
- Preserve all comments
- Detected dialect: ${dialect}${schemaContext}

Return ONLY a JSON object with two fields:
- "formatted": the formatted SQL string
- "notes": a brief note (1-2 sentences) about any formatting decisions made

SQL to format:
\`\`\`sql
${sql}
\`\`\``,
      },
    ],
  });

  const text = extractText(response);

  // Parse JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        formatted: parsed.formatted || sql,
        notes: parsed.notes || "",
      };
    } catch {
      // If JSON parsing fails, try to extract the SQL
      const sqlMatch = text.match(/```sql\n([\s\S]*?)```/);
      return {
        formatted: sqlMatch ? sqlMatch[1].trim() : text.trim(),
        notes: "",
      };
    }
  }

  return { formatted: text.trim() || sql, notes: "" };
}

/**
 * Unified query analysis via a single LLM call.
 *
 * One structured call that analyzes the query across all enabled categories
 * AND self-validates every suggestion for semantic/logical/performance safety.
 * The LLM acts as both analyst and QA reviewer in a single context window.
 */
export async function llmAnalyzeQuery(
  sql: string,
  options: {
    dialect?: string;
    schemas?: string;
    documents?: string;
    acceptedFeedback?: Array<{ title: string; suggestion: string | null }>;
    enabledCategories?: string[];
  } = {}
): Promise<Array<{
  agentType: string;
  severity: string;
  title: string;
  message: string;
  suggestion: string | null;
  lineNumber: number | null;
}>> {
  const openai = getClient();

  const dialect = options.dialect || "Standard SQL";
  const categories = options.enabledCategories || [
    "structure", "optimization", "error", "style", "formatting", "documentation",
  ];

  const contextParts: string[] = [];

  contextParts.push(`Detected SQL dialect: ${dialect}`);

  if (options.schemas) {
    contextParts.push(`\nSchema definitions:\n${options.schemas}`);
  }

  if (options.documents) {
    contextParts.push(`\nReference documentation:\n${options.documents}`);
  }

  if (options.acceptedFeedback && options.acceptedFeedback.length > 0) {
    const accepted = options.acceptedFeedback
      .map(f => `- ${f.title}${f.suggestion ? `: ${f.suggestion}` : ""}`)
      .join("\n");
    contextParts.push(`\nThe user has already accepted these suggestions (do not repeat them, but use them as context for your preferences understanding):\n${accepted}`);
  }

  const categoryDescriptions = categories.map(c => {
    switch (c) {
      case "structure": return "- **structure**: Query structure, nesting depth, complexity, readability, use of CTEs";
      case "optimization": return "- **optimization**: Performance patterns (SELECT *, missing WHERE, index usage, N+1 patterns, join efficiency)";
      case "error": return "- **error**: Potential SQL bugs, typos, unmatched parentheses, ambiguous references, type mismatches";
      case "style": return "- **style**: Keyword casing consistency, indentation, comma placement, naming conventions";
      case "formatting": return "- **formatting**: Whitespace, line breaks, alignment, overall visual layout and readability";
      case "documentation": return "- **documentation**: Comments, query purpose clarity, documentation headers, maintainability for team environments";
      default: return "";
    }
  }).filter(Boolean).join("\n");

  const response = await openai.chat.completions.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `You are an expert SQL analyst AND rigorous QA reviewer in one. Analyze this SQL query, provide actionable feedback, and self-validate every suggestion before including it.

${contextParts.join("\n")}

Analyze across these enabled categories:
${categoryDescriptions}

For each feedback item you consider, apply these QA validation checks BEFORE including it:
1. **Semantic safety**: If your suggestion changes the query, would it preserve the result set? (row count, column values, NULL handling, DISTINCT behavior, aggregate results)
2. **Logical safety**: Would it preserve filtering, join conditions, grouping, and ordering?
3. **Performance safety**: Could it degrade performance? (removing index hints, adding unnecessary subqueries, changing join order)

ONLY include a suggestion if it passes all three checks. If a suggestion would change query semantics because it fixes a genuine bug, include it but set severity to "error" and note the behavioral change in the message.

Return a JSON array of feedback items. Each item must have:
- "agentType": one of ${JSON.stringify(categories)}
- "severity": "error" | "warning" | "info" | "success"
  - Use "error" only for actual bugs, likely runtime failures, or suggestions that intentionally change behavior to fix a bug
  - Use "warning" for things that are probably wrong or will cause problems
  - Use "info" for suggestions and observations
  - Use "success" to acknowledge good practices you notice
- "title": short title (under 60 chars)
- "message": detailed explanation (include QA note if the suggestion changes behavior)
- "suggestion": actionable suggestion that passes QA validation, or null
- "lineNumber": relevant line number (1-indexed) or null

Guidelines:
- Aim for 3-8 items total across all categories — be concise and high-signal
- Include at least one "success" item if the query has any good practices
- Do not repeat suggestions the user has already accepted
- If schemas are provided, validate column references, table names, and types
- If documents are provided, check for consistency with documented conventions
- NEVER include a suggestion that would silently change query results — either omit it or flag it as a bug fix with severity "error"

SQL:
\`\`\`sql
${sql}
\`\`\``,
      },
    ],
  });

  const text = extractText(response);

  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Answer a user question about their SQL query, schemas, or general SQL topics.
 */
export async function llmAskQuestion(
  question: string,
  queryContext?: string,
  schemas?: string,
  dialect?: string
): Promise<string> {
  const openai = getClient();

  const parts: string[] = [];
  parts.push("You are a helpful, non-judgmental SQL advisor. Answer the analyst's question clearly and concisely.");

  if (dialect) {
    parts.push(`Detected SQL dialect: ${dialect}`);
  }

  if (queryContext) {
    parts.push(`\nCurrent SQL query:\n\`\`\`sql\n${queryContext}\n\`\`\``);
  }

  if (schemas) {
    parts.push(`\nAvailable schema definitions:\n${schemas}`);
  }

  parts.push(`\nQuestion: ${question}`);
  parts.push("\nProvide a clear, helpful answer. Use markdown formatting. If suggesting SQL changes, show the code.");

  const response = await openai.chat.completions.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [{ role: "user", content: parts.join("\n") }],
  });

  return extractText(response) || "Unable to process the question.";
}

/**
 * Extract a JSON object from LLM text output.
 *
 * LLMs often wrap JSON in markdown fences or prepend reasoning text.
 * This helper tries progressively looser strategies to find the object.
 */
function extractJsonObject(text: string): Record<string, unknown> | null {
  // Strip markdown code fences
  const stripped = text.replace(/```(?:json)?\s*/g, "").replace(/```/g, "");

  // Strategy 1: find outermost { ... } containing "tables"
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(stripped.slice(start, end + 1));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch { /* try next strategy */ }
  }

  // Strategy 2: try to parse the entire stripped text
  try {
    const parsed = JSON.parse(stripped);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch { /* give up */ }

  return null;
}

import type { ParsedTable } from "@shared/schema";

/**
 * Parse raw text content into structured schema definitions.
 *
 * Single structured LLM call — the model returns the complete ERD-ready
 * data structure (tables with typed columns, primary keys, relationships,
 * and display DDL). No local parsing, regex, or DDL building.
 */
export async function llmParseSchema(
  rawContent: string,
  fileName: string
): Promise<{ parsed: string; tables: ParsedTable[]; error?: string }> {
  const openai = getClient();

  console.log("[schema-parser] Starting parse for:", fileName, "content length:", rawContent.length);

  const response = await openai.chat.completions.create({
    model: MODEL,
    max_tokens: 8192,
    messages: [
      {
        role: "user",
        content: `You are a schema-extraction agent. A user uploaded content from file "${fileName}". Your ONLY job: find every database table and column in this content and return a single structured JSON object.

The content can be in ANY format — database client output (e.g. MySQL DESCRIBE, \\d output), SQL DDL, spreadsheets, CSV, JSON, documentation, anything. Figure out what it is and extract the schema.

RULES:
- Strip schema/database prefixes from table names (e.g. "mydb.orders" → "orders", "gsm.temp_table" → "temp_table")
- Preserve original data types exactly as they appear (e.g. varchar(15), decimal(10,2), int, date)
- Identify primary keys where possible (from PRI markers, PRIMARY KEY constraints, etc.)
- Detect foreign key relationships between tables where possible (explicit FK constraints, naming conventions like *_id columns referencing other tables)
- Generate clean CREATE TABLE DDL for display purposes
- Ignore non-schema content (USE statements, SHOW commands, comments, etc.)
- Output ONLY the JSON object below — no explanation, no markdown fences, no other text

OUTPUT FORMAT — a single JSON object:
{
  "tables": [
    {
      "name": "table_name",
      "columns": [
        {"name": "col_name", "type": "VARCHAR(255)", "isPrimaryKey": true}
      ],
      "relationships": [
        {"fromCol": "user_id", "toTable": "users", "toCol": "id"}
      ]
    }
  ],
  "ddl": "CREATE TABLE table_name (\\n  col_name VARCHAR(255) PRIMARY KEY\\n);"
}

CONTENT:
${rawContent}`,
      },
    ],
  });

  const text = extractText(response);

  console.log("[schema-parser] LLM response length:", text.length, "preview:", text.slice(0, 500));

  const result = extractJsonObject(text);

  if (!result || !Array.isArray(result.tables)) {
    const error = `LLM returned no parseable schema data. Response preview: ${text.slice(0, 300)}`;
    console.error("[schema-parser]", error);
    return { parsed: rawContent, tables: [], error };
  }

  // Validate and normalize each table entry
  const tables: ParsedTable[] = (result.tables as Array<Record<string, unknown>>)
    .filter((t) => typeof t.name === "string" && (t.name as string).length > 0 && Array.isArray(t.columns))
    .map((t) => ({
      name: t.name as string,
      columns: (t.columns as Array<Record<string, unknown>>).map((c) => ({
        name: String(c.name || ""),
        type: String(c.type || ""),
        isPrimaryKey: !!c.isPrimaryKey,
      })),
      relationships: Array.isArray(t.relationships)
        ? (t.relationships as Array<Record<string, unknown>>).map((r) => ({
            fromCol: String(r.fromCol || ""),
            toTable: String(r.toTable || ""),
            toCol: String(r.toCol || ""),
          }))
        : [],
    }));

  if (tables.length === 0) {
    const error = `LLM returned data but no valid table entries. Raw: ${JSON.stringify(result.tables).slice(0, 300)}`;
    console.error("[schema-parser]", error);
    return { parsed: rawContent, tables: [], error };
  }

  const ddl = typeof result.ddl === "string" ? result.ddl : rawContent;

  console.log("[schema-parser] Parsed", tables.length, "tables:", tables.map((t) => `${t.name}(${t.columns.length}cols)`).join(", "));

  return { parsed: ddl, tables };
}
