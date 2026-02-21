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
 * Uses one context window with the query, schema, dialect, documents,
 * and previously accepted feedback to produce all recommendation categories.
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

${contextParts.join("\n")}

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
- Include at least one "success" item if the query has any good practices
- Do not repeat suggestions the user has already accepted
- If schemas are provided, validate column references, table names, and types
- If documents are provided, check for consistency with documented conventions

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
 * QA validation step: evaluates each recommendation's before/after SQL pair.
 * Removes recommendations that would cause:
 *  - Semantic differences (different result sets, row counts, NULL handling)
 *  - Logical differences (different filtering, join behavior, ordering)
 *  - Performance degradation (less efficient execution plans)
 *
 * Recommendations that identify genuine bugs are kept but flagged with
 * severity "error" so the user can decide.
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

  // Build the evaluation prompt with all before/after pairs
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
      // If parsing fails, keep all recommendations (fail open)
      return recommendations;
    }
  }

  if (verdicts.length === 0) {
    return recommendations;
  }

  // Build a map of verdicts by index
  const verdictMap = new Map<number, { verdict: string; reason: string }>();
  for (const v of verdicts) {
    verdictMap.set(v.index, v);
  }

  // Filter and transform recommendations
  const validated: typeof recommendations = [];

  for (let i = 0; i < withSuggestions.length; i++) {
    const rec = withSuggestions[i];
    const v = verdictMap.get(i + 1);

    if (!v || v.verdict === "safe") {
      // Keep as-is
      validated.push(rec);
    } else if (v.verdict === "bug_fix") {
      // Keep but mark as a suspected bug for user review
      validated.push({
        ...rec,
        severity: "error",
        title: `[Bug?] ${rec.title}`,
        message: `${rec.message}\n\n⚠️ QA Review: This suggestion intentionally changes query behavior because a potential bug was identified. ${v.reason}`,
      });
    }
    // verdict === "reject" → omitted from results
  }

  // Combine: validated suggestions + items without suggestions (info/success items)
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
 * Extract a JSON array from LLM text output.
 *
 * LLMs often wrap JSON in markdown fences or prepend reasoning text.
 * This helper tries progressively looser strategies to find the array.
 */
function extractJsonArray(text: string): unknown[] | null {
  // Strip markdown code fences
  const stripped = text.replace(/```(?:json)?\s*/g, "").replace(/```/g, "");

  // Strategy 1: find the substring starting at the first `[{` and ending at the last `}]`
  const start = stripped.indexOf("[");
  const end = stripped.lastIndexOf("]");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(stripped.slice(start, end + 1));
      if (Array.isArray(parsed)) return parsed;
    } catch { /* try next strategy */ }
  }

  // Strategy 2: try to parse the entire stripped text
  try {
    const parsed = JSON.parse(stripped);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* give up */ }

  return null;
}

/**
 * Parse raw text content into structured schema definitions.
 *
 * Single LLM call to analyze the content and extract structured table/column
 * metadata. DDL is then built locally from the structured result — this is
 * deterministic and cannot fail.
 *
 * The prompt makes zero format assumptions. Users paste anything — MySQL
 * DESCRIBE output, raw DDL, CSV headers, JSON schemas, wiki pages, etc.
 * The LLM acts as a schema-extraction agent that figures it out.
 */
export async function llmParseSchema(
  rawContent: string,
  fileName: string
): Promise<{ parsed: string; tables: Array<{ name: string; columns: string[] }>; error?: string }> {
  const openai = getClient();

  console.log("[schema-parser] Starting parse for:", fileName, "content length:", rawContent.length);

  const response = await openai.chat.completions.create({
    model: MODEL,
    max_tokens: 8192,
    messages: [
      {
        role: "user",
        content: `You are a schema-extraction agent. A user uploaded content from file "${fileName}". Your ONLY job: find every database table and column in this content and output structured JSON.

The content can be in ANY format — database client output (e.g. MySQL DESCRIBE, \\d output), SQL DDL, spreadsheets, CSV, JSON, documentation, anything. Figure out what it is and extract the schema.

RULES:
- Strip schema/database prefixes from table names (e.g. "mydb.orders" → "orders", "gsm.temp_table" → "temp_table")
- Preserve original data types exactly (e.g. varchar(15), decimal(10,2), int)
- Identify primary keys and nullability where possible
- Ignore non-schema content (USE statements, SHOW commands, comments, etc.)
- Output ONLY the JSON array below — no explanation, no markdown fences, no other text

OUTPUT FORMAT — a JSON array, one element per table:
[{"table":"table_name","columns":[{"name":"col","type":"TYPE","nullable":false,"primaryKey":true}]}]

CONTENT:
${rawContent}`,
      },
    ],
  });

  const text = extractText(response);

  console.log("[schema-parser] LLM response length:", text.length, "preview:", text.slice(0, 500));

  const analysis = extractJsonArray(text) as Array<{
    table: string;
    columns: Array<{ name: string; type: string; nullable: boolean; primaryKey: boolean }>;
  }> | null;

  if (!analysis || analysis.length === 0) {
    const error = `LLM returned no parseable table data. Response preview: ${text.slice(0, 300)}`;
    console.error("[schema-parser]", error);
    return { parsed: rawContent, tables: [], error };
  }

  // Validate structure — filter out malformed entries
  const valid = analysis.filter(
    (t) => typeof t.table === "string" && t.table.length > 0 && Array.isArray(t.columns)
  );

  if (valid.length === 0) {
    const error = `LLM returned data but no valid table entries. Parsed: ${JSON.stringify(analysis).slice(0, 300)}`;
    console.error("[schema-parser]", error);
    return { parsed: rawContent, tables: [], error };
  }

  // Build CREATE TABLE DDL deterministically from the structured analysis
  const ddl = valid.map((t) => {
    const pkCols = t.columns.filter((c) => c.primaryKey).map((c) => c.name);
    const colLines = t.columns.map((c) => {
      const parts = [c.name, c.type || "TEXT"];
      if (!c.nullable) parts.push("NOT NULL");
      if (c.primaryKey && pkCols.length === 1) parts.push("PRIMARY KEY");
      return `  ${parts.join(" ")}`;
    });
    if (pkCols.length > 1) {
      colLines.push(`  PRIMARY KEY (${pkCols.join(", ")})`);
    }
    return `CREATE TABLE ${t.table} (\n${colLines.join(",\n")}\n);`;
  }).join("\n\n");

  const tables = valid.map((t) => ({
    name: t.table,
    columns: t.columns.map((c) => c.name),
  }));

  return { parsed: ddl, tables };
}
