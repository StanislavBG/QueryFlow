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
 * Query analysis — single LLM call to generate recommendations.
 *
 * Passes the query, schema context, documents, dialect, and previously
 * accepted feedback. Returns structured feedback items across all
 * enabled categories.
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
        content: `You are a constructive SQL advisor. Analyze this SQL query and provide actionable feedback. Be non-judgmental and helpful — this is a tool for analysts to improve their work.

Your expertise is limited to pure SQL analysis. Do not speculate about business logic, application-layer behavior, or runtime performance metrics you cannot observe. If you are uncertain about something, say so explicitly in your message rather than guessing. You cannot execute queries or measure actual performance — frame optimization feedback as pattern-based recommendations, not guarantees.

${contextParts.join("\n")}

Use the detected SQL dialect to inform your analysis. Apply dialect-specific knowledge — for example, MySQL's implicit type coercion, PostgreSQL's array/JSONB operators, SQL Server's TOP vs LIMIT, or T-SQL-specific date functions. If a query uses syntax valid in the detected dialect but non-standard, note it as informational rather than flagging it as an error.

Analyze across these enabled categories:
${categoryDescriptions}

Return a JSON array of feedback items. Each item must have:
- "agentType": one of ${JSON.stringify(categories)}
- "severity": "error" | "warning" | "info" | "success"
  - Use "error" only for actual bugs or likely runtime failures
  - Use "warning" for things that are probably wrong or will cause problems
  - Use "info" for suggestions and observations
  - Use "success" to acknowledge good practices you notice
- "title": short title (under 60 chars)
- "message": detailed explanation
- "suggestion": actionable suggestion or null
- "lineNumber": relevant line number (1-indexed) or null

Guidelines:
- Aim for 3-8 items total across all categories — be concise and high-signal
- Prioritize by impact: list errors and likely bugs first, then warnings, then informational suggestions. Front-load the most critical issues
- For each feedback item, ensure the message is specific and actionable — reference the exact column, table, clause, or line involved rather than making generic observations
- Include at least one "success" item if the query has any good practices
- Do not repeat suggestions the user has already accepted
- If schemas are provided:
  - Validate column references, table names, and types against the schema
  - Use the schema to suppress false positives — do not flag column references as "ambiguous" if the schema resolves them unambiguously to a single table
  - Do not warn about missing table qualifiers on columns that only exist in one joined table according to the schema
- If schemas are NOT provided:
  - Flag genuinely ambiguous column references (e.g., unqualified columns in multi-table JOINs) as warnings
  - Recommend that the user add schema definitions for more precise analysis
  - Provide general best-practice recommendations (e.g., always prefix columns with table aliases in JOINs) rather than definitive correctness judgments
- If documents are provided, check for consistency with documented conventions
- When generating suggestions, ensure they are pure SQL transformations that preserve the query's semantic intent. Do not suggest changes that would alter the result set, NULL handling, or row count — the downstream QA validator will reject such suggestions

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
 * QA validation — separate LLM call that independently reviews each
 * recommendation for semantic, logical, and performance safety.
 *
 * This MUST be a separate call from analysis so the reviewer has fresh
 * context and acts as an independent gate — the model that generated
 * the recommendations should not be the one deciding if they are safe.
 */
export async function llmValidateRecommendations(
  originalSql: string,
  recommendations: Array<{
    agentType: string;
    severity: string;
    title: string;
    message: string;
    suggestion: string | null;
    lineNumber: number | null;
  }>,
  dialect: string = "Standard SQL"
): Promise<Array<{
  agentType: string;
  severity: string;
  title: string;
  message: string;
  suggestion: string | null;
  lineNumber: number | null;
}>> {
  // Only validate recommendations that have concrete SQL suggestions
  const withSuggestions = recommendations.filter((r) => r.suggestion && r.suggestion.trim().length > 0);
  const withoutSuggestions = recommendations.filter((r) => !r.suggestion || r.suggestion.trim().length === 0);

  if (withSuggestions.length === 0) {
    return recommendations;
  }

  const openai = getClient();

  const pairs = withSuggestions.map((r, i) => (
    `### Recommendation ${i + 1}: "${r.title}" [${r.agentType}/${r.severity}]
Message: ${r.message}
Suggestion: ${r.suggestion}`
  )).join("\n\n");

  const response = await openai.chat.completions.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `You are a rigorous SQL QA reviewer. Your job is to protect the user from recommendations that would silently change query behavior.

Given the original SQL and a set of recommendations with suggestions, evaluate EACH recommendation for:

1. **Semantic equivalence**: Would applying the suggestion change the result set? (row count, column values, NULL handling, DISTINCT behavior, aggregate results)
2. **Logical equivalence**: Would it change the filtering, join conditions, grouping, or ordering?
3. **Performance safety**: Could it cause performance degradation? (removing indexes hints, adding unnecessary subqueries, changing join order in problematic ways)

Dialect: ${dialect}

Original SQL:
\`\`\`sql
${originalSql}
\`\`\`

${pairs}

For EACH recommendation (by number), return a JSON array of verdict objects:
- "index": the recommendation number (1-indexed)
- "verdict": "safe" | "bug_fix" | "reject"
  - "safe": The suggestion preserves semantics, logic, and performance. Keep it.
  - "bug_fix": The suggestion intentionally changes semantics/logic because it fixes a genuine bug. Keep it but it should be flagged for user review.
  - "reject": The suggestion would silently change semantics, logic, or degrade performance without fixing a bug. Remove it.
- "reason": brief explanation of why (1-2 sentences)

Return ONLY the JSON array.`,
      },
    ],
  });

  const text = extractText(response);

  let verdicts: Array<{ index: number; verdict: string; reason: string }> = [];
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      verdicts = JSON.parse(jsonMatch[0]);
    } catch {
      return recommendations;
    }
  }

  if (verdicts.length === 0) {
    return recommendations;
  }

  const verdictMap = new Map<number, { verdict: string; reason: string }>();
  for (const v of verdicts) {
    verdictMap.set(v.index, v);
  }

  const validated: typeof recommendations = [];

  for (let i = 0; i < withSuggestions.length; i++) {
    const rec = withSuggestions[i];
    const v = verdictMap.get(i + 1);

    if (!v || v.verdict === "safe") {
      validated.push(rec);
    } else if (v.verdict === "bug_fix") {
      validated.push({
        ...rec,
        severity: "error",
        title: `[Bug?] ${rec.title}`,
        message: `${rec.message}\n\nQA Review: This suggestion intentionally changes query behavior because a potential bug was identified. ${v.reason}`,
      });
    }
    // verdict === "reject" → omitted
  }

  return [...validated, ...withoutSuggestions];
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

  console.log("[schema-parse] ── STAGE 1: INPUT ──");
  console.log("[schema-parse] fileName:", fileName, "| rawContent length:", rawContent.length);
  console.log("[schema-parse] rawContent first 300 chars:", JSON.stringify(rawContent.slice(0, 300)));
  console.log("[schema-parse] rawContent last  200 chars:", JSON.stringify(rawContent.slice(-200)));

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

  console.log("[schema-parse] ── STAGE 2: LLM RAW RESPONSE ──");
  console.log("[schema-parse] response length:", text.length);
  console.log("[schema-parse] response first 800 chars:", text.slice(0, 800));
  if (text.length > 800) {
    console.log("[schema-parse] response last  400 chars:", text.slice(-400));
  }

  console.log("[schema-parse] ── STAGE 3: JSON EXTRACTION ──");
  const result = extractJsonObject(text);

  if (!result) {
    const error = `extractJsonObject returned null — could not find valid JSON object in LLM response. Full response: ${text.slice(0, 500)}`;
    console.error("[schema-parse] FAIL:", error);
    return { parsed: rawContent, tables: [], error };
  }

  console.log("[schema-parse] extractJsonObject succeeded. Top-level keys:", Object.keys(result));
  console.log("[schema-parse] result.tables type:", typeof result.tables, "| isArray:", Array.isArray(result.tables));
  if (Array.isArray(result.tables)) {
    console.log("[schema-parse] result.tables length:", (result.tables as unknown[]).length);
    // Log first table entry in detail to see shape
    if ((result.tables as unknown[]).length > 0) {
      console.log("[schema-parse] result.tables[0] sample:", JSON.stringify((result.tables as unknown[])[0]).slice(0, 500));
    }
  } else {
    console.error("[schema-parse] FAIL: result.tables is NOT an array! Value:", JSON.stringify(result.tables).slice(0, 300));
    const error = `LLM returned JSON but 'tables' is ${typeof result.tables}, not an array. Keys: ${Object.keys(result).join(", ")}`;
    return { parsed: rawContent, tables: [], error };
  }

  console.log("[schema-parse] result.ddl type:", typeof result.ddl, "| length:", typeof result.ddl === "string" ? result.ddl.length : "N/A");

  console.log("[schema-parse] ── STAGE 4: TABLE VALIDATION ──");

  // Log each raw table entry before filtering
  const rawTables = result.tables as Array<Record<string, unknown>>;
  for (let i = 0; i < rawTables.length; i++) {
    const t = rawTables[i];
    const nameOk = typeof t.name === "string" && (t.name as string).length > 0;
    const colsOk = Array.isArray(t.columns);
    const colCount = colsOk ? (t.columns as unknown[]).length : 0;
    console.log(
      `[schema-parse]   table[${i}]: name=${JSON.stringify(t.name)} (${nameOk ? "OK" : "FAIL"})` +
      ` | columns isArray=${colsOk} count=${colCount}` +
      ` | relationships isArray=${Array.isArray(t.relationships)} count=${Array.isArray(t.relationships) ? (t.relationships as unknown[]).length : 0}`
    );
    if (!nameOk || !colsOk) {
      console.error(`[schema-parse]   table[${i}] WILL BE FILTERED OUT — raw:`, JSON.stringify(t).slice(0, 300));
    }
  }

  // Validate and normalize each table entry
  const tables: ParsedTable[] = rawTables
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

  console.log("[schema-parse] ── STAGE 5: FINAL OUTPUT ──");
  console.log("[schema-parse] tables after validation:", tables.length, "of", rawTables.length, "raw entries");

  if (tables.length === 0) {
    const error = `All ${rawTables.length} LLM table entries were filtered out during validation. First raw entry: ${JSON.stringify(rawTables[0]).slice(0, 300)}`;
    console.error("[schema-parse] FAIL:", error);
    return { parsed: rawContent, tables: [], error };
  }

  for (const t of tables) {
    const pks = t.columns.filter(c => c.isPrimaryKey).map(c => c.name);
    const rels = (t.relationships || []).map(r => `${r.fromCol}→${r.toTable}.${r.toCol}`);
    console.log(
      `[schema-parse]   ✓ ${t.name}: ${t.columns.length} cols` +
      ` | PKs: ${pks.length > 0 ? pks.join(", ") : "(none)"}` +
      ` | FKs: ${rels.length > 0 ? rels.join(", ") : "(none)"}`
    );
  }

  const ddl = typeof result.ddl === "string" ? result.ddl : rawContent;
  console.log("[schema-parse] DDL source:", typeof result.ddl === "string" ? "from LLM" : "fallback to rawContent", "| length:", ddl.length);

  return { parsed: ddl, tables };
}
