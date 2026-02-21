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

/** Recommendation shape — core fields plus arbitrary extra metadata from the LLM. */
export type AnalysisRecommendation = Record<string, unknown> & {
  agentType: string;
  severity: string;
  title: string;
  message: string;
  suggestion: string | null;
  lineNumber: number | null;
};

/**
 * Query analysis — single LLM call to generate comprehensive recommendations.
 *
 * Dynamically detects relevant feedback categories based on the input query.
 * Returns structured feedback items with before/after SQL comparisons where
 * applicable. Categories are not limited to a fixed set — the LLM adapts
 * them based on the query's characteristics.
 */
/** Shape for passing full previous feedback state into the analyzer. */
export interface PreviousFeedbackItem {
  agentType: string;
  severity: string;
  title: string;
  message: string;
  suggestion: string | null;
  lineNumber: number | null;
  isResolved: boolean;
}

export async function llmAnalyzeQuery(
  sql: string,
  options: {
    dialect?: string;
    schemas?: string;
    documents?: string;
    previousFeedback?: PreviousFeedbackItem[];
    enabledCategories?: string[];
  } = {}
): Promise<AnalysisRecommendation[]> {
  const openai = getClient();

  const dialect = options.dialect || "Standard SQL";
  const enabledCategories = options.enabledCategories || [];

  const contextParts: string[] = [];

  contextParts.push(`Detected SQL dialect: ${dialect}`);

  if (options.schemas) {
    contextParts.push(`\nSchema definitions:\n${options.schemas}`);
  }

  if (options.documents) {
    contextParts.push(`\nReference documentation:\n${options.documents}`);
  }

  // Pass full previous analysis state so the LLM can learn from user decisions
  if (options.previousFeedback && options.previousFeedback.length > 0) {
    const accepted = options.previousFeedback.filter(f => f.isResolved);
    const dismissed = options.previousFeedback.filter(f => !f.isResolved);

    if (accepted.length > 0) {
      const acceptedText = accepted
        .map(f => `- [${f.agentType}/${f.severity}] "${f.title}": ${f.message}${f.suggestion ? ` → Suggestion: ${f.suggestion}` : ""}`)
        .join("\n");
      contextParts.push(`\n## Previously Accepted Feedback (user agreed with these — do not repeat the same findings, but use them to understand user preferences and patterns they care about):\n${acceptedText}`);
    }

    if (dismissed.length > 0) {
      const dismissedText = dismissed
        .map(f => `- [${f.agentType}/${f.severity}] "${f.title}": ${f.message}${f.suggestion ? ` → Suggestion: ${f.suggestion}` : ""}`)
        .join("\n");
      contextParts.push(`\n## Previous Unresolved Feedback (from last analysis run — avoid repeating these exact findings unless the underlying issue persists in the current SQL; use them as context to provide deeper or more refined analysis):\n${dismissedText}`);
    }
  }

  // Build prioritization guidance from enabled categories
  const prioritySection = enabledCategories.length > 0
    ? `\nThe user has prioritized the following analysis areas (emphasize these in your output, but still report critical findings in other areas):\n${enabledCategories.map(c => `- ${c}`).join("\n")}`
    : "";

  const response = await openai.chat.completions.create({
    model: MODEL,
    max_tokens: 8192,
    messages: [
      {
        role: "user",
        content: `You are an expert SQL analyst providing thorough, structured, actionable feedback. Your goal is to deliver a comprehensive review covering every significant aspect of the input — from performance and correctness to security, compliance, schema design, and alternative approaches. Be constructive and non-judgmental.

Your expertise is limited to pure SQL analysis. Do not speculate about business logic, application-layer behavior, or runtime performance metrics you cannot observe. If you are uncertain, say so explicitly rather than guessing. Frame optimization feedback as pattern-based recommendations, not guarantees.

${contextParts.join("\n")}
${prioritySection}

## Dialect Awareness
Use the detected SQL dialect (${dialect}) throughout your analysis. Apply engine-specific knowledge:
- **MySQL**: implicit type coercion, lack of full outer join, index hints, optimizer behavior, specific function variants (IFNULL vs COALESCE)
- **PostgreSQL**: array/JSONB operators, CTEs as optimization fences (pre-v12), lateral joins, window function nuances
- **SQL Server / T-SQL**: TOP vs LIMIT, CROSS APPLY/OUTER APPLY, date functions (DATEADD/DATEDIFF), NOLOCK hints, SET NOCOUNT
- **Oracle**: ROWNUM vs FETCH FIRST, CONNECT BY, analytic functions, PL/SQL specifics
If syntax is valid in the detected dialect but non-standard, note it as informational rather than flagging it as an error.

## Input Handling
The input may be a single query, a multi-statement batch, a stored procedure, or disconnected statements. Adapt accordingly:
- For multi-statement inputs: analyze cross-statement dependencies — temp tables created but never dropped, variables declared but unused, inconsistent transaction handling, cursor mismanagement
- For stored procedures: evaluate parameter usage, control flow (IF/WHILE/TRY-CATCH), error handling adequacy, transaction scope
- For disconnected statements: analyze each independently but flag shared anti-patterns
- Use line numbers to anchor every feedback item to the specific location in the input

## Dynamic Category Assignment
Dynamically assign an agentType to each finding based on what you detect. Common categories include:
- **structure** — Query structure, nesting depth, complexity, readability, CTE usage
- **optimization** — Performance patterns (SELECT *, missing WHERE, index usage, N+1, join efficiency, correlated subqueries)
- **error** — Bugs, typos, unmatched parentheses, ambiguous references, type mismatches, logic errors
- **style** — Keyword casing consistency, naming conventions, alias consistency
- **formatting** — Whitespace, line breaks, alignment, visual layout
- **documentation** — Comments, query purpose clarity, maintainability
- **security** — SQL injection vectors, excessive permissions, dynamic SQL risks, unparameterized inputs
- **compliance** — Data privacy patterns (selecting PII without filters), audit trail gaps, retention policy concerns
- **schema_design** — Data type mismatches, missing constraints, denormalization issues, index recommendations
- **alternative_design** — Fundamentally different query approaches (e.g., window functions instead of self-joins, recursive CTEs, MERGE instead of INSERT+UPDATE)

You are NOT limited to these. If the query exhibits issues in another domain, create an appropriate agentType slug (lowercase, snake_case).

## Output Format
Return a JSON array of feedback items. Each item must have:
- "agentType": string — dynamic category slug (see above)
- "severity": "error" | "warning" | "info" | "success"
  - "error" — actual bugs, likely runtime failures, security vulnerabilities
  - "warning" — probable issues, performance risks, practices that will cause problems
  - "info" — suggestions, observations, alternative approaches
  - "success" — acknowledgment of good practices
- "title": string — short, specific title (under 60 chars)
- "message": string — detailed explanation referencing exact tables, columns, clauses, and line numbers
- "suggestion": string | null — actionable text explanation of the recommended change
- "beforeSql": string | null — the relevant SQL snippet from the original query that would change (extract the minimal meaningful fragment)
- "afterSql": string | null — the rewritten SQL snippet showing the recommended change
- "lineNumber": number | null — 1-indexed line number in the original input

## Guidelines
- **Be thorough**: There is no hard cap on findings. Report every significant issue. For a simple query, 3-8 items is typical. For complex stored procedures or multi-statement batches, produce as many findings as warranted — 15, 20, or more if the input justifies it. Never pad with low-value observations; every item must be high-signal.
- **Priority ordering**: Return items in descending order of importance. Errors and bugs first, then warnings, then informational items. Within the same severity, front-load the highest-impact findings.
- **Before/after SQL**: For every suggestion that modifies SQL, include "beforeSql" (the original fragment) and "afterSql" (the improved fragment). Keep snippets minimal — only the relevant clause or statement, not the entire query. Set both to null for observations with no concrete SQL change.
- **Specificity**: Reference exact column names, table names, clauses, and line numbers. Never make generic statements like "consider optimizing this query."
- **At least one success**: If the query has any good practices, acknowledge them.
- **Do not repeat**: Skip suggestions the user has already accepted.
- **Schema-aware analysis**:
  - If schemas are provided: validate column references, types, and joins against the schema. Suppress false positives — do not flag columns as ambiguous if the schema resolves them.
  - If schemas are NOT provided: flag genuinely ambiguous references as warnings. Recommend adding schema definitions for more precise analysis.
- **Document-aware analysis**: If documents are provided, check for consistency with documented conventions.
- **Semantic safety**: When generating afterSql, ensure it preserves the query's semantic intent. Do not suggest changes that alter the result set, NULL handling, or row count — the downstream QA validator will reject such changes.
- **Alternative designs**: When you see an opportunity for a fundamentally better approach (not just a tweak), include it as an "alternative_design" item with full before/after SQL and explanation of trade-offs.
- **Security and compliance**: Actively look for SQL injection risks, excessive data exposure, missing access controls, PII handling, and audit gaps. Flag these even if not in the prioritized categories.

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
      const items = JSON.parse(jsonMatch[0]);
      // Normalize: ensure core fields exist, preserve all extra LLM output
      return items.map((item: Record<string, unknown>) => ({
        ...item,
        agentType: (item.agentType as string) || "structure",
        severity: (item.severity as string) || "info",
        title: (item.title as string) || "Untitled",
        message: (item.message as string) || "",
        suggestion: (item.suggestion as string) ?? null,
        lineNumber: (item.lineNumber as number) ?? null,
      })) as AnalysisRecommendation[];
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
  recommendations: AnalysisRecommendation[],
  dialect: string = "Standard SQL"
): Promise<AnalysisRecommendation[]> {
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
