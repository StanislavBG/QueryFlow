import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not set. Add it to your environment to enable LLM features.");
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

export function isLLMConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/**
 * Format a SQL query using Claude per international SQL documentation standards
 * (ISO/IEC 9075 style conventions, human readability best practices).
 */
export async function llmFormatQuery(
  sql: string,
  dialect: string = "Standard SQL",
  schemas?: string
): Promise<{ formatted: string; notes: string }> {
  const anthropic = getClient();

  const schemaContext = schemas
    ? `\n\nThe user has the following schema definitions for context:\n${schemas}`
    : "";

  const response = await anthropic.messages.create({
    model: "claude-opus-4-6-20250918",
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

  const text = response.content[0].type === "text" ? response.content[0].text : "";

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
  const anthropic = getClient();

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

  const response = await anthropic.messages.create({
    model: "claude-opus-4-6-20250918",
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

  const text = response.content[0].type === "text" ? response.content[0].text : "";

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
  const anthropic = getClient();

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

  const response = await anthropic.messages.create({
    model: "claude-opus-4-6-20250918",
    max_tokens: 4096,
    messages: [{ role: "user", content: parts.join("\n") }],
  });

  return response.content[0].type === "text" ? response.content[0].text : "Unable to process the question.";
}

/**
 * Parse raw text content into structured schema definitions.
 */
export async function llmParseSchema(
  rawContent: string,
  fileName: string
): Promise<{ parsed: string; tables: Array<{ name: string; columns: string[] }> }> {
  const anthropic = getClient();

  const response = await anthropic.messages.create({
    model: "claude-opus-4-6-20250918",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `Parse the following content from file "${fileName}" into clean SQL schema definitions (CREATE TABLE statements). The content may be:
- Raw DDL/SQL
- CSV headers
- Tab-separated data
- JSON schema
- Plain text descriptions of tables
- ERD text notation

Return a JSON object with:
- "parsed": the clean CREATE TABLE SQL statements as a string
- "tables": array of objects with "name" (table name) and "columns" (array of column name strings)

If the content is already valid DDL, clean it up and standardize it.
If it's a data format, infer the schema from the structure.

Content:
\`\`\`
${rawContent}
\`\`\``,
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const result = JSON.parse(jsonMatch[0]);
      return {
        parsed: result.parsed || rawContent,
        tables: result.tables || [],
      };
    } catch {
      return { parsed: rawContent, tables: [] };
    }
  }
  return { parsed: rawContent, tables: [] };
}
