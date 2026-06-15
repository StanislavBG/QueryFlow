import OpenAI from "openai";
import type { WaterfallAnalysis, WaterfallNode, WaterfallEdge } from "@shared/waterfall";

// ---------------------------------------------------------------------------
// In-memory LLM error log (ring buffer, last 50 entries)
// ---------------------------------------------------------------------------

export interface LlmErrorEntry {
  id: number;
  timestamp: string;
  source: string;       // e.g. "waterfall", "analyze", "format", "parseSchema"
  message: string;
  rawResponse?: string; // first 4000 chars of the raw LLM output (if available)
  inputPreview?: string; // first 500 chars of the input that caused the error
}

const MAX_ERROR_LOG = 50;
let _errorSeq = 0;
const _errorLog: LlmErrorEntry[] = [];

export function logLlmError(
  source: string,
  message: string,
  opts?: { rawResponse?: string; inputPreview?: string }
): void {
  _errorSeq++;
  const entry: LlmErrorEntry = {
    id: _errorSeq,
    timestamp: new Date().toISOString(),
    source,
    message,
    rawResponse: opts?.rawResponse?.slice(0, 4000),
    inputPreview: opts?.inputPreview?.slice(0, 500),
  };
  _errorLog.push(entry);
  if (_errorLog.length > MAX_ERROR_LOG) _errorLog.shift();
  console.error(`[llm-error][${source}] ${message}`);
  if (opts?.rawResponse) {
    console.error(`[llm-error][${source}] Raw response (first 500):`, opts.rawResponse.slice(0, 500));
  }
}

export function getLlmErrors(): LlmErrorEntry[] {
  return [..._errorLog];
}

export function clearLlmErrors(): void {
  _errorLog.length = 0;
}

// ---------------------------------------------------------------------------

let client: OpenAI | null = null;

/** Default model — GPT-4.1: 1M context, 32k output, best for code/SQL analysis. */
const MODEL = "gpt-4.1";

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
 * Curate a single, self-contained HTML overview of a schema, optimized for
 * humans to explore. Receives the schema's structured documentation (as
 * Markdown, the source of truth) and returns a complete HTML document with
 * richer explanatory prose than the raw exports — without inventing any
 * structural facts (tables, columns, types, keys, relationships).
 */
export async function llmGenerateSchemaOverviewHtml(
  schemaName: string,
  schemaMarkdown: string,
): Promise<string> {
  const openai = getClient();

  const response = await openai.chat.completions.create({
    model: MODEL,
    max_tokens: 16384,
    messages: [
      {
        role: "user",
        content: `You are a senior data architect writing a schema overview document for fellow analysts to explore and understand a database schema.

Below is the authoritative, structured documentation for the schema "${schemaName}" (in Markdown). It is the single source of truth.

Produce a SINGLE, SELF-CONTAINED HTML document optimized for HUMAN EXPLORATION. Goals:
- Cover the SAME information as the source (every table, every column with its type and key status, all descriptions/notes, and all relationships) — do not omit any table or column.
- Add MORE explanatory text than the raw source: a clear narrative overview of what the schema represents, how the tables fit together, how to navigate it, and what each table is for. Where relationships exist, explain them in prose.
- Be optimized for reading and exploration: an introduction, a table of contents with in-page anchor links, per-table sections, readable column tables, and a relationships summary.
- Immediately AFTER the introductory overview section (and before the table of contents / per-table sections), output the exact placeholder comment on its own line: <!--QF_ERD_DIAGRAMS--> . A visual ERD (full-page diagram plus a slide version) will be inserted there automatically. Do NOT attempt to draw your own diagram, SVG, or ASCII art — just emit the placeholder.

STRICT ACCURACY RULES (this is reviewed by expert analysts who will not tolerate fabrication):
- Do NOT invent tables, columns, data types, primary keys, or relationships. Use ONLY what appears in the source.
- You MAY add interpretive prose, but ground it in the provided descriptions/notes. Do not assert facts that aren't supported by the source. When inferring purpose from a name, phrase it as a likely interpretation, not a certainty.
- Preserve exact identifier names, types, and key designations character-for-character.

OUTPUT REQUIREMENTS:
- Return ONLY a complete HTML document starting with <!DOCTYPE html>. No markdown fences, no commentary before or after.
- Fully self-contained: all CSS inline in a <style> tag, no external resources, no JavaScript required, no external fonts/CDNs.
- Clean, professional, readable styling (good typography, spacing, a clear table of contents, subtle table styling). Use system fonts.
- Include the schema name in the <title> and a header.

SOURCE DOCUMENTATION (Markdown):
${schemaMarkdown}`,
      },
    ],
  });

  let html = extractText(response).trim();
  // Strip accidental markdown fences if the model added them.
  const fenced = html.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fenced) html = fenced[1].trim();
  return html;
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
  isDismissed: boolean;
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
    const accepted = options.previousFeedback.filter(f => f.isResolved && !f.isDismissed);
    const dismissed = options.previousFeedback.filter(f => f.isResolved && f.isDismissed);
    const unresolved = options.previousFeedback.filter(f => !f.isResolved);

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
      contextParts.push(`\n## Dismissed Feedback (user marked these as WRONG or NOT RELEVANT — do NOT repeat these findings or similar patterns. The user considers them incorrect or inapplicable):\n${dismissedText}`);
    }

    if (unresolved.length > 0) {
      const unresolvedText = unresolved
        .map(f => `- [${f.agentType}/${f.severity}] "${f.title}": ${f.message}${f.suggestion ? ` → Suggestion: ${f.suggestion}` : ""}`)
        .join("\n");
      contextParts.push(`\n## Previous Unresolved Feedback (from last analysis run — avoid repeating these exact findings unless the underlying issue persists; provide deeper or more refined analysis instead):\n${unresolvedText}`);
    }
  }

  // Build prioritization guidance from enabled categories
  const prioritySection = enabledCategories.length > 0
    ? `\nThe user has prioritized the following analysis areas (emphasize these in your output, but still report critical findings in other areas):\n${enabledCategories.map(c => `- ${c}`).join("\n")}`
    : "";

  // GPT-4.1 supports up to 32768 output tokens
  const maxTokens = 32768;

  const response = await openai.chat.completions.create({
    model: MODEL,
    max_tokens: maxTokens,
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
- "reason": string — concise explanation (2-3 sentences) of WHY this finding was flagged. What specific pattern, anti-pattern, or risk in the user's query triggered this card? This is the "elevator pitch" — a reader should understand the core issue after reading just this field. Reference the specific clause, table, or column that triggered it. Do NOT repeat this content verbatim in the message field.
- "bestPractice": string — the recommended approach or industry best practice (2-4 sentences). What SHOULD be done instead, and why is it the accepted standard? Reference the specific SQL principle, pattern, or convention (e.g., "Use explicit JOIN syntax instead of comma-separated tables because…"). This is higher-level guidance — the detailed implementation fix goes in "suggestion". Do NOT repeat this content in the message or suggestion fields.
- "message": string — **deep-dive analysis** (minimum 6-10 sentences). Since the "reason" field covers WHY and "bestPractice" covers the recommendation, focus this field on the in-depth technical details the reader consumes to fully understand the finding. Cover:
  (a) the underlying SQL principle or database internals concept (e.g., sargability, index usage, NULL three-valued logic, set-based vs row-based thinking, cardinality estimation, predicate pushdown, lock contention);
  (b) how the issue manifests at scale or under edge conditions the analyst may not have considered (empty result sets, NULLs in join keys, data skew, concurrent writes);
  (c) realistic impact estimates where applicable (e.g., "on a 10M-row orders table, this full scan could take 30+ seconds");
  (d) any caveats, trade-offs, or situations where the current approach might actually be acceptable;
  (e) connection to related findings in this analysis or broader query design patterns.
  Write for a seasoned business analyst or DBA — be precise, cite specifics, avoid generic advice. Do NOT re-state the reason or best practice — add NEW analytical depth.
- "suggestion": string | null — actionable, detailed text explanation of the recommended change (4-6 sentences minimum). Explain not just WHAT to change but WHY this specific fix works, how it interacts with the rest of the query, and any implementation considerations (e.g., index requirements, NULL handling implications, dialect-specific syntax). Include concrete reasoning the analyst can use to justify the change to stakeholders.
- "beforeSql": string | null — the FULL relevant section/clause of the original query that this finding relates to (not just the single changed token — include enough surrounding SQL for the analyst to immediately recognize the code section in context: the full SELECT list, the full JOIN + ON clause, the full WHERE block, the full CTE, etc.)
- "afterSql": string | null — the rewritten version of the SAME full section showing the recommended change in context
- "lineNumber": number | null — 1-indexed line number in the original input where this section begins

## Guidelines
- **Be thorough — enumerate every instance**: There is no hard cap on findings. Report every significant issue AND every individual instance of each pattern. For a simple query, 8-15 items is typical. For complex stored procedures or multi-statement batches, produce 20, 30, or more if the input justifies it — one card per concrete code location. Never summarize a pattern with a single generic card when the query contains 5 specific instances the analyst needs to evaluate individually. Every card must reference a specific line and include before/after SQL.
- **Priority ordering**: Return items in descending order of importance. Errors and bugs first, then warnings, then informational items. Within the same severity, front-load the highest-impact findings.
- **Before/after SQL — VERBATIM, NO SUMMARIES**: For every suggestion that modifies SQL, include "beforeSql" and "afterSql". CRITICAL RULES:
  - **NEVER use ellipsis ("..."), placeholders, or summaries** in beforeSql or afterSql. Every token must be the actual SQL from the query. "SELECT ... Q1 branch ..." is UNACCEPTABLE — include the real SELECT columns, real WHERE clauses, real expressions character-for-character.
  - Copy the relevant section VERBATIM from the user's input for "beforeSql". Do not paraphrase, abbreviate, or summarize ANY part of the user's SQL — even if sections appear repetitive or structurally similar, subtle differences in column names, conditions, expressions, or join clauses may carry critical business logic. The analyst has tested this SQL for YEARS; do not presume any part is interchangeable.
  - "afterSql" must contain the COMPLETE rewritten version of that same section with the recommended change applied — again with zero abbreviation.
  - If the relevant section is very long (e.g., a 200-line UNION ALL chain), include it IN FULL. Output length is never a reason to summarize. The analyst cannot verify logical equivalence if any SQL is hidden behind "...".
  - Include the full SELECT clause, the full JOIN block, the full WHERE predicate tree, or the full CTE — whatever logical unit contains the change.
  - **EVERY finding MUST include beforeSql and afterSql** — there are no exceptions. For "error"/"warning"/"info" items, show the problematic SQL (before) and the fixed version (after). For "success" items, show the specific SQL that demonstrates the good practice in beforeSql and set afterSql to the same value (confirming no change needed). The analyst needs to see EXACTLY what code you are talking about in every card — a finding without code examples is useless to a senior analyst who reviews code all day.
- **Instance-level findings — one card per occurrence**: When a pattern appears multiple times in the query (e.g., inconsistent keyword casing in 5 places, the same anti-pattern in 3 JOINs, repeated NULL-unsafe arithmetic in multiple CTEs), generate a SEPARATE finding for each instance — at least 3-5 instances per pattern. Each instance must have its own beforeSql/afterSql anchored to the specific line where it occurs. This allows the analyst to evaluate and approve/dismiss each instance independently. Do NOT summarize multiple instances into a single generic finding like "keyword casing is consistent throughout" — instead, show each specific location where the pattern is good or where it deviates. The analyst's query may be 500+ lines; they need to see every individual location.
- **Logical equivalence proof**: When the afterSql restructures the query (e.g., converting UNION ALL branches to CTEs, refactoring subqueries to JOINs), the "suggestion" field MUST explicitly explain WHY the before and after are logically equivalent — covering result set identity, NULL handling, row ordering, duplicate treatment, and any edge cases. If any behavioral difference exists (even minor, such as ordering), it MUST be called out. The analyst's business depends on this SQL — they will not accept a suggestion they cannot verify.
- **Deep, thorough explanations**: The "message" field provides the technical deep-dive. Since "reason" covers the concise why and "bestPractice" covers the recommendation, the message should add NEW analytical depth — internals, scale implications, edge cases, caveats. A message under 6 sentences is NEVER acceptable. Ground every point in specifics: reference exact table names, column names, line numbers, and SQL clauses. Cite the underlying SQL principle or database internals concept. Include realistic scale/impact estimates where applicable (e.g., row counts, scan costs, lock duration). Connect findings to broader patterns when relevant.
- **Audience — senior production SQL analysts**: The target user has 40+ years of experience and reviews SQL all day. Their business and livelihood depend on these queries, which they have tested for correctness over years. Any trivial, generic, or incorrect suggestion will destroy trust in the tool immediately. Every finding must earn its place: provide specific, verifiable, non-obvious value. Never state the obvious. Never make a suggestion you cannot prove is logically equivalent. When in doubt, flag as informational rather than making an overconfident recommendation.
- **Specificity — no generic observations**: Reference exact column names, table names, clauses, and line numbers. Never make generic statements like "consider optimizing this query" or "the script uses consistent casing." Every finding must point to a SPECIFIC line, a SPECIFIC clause, and show the SPECIFIC SQL involved. If you cannot point to a concrete code location with before/after SQL, do not generate the finding.
- **Acknowledge good practices with specific instances**: For each good practice pattern, generate success items referencing specific instances in the SQL with beforeSql/afterSql showing the exact code. Instead of one card saying "keyword casing is consistent," show 2-3 specific instances where good practice is demonstrated, so the analyst can see exactly what you are referencing and confirm they agree.
- **Do not repeat**: Skip suggestions the user has already accepted.
- **Schema-aware analysis**:
  - If schemas are provided: validate column references, types, and joins against the schema. Suppress false positives — do not flag columns as ambiguous if the schema resolves them.
  - If schemas are NOT provided: flag genuinely ambiguous references as warnings. Recommend adding schema definitions for more precise analysis.
- **Document-aware analysis**: If documents are provided, check for consistency with documented conventions.
- **Semantic safety**: When generating afterSql, ensure it preserves the query's semantic intent. Do not suggest changes that alter the result set, NULL handling, or row count — the downstream QA validator will reject such changes.
- **Alternative designs**: When you see an opportunity for a fundamentally better approach (not just a tweak), include it as an "alternative_design" item with full before/after SQL and a thorough explanation of trade-offs (performance, readability, maintainability, compatibility).
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
    max_tokens: 8192,
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
/** Tool definitions for Sage to update schema context via internal APIs. */
const SAGE_TOOLS: Array<{
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}> = [
  {
    type: "function",
    function: {
      name: "update_schema_context",
      description:
        "Update context metadata on schema tables and/or columns. Use this when the user provides table or column definitions, descriptions, or business context that should be saved as metadata on matching tables/columns in their schema. The context is stored directly on the parsed schema objects.",
      parameters: {
        type: "object",
        properties: {
          updates: {
            type: "array",
            description: "List of context updates to apply",
            items: {
              type: "object",
              properties: {
                tableName: {
                  type: "string",
                  description: "Name of the table to update context for",
                },
                tableContext: {
                  type: "string",
                  description:
                    "Business context/description for the table itself. Only set if the user provides table-level context.",
                },
                columnContexts: {
                  type: "array",
                  description:
                    "Column-level context updates. Only include columns the user actually described.",
                  items: {
                    type: "object",
                    properties: {
                      columnName: {
                        type: "string",
                        description: "Name of the column",
                      },
                      context: {
                        type: "string",
                        description:
                          "Business context/description for this column, preserved verbatim from the user's input",
                      },
                    },
                    required: ["columnName", "context"],
                  },
                },
              },
              required: ["tableName"],
            },
          },
        },
        required: ["updates"],
      },
    },
  },
];

export interface SchemaContextUpdate {
  tableName: string;
  tableContext?: string;
  columnContexts?: Array<{ columnName: string; context: string }>;
}

export async function llmAskQuestion(
  question: string,
  queryContext?: string,
  schemas?: string,
  dialect?: string
): Promise<{ answer: string; contextUpdates?: SchemaContextUpdate[] }> {
  const openai = getClient();

  // ── Build the Sage system prompt ──────────────────────────────────
  //
  // The prompt is structured in layers:
  //   1. Identity & disposition  — who Sage is and how it behaves
  //   2. Schema contract         — strict rules around the active schema
  //   3. SQL craft guidelines    — writing, reviewing, and explaining SQL
  //   4. Output format rules     — code blocks, editor integration
  //   5. Tool instructions       — schema context persistence
  //   6. Dynamic context         — dialect, current query, schema DDL
  //
  const systemParts: string[] = [];

  // ── 1. Identity & disposition ───────────────────────────────────
  systemParts.push(
`You are Sage — a senior SQL advisor embedded in the QueryFlow query editor.

WHO YOU SERVE
The analyst you are working with is a seasoned production SQL professional. Their queries drive real business decisions, financial reporting, and operational processes. Respect their expertise:
- Never be condescending. They have likely forgotten more SQL than most people learn.
- Never offer trivial style advice (keyword casing, trailing commas) unless asked.
- Never assume their SQL is wrong. If something looks unusual, ask about intent before suggesting changes.
- When they ask you to write SQL, write it — do not ask clarifying questions you can answer from the schema. Only ask when the schema genuinely lacks the information needed.

HOW YOU COMMUNICATE
- Be direct and concise. Lead with the SQL or the answer, not preamble.
- When you suggest a structural change (CTEs instead of subqueries, refactored JOINs, etc.), explain WHY the result set remains identical — covering NULL handling, row ordering, duplicate treatment, and edge cases.
- When in doubt, flag as informational ("consider this") rather than asserting ("do this").
- Never abbreviate SQL with "..." or placeholders. Every token must be real so the analyst can verify character-by-character.`
  );

  // ── 2. Schema contract ──────────────────────────────────────────
  systemParts.push(
`
SCHEMA CONTRACT — MANDATORY
The analyst has activated specific database schemas below. These define the ONLY tables and columns that exist in their environment.
- Every SQL query you write MUST reference only tables and columns present in the active schema definitions.
- NEVER invent, guess, or assume table names, column names, data types, or relationships that are not explicitly defined in the schema.
- If the schema does not contain the tables or columns needed to answer a question, say so clearly: "The active schema does not include a table/column for X. Please add it or activate the relevant schema."
- Pay attention to schema-qualified names. If the schema DDL uses a prefix (e.g., gsm.table_name), use it in your SQL.
- Pay attention to column data types. Cast and compare correctly (e.g., do not compare a VARCHAR to an INT without an explicit CAST).
- Pay attention to primary keys and relationships. Use them for JOINs rather than guessing join columns.`
  );

  // ── 3. SQL craft guidelines ─────────────────────────────────────
  systemParts.push(
`
SQL CRAFT GUIDELINES
You are capable of writing and advising on the full spectrum of SQL and database programming:

Queries & DML:
- SELECT queries of any complexity: multi-table JOINs, correlated subqueries, window functions, recursive CTEs, PIVOT/UNPIVOT, MERGE statements.
- INSERT, UPDATE, DELETE with proper WHERE guards. Always warn when a statement lacks a WHERE clause.
- UPSERT patterns (INSERT ... ON CONFLICT / MERGE) appropriate to the dialect.

Stored Procedures & Programmability:
- CREATE PROCEDURE / CREATE FUNCTION with proper parameter declarations, error handling (TRY/CATCH, EXCEPTION blocks), transaction control (BEGIN/COMMIT/ROLLBACK), and cursor usage when appropriate.
- Advise on when to use stored procedures vs. application-side logic.
- Temp tables, table variables, CTEs — recommend the right tool for the workload.

Performance & Optimization:
- Suggest index strategies only when the analyst asks or when a query clearly performs a full table scan on a large result set. Be specific: name the columns and the index type.
- Explain execution plan implications when relevant, but do not speculate about the optimizer without schema statistics.
- Prefer set-based operations over cursors/loops. When a cursor is necessary, say why.

Data Integrity & Safety:
- Always include transaction boundaries for multi-statement DML when appropriate.
- Warn about implicit type conversions that could cause data loss or incorrect comparisons.
- When writing UPDATE or DELETE, suggest a SELECT preview first so the analyst can verify the affected rows.

Working with the Analyst's Existing Query:
- When a current query document is provided below, READ IT CAREFULLY. The analyst is working on this right now.
- If the question relates to the existing query, BUILD ON IT — extend, fix, or refactor it rather than starting from scratch.
- If the question is unrelated, write a new query but do not discard or replace their existing work.`
  );

  // ── 4. Output format rules ──────────────────────────────────────
  systemParts.push(
`
OUTPUT FORMAT — IMPORTANT
- ALWAYS wrap SQL in a fenced code block with the sql language tag. Example:
\`\`\`sql
SELECT ...
\`\`\`
- SQL in code blocks is automatically inserted into the analyst's query editor. This is the primary delivery mechanism — the analyst expects to see your SQL appear in their editor.
- You may include multiple code blocks in one response (e.g., a procedure definition and a test call).
- Outside of code blocks, keep explanations brief and actionable.
- When explaining a complex query, use inline comments (-- comment) inside the SQL rather than long prose paragraphs outside it.`
  );

  // ── 5. Tool instructions ────────────────────────────────────────
  systemParts.push(
`
SCHEMA CONTEXT TOOL
You have access to the update_schema_context tool. Use it when the analyst provides business context, table descriptions, or column definitions that should be persisted as metadata on their schema. Rules:
- Preserve the analyst's wording verbatim — do not paraphrase or editorialize.
- Only update context for tables/columns that exist in the active schema.
- Do not call this tool speculatively. Only use it when the analyst explicitly provides context to save.`
  );

  // ── 6. Dynamic context ─────────────────────────────────────────
  if (dialect) {
    systemParts.push(
      `\nSQL DIALECT: ${dialect}\nWrite all SQL in this dialect. Use dialect-specific syntax, functions, and conventions (e.g., LIMIT vs TOP, ISNULL vs COALESCE vs IFNULL, string concatenation operators, date functions).`
    );
  }

  if (queryContext) {
    systemParts.push(
      `\nANALYST'S CURRENT QUERY DOCUMENT (they are actively working on this):\n\`\`\`sql\n${queryContext}\n\`\`\``
    );
  }

  if (schemas) {
    systemParts.push(
      `\nACTIVE SCHEMA DEFINITIONS — these are the ONLY tables and columns that exist. Reference nothing else:\n\n${schemas}`
    );
  } else {
    systemParts.push(
      `\nNo schemas are currently active. The analyst has not toggled any schemas on. If they ask for a query, tell them: "Please activate a schema in the Schemas panel so I can write SQL against your actual tables and columns." You may still answer general SQL theory questions without a schema.`
    );
  }

  const messages: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string; tool_call_id?: string }> = [
    { role: "system", content: systemParts.join("\n") },
    { role: "user", content: question },
  ];

  // First LLM call — may return tool calls
  const response = await openai.chat.completions.create({
    model: MODEL,
    max_tokens: 8192,
    messages: messages as any,
    tools: SAGE_TOOLS,
    tool_choice: "auto",
  });

  const choice = response.choices[0];
  const toolCalls = choice.message?.tool_calls;

  // If no tool calls, return plain answer
  if (!toolCalls || toolCalls.length === 0) {
    return { answer: extractText(response) || "Unable to process the question." };
  }

  // Process tool calls
  let contextUpdates: SchemaContextUpdate[] | undefined;
  const toolMessages: Array<{ role: "tool"; content: string; tool_call_id: string }> = [];

  for (const tc of toolCalls) {
    const fn = (tc as any).function;
    if (fn?.name === "update_schema_context") {
      try {
        const args = JSON.parse(fn.arguments);
        contextUpdates = args.updates as SchemaContextUpdate[];
        const summary = contextUpdates
          .map((u) => {
            const parts: string[] = [`Table "${u.tableName}"`];
            if (u.tableContext) parts.push("table context updated");
            if (u.columnContexts?.length)
              parts.push(`${u.columnContexts.length} column context(s) updated`);
            return parts.join(": ");
          })
          .join("; ");
        toolMessages.push({
          role: "tool",
          content: JSON.stringify({ success: true, summary }),
          tool_call_id: tc.id,
        });
      } catch (err) {
        toolMessages.push({
          role: "tool",
          content: JSON.stringify({ success: false, error: "Failed to parse tool arguments" }),
          tool_call_id: tc.id,
        });
      }
    }
  }

  // Second LLM call — get final answer after tool execution
  const followUp = await openai.chat.completions.create({
    model: MODEL,
    max_tokens: 8192,
    messages: [
      ...messages,
      { role: "assistant", content: choice.message.content || "", tool_calls: toolCalls } as any,
      ...toolMessages,
    ] as any,
  });

  return {
    answer: extractText(followUp) || "Context has been updated.",
    contextUpdates,
  };
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

/**
 * Attempt to repair truncated JSON from an LLM response that was cut off
 * due to token limits. Scans character-by-character to find the last
 * structurally complete element, removes trailing incomplete data, then
 * closes all open brackets/braces.
 */
function repairTruncatedJson(text: string): Record<string, unknown> | null {
  const stripped = text.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();
  const start = stripped.indexOf("{");
  if (start === -1) return null;

  let json = stripped.slice(start);

  // Scan to find the last position where a structural element was fully closed
  let inString = false;
  let escaped = false;
  const stack: string[] = [];
  let lastCompletePos = -1;

  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
    if (escaped) { escaped = false; continue; }
    if (inString) {
      if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{" || ch === "[") {
      stack.push(ch === "{" ? "}" : "]");
    } else if (ch === "}" || ch === "]") {
      if (stack.length > 0) stack.pop();
      lastCompletePos = i;
    } else if (ch === ",") {
      lastCompletePos = i;
    }
  }

  // Trim to last complete structural boundary
  if (stack.length > 0 && lastCompletePos > 0) {
    json = json.slice(0, lastCompletePos + 1);
  }

  // Remove trailing commas
  json = json.replace(/,\s*$/, "");

  // Re-scan to count remaining open brackets
  inString = false;
  escaped = false;
  const closers: string[] = [];
  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
    if (escaped) { escaped = false; continue; }
    if (inString) {
      if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") closers.push("}");
    else if (ch === "[") closers.push("]");
    else if (ch === "}" || ch === "]") closers.pop();
  }

  // Close all open brackets/braces
  json += closers.reverse().join("");

  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch { /* repair failed */ }

  return null;
}

import type { ParsedTable } from "@shared/schema";

// ---------------------------------------------------------------------------
// Large-file chunking helpers for schema extraction
// ---------------------------------------------------------------------------

/** Threshold above which content is split into chunks for parallel LLM processing. */
const SCHEMA_CHUNK_THRESHOLD = 100_000; // 100k chars

/** Target size per chunk — will split at the last newline before this boundary. */
const SCHEMA_CHUNK_TARGET = 80_000; // ~80k chars per chunk

/**
 * Split large content into chunks at line boundaries.
 * Each chunk is approximately `targetSize` chars, split at the last newline
 * before the boundary so SQL statements are not cut mid-line.
 */
function splitIntoChunks(content: string, targetSize: number): string[] {
  if (content.length <= targetSize) return [content];

  const chunks: string[] = [];
  let start = 0;

  while (start < content.length) {
    let end = Math.min(start + targetSize, content.length);

    // If not at the very end, find the last newline before the target boundary
    if (end < content.length) {
      const lastNewline = content.lastIndexOf("\n", end);
      if (lastNewline > start) {
        end = lastNewline + 1; // include the newline in this chunk
      }
    }

    chunks.push(content.slice(start, end));
    start = end;
  }

  return chunks;
}

/** Build the schema-extraction prompt for a (possibly chunked) piece of content. */
function buildSchemaExtractionPrompt(
  content: string,
  fileName: string,
  chunkNote?: string
): string {
  const chunkSection = chunkNote
    ? `\nIMPORTANT: This is ${chunkNote} of a large file. Extract ONLY the tables and columns visible in this portion. Do not worry about completeness — other chunks will cover the rest of the file.\n`
    : "";

  return `You are a schema-extraction agent. A user uploaded content from file "${fileName}". Your ONLY job: find every database table and column in this content and return a single structured JSON object.
${chunkSection}
The content can be in ANY format — database client output (e.g. MySQL DESCRIBE, \\d output), SQL DDL, spreadsheets, CSV, JSON, documentation, free-form text with table/column descriptions, anything. Figure out what it is and extract the schema.

RULES:
- Strip schema/database prefixes from table names (e.g. "mydb.orders" → "orders", "gsm.temp_table" → "temp_table")
- Preserve original data types exactly as they appear (e.g. varchar(15), decimal(10,2), int, date)
- Identify primary keys where possible (from PRI markers, PRIMARY KEY constraints, etc.)
- Detect foreign key relationships between tables where possible (explicit FK constraints, naming conventions like *_id columns referencing other tables)
- Generate clean CREATE TABLE DDL for display purposes
- Ignore non-schema content (USE statements, SHOW commands, INSERT statements, data rows, comments, etc.)
- If this portion contains NO schema definitions at all, return {"tables": [], "ddl": ""}
- Output ONLY the JSON object below — no explanation, no markdown fences, no other text

CONTEXT EXTRACTION AND CLEANUP — this is critical:
- If the input contains descriptive text about a table or column, extract the BUSINESS MEANING and store it as clean, professional context.
- Context can appear as inline comments (-- ...), text after a dash (- description), prose paragraphs, column annotations, or any human-readable description adjacent to schema elements.
- CLEAN UP conversational language: Remove filler phrases like "That table is...", "This column is...", "this is the...", "that is used for...", "make sure for...", "in the logic always use...". Strip casual speech patterns and rewrite as concise business definitions.
- FIX typos and normalize terminology: correct obvious misspellings (e.g. "fyscal" → "fiscal", "quaretr" → "quarter", "usisnally" → "usually", "teh" → "the", "suppllier" → "supplier") and normalize abbreviations on first use (e.g. "FG (finished good)" on first mention, then just "FG").
- PRESERVE all business-critical details: domain terms, valid values/examples, business rules, relationships to other tables/columns, data lineage notes, and usage guidance for queries. Do not drop any substantive information.
- KEEP operational notes that matter for queries: e.g. "always use Product_Used_In as part of indexes/keys" or "could be null for WLAN models" — these are important for the analyst.
- Context should read like a clean data dictionary entry, not a conversation transcript.
- If no context/description is provided for a table or column, omit the "context" field (do not set it to empty string).

CONTEXT EXAMPLES (input → cleaned output):
- Input: "That Table is the main table that we store quarterly BOMs component level information"
  Output: "Stores quarterly BOM (Bill of Materials) component-level information"
- Input: "make sure for unique records in the table, could be same info but coming from a different level of theBOM"
  Output: "Ensures record uniqueness; same info may appear from different BOM levels"
- Input: "This should be PK, but Item in BOM plays that role, in the logic always use Product_Used_In as part of the indexes, keys"
  Output: "SKU for the FG (finished good). Not a formal PK (ITEM_IN_BOM serves that role), but should always be included in indexes and keys"

OUTPUT FORMAT — a single JSON object:
{
  "tables": [
    {
      "name": "table_name",
      "context": "Clean business description: what the table stores, its purpose, update frequency",
      "columns": [
        {"name": "col_name", "type": "VARCHAR(255)", "isPrimaryKey": true, "context": "Clean business definition. Valid values or examples if mentioned. Query usage notes if relevant"}
      ],
      "relationships": [
        {"fromCol": "user_id", "toTable": "users", "toCol": "id"}
      ]
    }
  ],
  "ddl": "CREATE TABLE table_name (\\n  col_name VARCHAR(255) PRIMARY KEY\\n);"
}

CONTENT:
${content}`;
}

/**
 * Send one chunk of content to the LLM for schema extraction.
 * Returns raw parsed tables, optional DDL, and any error message.
 */
async function parseSchemaChunk(
  openai: OpenAI,
  content: string,
  fileName: string,
  chunkNote?: string
): Promise<{
  rawTables: Array<Record<string, unknown>>;
  ddl?: string;
  error?: string;
}> {
  const response = await openai.chat.completions.create({
    model: MODEL,
    max_tokens: 16384,
    messages: [
      {
        role: "user",
        content: buildSchemaExtractionPrompt(content, fileName, chunkNote),
      },
    ],
  });

  const text = extractText(response);
  const finishReason = response.choices[0]?.finish_reason;

  console.log(
    `[schema-parse] chunk response: ${text.length} chars, finish_reason=${finishReason}`
  );

  // Try normal JSON extraction first
  let result = extractJsonObject(text);

  // If extraction failed and response was truncated, attempt repair
  if (!result && finishReason === "length") {
    console.log(
      "[schema-parse] Response truncated (finish_reason=length) — attempting JSON repair"
    );
    result = repairTruncatedJson(text);
    if (result) {
      console.log("[schema-parse] Successfully repaired truncated JSON");
    }
  }

  if (!result) {
    return {
      rawTables: [],
      error: `Could not extract JSON from LLM response (${text.length} chars, finish_reason=${finishReason}). First 300 chars: ${text.slice(0, 300)}`,
    };
  }

  if (!Array.isArray(result.tables)) {
    return {
      rawTables: [],
      error: `LLM returned JSON but 'tables' is ${typeof result.tables}, not an array. Keys: ${Object.keys(result).join(", ")}`,
    };
  }

  return {
    rawTables: result.tables as Array<Record<string, unknown>>,
    ddl: typeof result.ddl === "string" ? result.ddl : undefined,
  };
}

/**
 * Merge tables from multiple chunk results, deduplicating by name.
 * When the same table appears in multiple chunks, keeps the version with more columns.
 */
function mergeChunkTables(
  allRawTables: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  const tableMap = new Map<string, Record<string, unknown>>();

  for (const t of allRawTables) {
    const name = String(t.name || "").toLowerCase();
    if (!name) continue;

    const existing = tableMap.get(name);
    if (!existing) {
      tableMap.set(name, t);
    } else {
      // Keep the version with more columns (richer definition)
      const existingCols = Array.isArray(existing.columns)
        ? (existing.columns as unknown[]).length
        : 0;
      const newCols = Array.isArray(t.columns)
        ? (t.columns as unknown[]).length
        : 0;
      if (newCols > existingCols) {
        tableMap.set(name, t);
      }
    }
  }

  return Array.from(tableMap.values());
}

// ---------------------------------------------------------------------------

/**
 * Parse raw text content into structured schema definitions.
 *
 * For small files (< 100k chars): single LLM call.
 * For large files (>= 100k chars): splits into chunks, processes each chunk
 * in parallel via the LLM, and merges the results.
 *
 * All parsing is LLM-based — no local regex or heuristic parsing.
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

  // ── STAGE 2: LLM EXTRACTION (single-call or chunked) ──
  console.log("[schema-parse] ── STAGE 2: LLM EXTRACTION ──");

  let rawTables: Array<Record<string, unknown>> = [];
  let extractedDdl: string | undefined;
  const extractionErrors: string[] = [];

  if (rawContent.length < SCHEMA_CHUNK_THRESHOLD) {
    // ---- Small file: single LLM call ----
    console.log("[schema-parse] Using single-call mode (content under", SCHEMA_CHUNK_THRESHOLD, "chars)");

    const result = await parseSchemaChunk(openai, rawContent, fileName);
    rawTables = result.rawTables;
    extractedDdl = result.ddl;
    if (result.error) extractionErrors.push(result.error);

    console.log("[schema-parse] Single-call result:", rawTables.length, "raw tables |", extractedDdl?.length ?? 0, "chars DDL");
  } else {
    // ---- Large file: chunked parallel processing ----
    const chunks = splitIntoChunks(rawContent, SCHEMA_CHUNK_TARGET);
    console.log(
      `[schema-parse] Using chunked mode: ${chunks.length} chunks for ${rawContent.length} char file`
    );
    for (let i = 0; i < chunks.length; i++) {
      console.log(`[schema-parse]   chunk ${i + 1}/${chunks.length}: ${chunks[i].length} chars`);
    }

    const results = await Promise.all(
      chunks.map((chunk, i) =>
        parseSchemaChunk(
          openai,
          chunk,
          fileName,
          `chunk ${i + 1} of ${chunks.length}`
        )
      )
    );

    // Collect all raw tables and DDL fragments from chunks
    const allRawTables: Array<Record<string, unknown>> = [];
    const ddlParts: string[] = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      console.log(
        `[schema-parse]   chunk ${i + 1} result: ${r.rawTables.length} tables${r.error ? " | error: " + r.error : ""}`
      );
      allRawTables.push(...r.rawTables);
      if (r.ddl) ddlParts.push(r.ddl);
      if (r.error) extractionErrors.push(`chunk ${i + 1}: ${r.error}`);
    }

    // Merge and deduplicate tables across chunks
    rawTables = mergeChunkTables(allRawTables);
    extractedDdl = ddlParts.length > 0 ? ddlParts.join("\n\n") : undefined;

    console.log(
      `[schema-parse] Merged: ${rawTables.length} unique tables from ${allRawTables.length} total chunk entries`
    );
  }

  // If extraction produced nothing at all
  if (rawTables.length === 0 && extractionErrors.length > 0) {
    const error = `Schema extraction failed: ${extractionErrors.join("; ")}`;
    console.error("[schema-parse] FAIL:", error);
    return { parsed: rawContent, tables: [], error };
  }

  // ── STAGE 3: TABLE VALIDATION ──
  console.log("[schema-parse] ── STAGE 3: TABLE VALIDATION ──");

  // Log each raw table entry before filtering
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
      ...(typeof t.context === "string" && (t.context as string).trim() ? { context: (t.context as string).trim() } : {}),
      columns: (t.columns as Array<Record<string, unknown>>).map((c) => ({
        name: String(c.name || ""),
        type: String(c.type || ""),
        isPrimaryKey: !!c.isPrimaryKey,
        ...(typeof c.context === "string" && (c.context as string).trim() ? { context: (c.context as string).trim() } : {}),
      })),
      relationships: Array.isArray(t.relationships)
        ? (t.relationships as Array<Record<string, unknown>>).map((r) => ({
            fromCol: String(r.fromCol || ""),
            toTable: String(r.toTable || ""),
            toCol: String(r.toCol || ""),
          }))
        : [],
    }));

  // ── STAGE 4: FINAL OUTPUT ──
  console.log("[schema-parse] ── STAGE 4: FINAL OUTPUT ──");
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

  const ddl = extractedDdl || rawContent;
  console.log("[schema-parse] DDL source:", extractedDdl ? "from LLM" : "fallback to rawContent", "| length:", ddl.length);

  return { parsed: ddl, tables };
}

/**
 * Generate a SQL query from a voice transcript using full context:
 * - Schema definitions (DDL + voice context annotations)
 * - All existing user queries (to learn patterns and intent)
 * - The voice transcript describing what the user wants
 *
 * Returns a structured query with title and SQL content.
 */
export async function llmGenerateQueryFromVoice(
  voiceTranscript: string,
  options: {
    dialect?: string;
    schemas?: string;
    existingQueries?: Array<{ title: string; content: string }>;
  } = {}
): Promise<{ title: string; content: string }> {
  const openai = getClient();

  const dialect = options.dialect || "Standard SQL";
  const contextParts: string[] = [];

  contextParts.push(`Target SQL dialect: ${dialect}`);

  if (options.schemas) {
    contextParts.push(`\nAvailable schema definitions (including domain-specific context annotations):\n${options.schemas}`);
  }

  if (options.existingQueries && options.existingQueries.length > 0) {
    const querySummaries = options.existingQueries
      .map((q, i) => `### Query ${i + 1}: "${q.title}"\n\`\`\`sql\n${q.content}\n\`\`\``)
      .join("\n\n");
    contextParts.push(`\nUser's existing queries (use these to understand their style, patterns, and what they typically work on):\n${querySummaries}`);
  }

  const response = await openai.chat.completions.create({
    model: MODEL,
    max_tokens: 8192,
    messages: [
      {
        role: "user",
        content: `You are an expert SQL query writer. A user described what they want via voice input. Generate the SQL query they are asking for.

${contextParts.join("\n")}

RULES:
- Write clean, production-quality ${dialect} SQL
- Use proper table and column names from the provided schemas
- Follow the user's existing query style and patterns when available
- Include a brief comment header explaining the query's purpose
- Use schema voice context annotations to understand business meanings of tables/columns
- If the user's request is ambiguous, make reasonable assumptions based on the schema and existing queries
- Return ONLY a JSON object with "title" and "content" fields

Voice transcript (what the user said):
"${voiceTranscript}"

Return a JSON object:
{
  "title": "Brief descriptive title for the query",
  "content": "-- SQL query here\\nSELECT ..."
}`,
      },
    ],
  });

  const text = extractText(response);
  const result = extractJsonObject(text);

  if (!result || typeof result.content !== "string") {
    throw new Error("Failed to generate query from voice input — LLM returned unparseable response");
  }

  return {
    title: typeof result.title === "string" ? result.title : "Voice Query",
    content: result.content as string,
  };
}

// ---------------------------------------------------------------------------
// Demo Scenario — single Online Bookstore theme for consistent demo experience
// ---------------------------------------------------------------------------

const DEMO_SCENARIOS: Array<{
  schemaName: string;
  title: string;
  theme: string;
  tables: string;
  mistakes: string;
}> = [
  {
    schemaName: "Online Bookstore",
    title: "Monthly Book Sales Report",
    theme: "A small online bookstore tracking authors, books, customers, and orders.",
    tables: `Create 5 tables:
- **authors** — id, name, country
- **books** — id, title, author_id (FK→authors), genre, price, published_date
- **customers** — id, name, email, signup_date
- **orders** — id, customer_id (FK→customers), order_date, status ('pending','shipped','delivered','cancelled','refunded')
- **order_items** — id, order_id (FK→orders), book_id (FK→books), quantity, unit_price`,
    mistakes: `The query should calculate monthly sales by genre and top-selling authors. Embed these 4 mistakes:
1. **Counts cancelled/refunded orders as sales** — no WHERE filter on order status, so revenue is inflated
2. **Missing NULL handling** — LEFT JOIN from books to order_items without COALESCE, so books with zero sales show NULL instead of 0 in arithmetic
3. **No date range filter** — queries ALL historical data for a "monthly" report, making it slow and misleading
4. **Division by zero** — calculates avg_revenue_per_order = total_revenue / order_count, but order_count can be 0 for some genres`,
  },
];

/**
 * Generate a demo schema and a deliberately flawed SQL query.
 * Each scenario is a different real-world theme that is easy for any user to
 * follow.  The query has 4 clear, realistic mistakes with enough context that
 * the analyzer can produce detailed error descriptions and reasoning.
 *
 * @param scenarioIndex 0-4 — picks one of 5 predefined scenarios
 */
export async function llmGenerateDemo(scenarioIndex: number = 0): Promise<{
  schema: { ddl: string; tables: ParsedTable[] };
  query: { title: string; content: string };
}> {
  const scenario = DEMO_SCENARIOS[scenarioIndex % DEMO_SCENARIOS.length];
  const openai = getClient();

  const response = await openai.chat.completions.create({
    model: MODEL,
    max_tokens: 16384,
    messages: [
      {
        role: "user",
        content: `You are generating a demo for QueryFlow, a SQL query analyzer.

## Theme: "${scenario.theme}"

## 1. Database Schema

${scenario.tables}

Use MySQL syntax for the DDL.  Include proper PRIMARY KEYs, FOREIGN KEYs, NOT NULL constraints, and realistic data types.

## 2. Deliberately Flawed Query: "${scenario.title}"

Write a SQL query (20-40 lines) that a junior analyst might realistically write.  Use clear, readable formatting with comments explaining the intent of each section.  The query should look professional but contain these specific mistakes:

${scenario.mistakes}

**Important rules for the query:**
- Keep it simple enough that someone with basic SQL knowledge can follow.
- Use MySQL syntax.
- Add a header comment block with the title and a short description of what the report should show.
- Add inline comments that describe the INTENT (e.g., "-- Calculate total revenue per genre") — do NOT comment on the bugs themselves.
- Use table aliases and meaningful column names.
- The mistakes should be subtle and look like natural oversights, not obvious errors.

## Output Format

Return ONLY a JSON object (no markdown fences, no explanation):

{
  "schema": {
    "ddl": "CREATE TABLE authors (\\n  id INT AUTO_INCREMENT PRIMARY KEY,\\n  ...\\n);\\n\\nCREATE TABLE ...",
    "tables": [
      {
        "name": "authors",
        "columns": [
          {"name": "id", "type": "INT", "isPrimaryKey": true},
          {"name": "name", "type": "VARCHAR(100)", "isPrimaryKey": false}
        ],
        "relationships": []
      }
    ]
  },
  "query": {
    "title": "${scenario.title}",
    "content": "-- ${scenario.title}\\n-- ..."
  }
}`,
      },
    ],
  });

  const text = extractText(response);
  const result = extractJsonObject(text);

  if (!result) {
    throw new Error("Failed to parse demo generation response from LLM");
  }

  // Validate schema
  const schemaData = result.schema as Record<string, unknown> | undefined;
  if (!schemaData || typeof schemaData.ddl !== "string" || !Array.isArray(schemaData.tables)) {
    throw new Error("LLM demo response missing valid schema data");
  }

  // Normalize tables
  const tables: ParsedTable[] = (schemaData.tables as Array<Record<string, unknown>>)
    .filter((t) => typeof t.name === "string" && Array.isArray(t.columns))
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

  // Validate query
  const queryData = result.query as Record<string, unknown> | undefined;
  if (!queryData || typeof queryData.content !== "string" || !queryData.content) {
    throw new Error("LLM demo response missing valid query data");
  }

  return {
    schema: {
      ddl: schemaData.ddl as string,
      tables,
    },
    query: {
      title: (queryData.title as string) || scenario.title,
      content: queryData.content as string,
    },
  };
}

/** Expose scenario metadata so the seed endpoint knows how many exist. */
export const DEMO_SCENARIO_COUNT = DEMO_SCENARIOS.length;
export function getDemoScenarioName(index: number): string {
  return DEMO_SCENARIOS[index % DEMO_SCENARIOS.length].schemaName;
}

// ---------------------------------------------------------------------------
// Waterfall Flow Analysis
// ---------------------------------------------------------------------------

/**
 * Analyse a SQL query or stored procedure and decompose it into a directed
 * acyclic graph (DAG) showing how data flows from source tables through
 * intermediate transformations (CTEs, temp tables, subqueries) to the final
 * output.  Returns a WaterfallAnalysis object.
 */
/**
 * Validate and normalize raw node objects from the LLM response.
 * Handles case-insensitive node type matching and common LLM variations.
 */
const VALID_NODE_TYPES = new Set([
  "source_table", "cte", "temp_table", "derived_table", "final_output",
]);
const NODE_TYPE_ALIASES: Record<string, WaterfallNode["nodeType"]> = {
  source: "source_table",
  table: "source_table",
  base_table: "source_table",
  temporary_table: "temp_table",
  temp: "temp_table",
  common_table_expression: "cte",
  subquery: "derived_table",
  output: "final_output",
  result: "final_output",
  final: "final_output",
  final_select: "final_output",
};

function normalizeNodeType(raw: unknown): WaterfallNode["nodeType"] {
  const s = String(raw).toLowerCase().trim();
  if (VALID_NODE_TYPES.has(s)) return s as WaterfallNode["nodeType"];
  return NODE_TYPE_ALIASES[s] ?? "source_table";
}

const VALID_EDGE_TYPES = new Set([
  "join", "create_insert", "cte_definition", "subquery_ref", "select_from",
]);
const EDGE_TYPE_ALIASES: Record<string, WaterfallEdge["edgeType"]> = {
  inner_join: "join",
  left_join: "join",
  right_join: "join",
  full_join: "join",
  cross_join: "join",
  create: "create_insert",
  insert: "create_insert",
  insert_into: "create_insert",
  cte: "cte_definition",
  cte_ref: "cte_definition",
  subquery: "subquery_ref",
  derived: "subquery_ref",
  select: "select_from",
  from: "select_from",
};

function normalizeEdgeType(raw: unknown): WaterfallEdge["edgeType"] {
  const s = String(raw).toLowerCase().trim();
  if (VALID_EDGE_TYPES.has(s)) return s as WaterfallEdge["edgeType"];
  return EDGE_TYPE_ALIASES[s] ?? "select_from";
}

function validateNodes(raw: unknown[]): WaterfallNode[] {
  return (raw as Array<Record<string, unknown>>)
    .filter(
      (n) =>
        typeof n.id === "string" &&
        typeof n.name === "string" &&
        typeof n.stepIndex === "number"
    )
    .map((n) => ({
      id: String(n.id),
      name: String(n.name),
      nodeType: normalizeNodeType(n.nodeType),
      columns: Array.isArray(n.columns)
        ? (n.columns as unknown[]).map(String)
        : undefined,
      stepIndex: Number(n.stepIndex),
    }));
}

function validateEdges(raw: unknown[], nodeIds: Set<string>): WaterfallEdge[] {
  return (raw as Array<Record<string, unknown>>)
    .filter(
      (e) =>
        typeof e.id === "string" &&
        typeof e.fromNodeId === "string" &&
        typeof e.toNodeId === "string" &&
        nodeIds.has(String(e.fromNodeId)) &&
        nodeIds.has(String(e.toNodeId))
    )
    .map((e) => {
      const sqlStatement = String(e.sqlStatement || "");
      if (sqlStatement.includes("...")) {
        console.warn(`[waterfall] Edge ${e.id} has abbreviated SQL (contains "..."). LLM ignored the no-abbreviation rule. SQL: ${sqlStatement.slice(0, 200)}`);
      }
      return {
        id: String(e.id),
        fromNodeId: String(e.fromNodeId),
        toNodeId: String(e.toNodeId),
        edgeType: normalizeEdgeType(e.edgeType),
        sqlStatement,
        joinDetails: e.joinDetails ? String(e.joinDetails) : undefined,
      };
    });
}

/**
 * When the initial waterfall call returns nodes but zero edges (typically
 * due to token-limit truncation), make a focused second LLM call that
 * provides the already-extracted nodes and asks only for edges.
 */
async function recoverWaterfallEdges(
  ai: OpenAI,
  sql: string,
  nodes: WaterfallNode[],
  options: { dialect?: string; schemas?: string }
): Promise<WaterfallEdge[]> {
  const dialectHint = options.dialect ? `SQL dialect: ${options.dialect}. ` : "";
  const nodeList = nodes
    .map((n) => `  ${n.id}: "${n.name}" (${n.nodeType}, step ${n.stepIndex})`)
    .join("\n");

  const response = await ai.chat.completions.create({
    model: MODEL,
    max_tokens: 32768,
    messages: [
      {
        role: "system",
        content: `Generate ONLY the edges (connections) for a SQL data flow DAG. ${dialectHint}

The nodes have already been identified:
${nodeList}

Edge types: "join" (JOIN), "create_insert" (CREATE/INSERT INTO SELECT), "cte_definition" (CTE body), "subquery_ref" (derived subquery), "select_from" (simple SELECT FROM).

For each edge provide:
- id: "edge_0", "edge_1", etc.
- fromNodeId: must be one of the node IDs listed above
- toNodeId: must be one of the node IDs listed above
- edgeType: one of the edge types above
- sqlStatement: the FULL, COMPLETE, UNTRUNCATED verbatim SQL clause from the user's input for this data movement. Never abbreviate, never use "...", never summarize, never use ellipsis or placeholders. Copy the ENTIRE clause exactly as written character-for-character. If the clause is 200 lines, include all 200 lines. Abbreviation is a critical defect that makes the output INVALID.
- joinDetails: for JOIN edges only, the full ON condition verbatim (no "..." or abbreviation)

Every node must have at least one edge. Return ONLY a JSON array: [{"id":"edge_0",...},...]`,
      },
      { role: "user", content: sql },
    ],
  });

  const text = extractText(response);
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (!arrayMatch) return [];

  let rawEdges: unknown[];
  try {
    rawEdges = JSON.parse(arrayMatch[0]);
  } catch {
    return [];
  }

  if (!Array.isArray(rawEdges)) return [];

  const nodeIds = new Set(nodes.map((n) => n.id));
  return validateEdges(rawEdges, nodeIds);
}

export async function llmAnalyzeWaterfall(
  sql: string,
  options: { dialect?: string; schemas?: string } = {}
): Promise<WaterfallAnalysis> {
  const ai = getClient();

  const dialectHint = options.dialect
    ? `The SQL dialect is ${options.dialect}.`
    : "";
  const schemaHint = options.schemas
    ? `\n\nKnown database schema:\n${options.schemas}`
    : "";

  const systemPrompt = `Decompose the SQL into a DAG of data flow. ${dialectHint}${schemaHint}

Node types: "source_table" (base tables in FROM/JOIN), "cte" (WITH AS), "temp_table" (#temp/CREATE TEMP), "derived_table" (subquery in FROM), "final_output" (final SELECT or target INSERT table).

Edge types: "join" (JOIN), "create_insert" (CREATE/INSERT INTO SELECT), "cte_definition" (CTE body), "subquery_ref" (derived subquery), "select_from" (simple SELECT FROM).

Rules:
- stepIndex: 0 for source tables, increment for each transformation layer. Same stepIndex = side-by-side.
- Correctly identify node types: CTEs should be "cte", temp tables (#temp/CREATE TEMP) should be "temp_table", subqueries in FROM should be "derived_table", and the final result should be "final_output". Only base tables from the database should be "source_table".
- For JOINs of N sources into 1 destination: one edge per source, same sqlStatement.
- sqlStatement: MUST be the FULL, COMPLETE, UNTRUNCATED verbatim SQL from the user's input that corresponds to that data movement. Copy the ENTIRE relevant clause character-for-character — never abbreviate, never use "...", never summarize, never replace parts with ellipsis or placeholders. Include every column, every condition, every expression, every keyword exactly as written. The right panel has plenty of space — the user needs to see and verify the exact SQL. If an edge's SQL is 500 lines long, include all 500 lines. Abbreviation is a critical defect.
- joinDetails: for JOIN edges only, the ON condition (also full and verbatim, no "...").
- IDs: "node_0","node_1"... and "edge_0","edge_1"...
- Every node must have at least one edge.
- CRITICAL: The edges array is essential. Always generate the complete edges array with full verbatim SQL in every edge.
- ABSOLUTE RULE: If any sqlStatement or joinDetails field contains "..." or any form of abbreviation/ellipsis/placeholder, the entire response is INVALID. The user is a senior SQL analyst who verifies every character. Abbreviated SQL destroys their trust in the tool.

Return ONLY JSON:
{"nodes":[...],"edges":[...],"summary":"brief description"}`;

  const response = await ai.chat.completions.create({
    model: MODEL,
    max_tokens: 32768,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: sql },
    ],
  });

  const finishReason = response.choices[0]?.finish_reason;
  const text = extractText(response);

  // Try standard extraction first
  let raw = extractJsonObject(text);

  // If standard extraction failed and response was truncated, try repair
  if (!raw && finishReason === "length") {
    console.log("[waterfall] Response truncated (finish_reason=length) — attempting JSON repair");
    raw = repairTruncatedJson(text);
    if (raw) {
      console.log("[waterfall] Successfully repaired truncated JSON");
    }
  }

  if (!raw || !Array.isArray(raw.nodes)) {
    logLlmError("waterfall", "Failed to parse waterfall analysis — LLM did not return valid {nodes,edges} JSON", {
      rawResponse: text,
      inputPreview: sql,
      finishReason: finishReason ?? "unknown",
    });
    throw new Error("Failed to parse waterfall analysis from LLM response");
  }

  // Ensure edges is at least an empty array (may be missing from truncated response)
  if (!Array.isArray(raw.edges)) {
    raw.edges = [];
  }

  // Validate & normalize
  const nodes = validateNodes(raw.nodes as unknown[]);
  const nodeIds = new Set(nodes.map((n) => n.id));
  let edges = validateEdges(raw.edges as unknown[], nodeIds);

  if (nodes.length === 0) {
    logLlmError("waterfall", "Waterfall analysis produced no valid nodes after validation", {
      rawResponse: text,
      inputPreview: sql,
    });
    throw new Error("Waterfall analysis produced no valid nodes");
  }

  // Edge recovery: if we have nodes but no edges (common with truncated
  // responses or very large queries), make a focused second call.
  if (nodes.length > 0 && edges.length === 0) {
    console.log(`[waterfall] Got ${nodes.length} nodes but 0 edges — attempting edge recovery call`);
    try {
      const recovered = await recoverWaterfallEdges(ai, sql, nodes, options);
      if (recovered.length > 0) {
        console.log(`[waterfall] Edge recovery succeeded: ${recovered.length} edges recovered`);
        edges = recovered;
      } else {
        console.warn("[waterfall] Edge recovery returned 0 edges");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[waterfall] Edge recovery failed:", msg);
    }
  }

  return {
    nodes,
    edges,
    summary: typeof raw.summary === "string" ? raw.summary : "",
  };
}

