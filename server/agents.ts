import type { InsertFeedback } from "@shared/schema";

export type AgentType = "structure" | "optimization" | "error" | "style";

interface AgentResult {
  agentType: AgentType;
  severity: "info" | "warning" | "error" | "success";
  title: string;
  message: string;
  suggestion?: string;
  lineNumber?: number;
}

const SQL_KEYWORDS = [
  "SELECT", "FROM", "WHERE", "JOIN", "INNER JOIN", "LEFT JOIN", "RIGHT JOIN",
  "FULL JOIN", "CROSS JOIN", "ON", "AND", "OR", "NOT", "IN", "EXISTS",
  "BETWEEN", "LIKE", "IS NULL", "IS NOT NULL", "ORDER BY", "GROUP BY",
  "HAVING", "LIMIT", "OFFSET", "UNION", "UNION ALL", "INTERSECT", "EXCEPT",
  "INSERT INTO", "VALUES", "UPDATE", "SET", "DELETE FROM", "CREATE TABLE",
  "ALTER TABLE", "DROP TABLE", "CREATE INDEX", "DROP INDEX", "AS",
  "DISTINCT", "COUNT", "SUM", "AVG", "MIN", "MAX", "CASE", "WHEN", "THEN",
  "ELSE", "END", "WITH", "OVER", "PARTITION BY", "ROW_NUMBER", "RANK",
  "DENSE_RANK", "COALESCE", "NULLIF", "CAST", "CONVERT", "BEGIN",
  "COMMIT", "ROLLBACK", "DECLARE", "EXEC", "EXECUTE", "PROCEDURE",
  "FUNCTION", "RETURNS", "RETURN", "IF", "WHILE", "CURSOR", "FETCH",
  "OPEN", "CLOSE", "DEALLOCATE", "TOP", "INTO", "OUTPUT",
];

function getLines(sql: string): string[] {
  return sql.split("\n");
}

function findLineNumber(sql: string, pattern: RegExp): number | undefined {
  const lines = getLines(sql);
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      return i + 1;
    }
  }
  return undefined;
}

// Structure Agent: analyzes query structure, readability, nesting
function analyzeStructure(sql: string): AgentResult[] {
  const results: AgentResult[] = [];
  const lines = getLines(sql);
  const trimmed = sql.trim();

  // Check for deeply nested subqueries
  let maxDepth = 0;
  let currentDepth = 0;
  for (const char of sql) {
    if (char === "(") currentDepth++;
    if (char === ")") currentDepth--;
    maxDepth = Math.max(maxDepth, currentDepth);
  }
  if (maxDepth > 3) {
    results.push({
      agentType: "structure",
      severity: "warning",
      title: "Deep nesting detected",
      message: `Your query has ${maxDepth} levels of nesting. Deeply nested subqueries reduce readability and can impact performance.`,
      suggestion: "Consider using Common Table Expressions (CTEs) with the WITH clause to flatten nested subqueries into named, readable steps.",
    });
  }

  // Check for very long lines
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > 120) {
      results.push({
        agentType: "structure",
        severity: "info",
        title: "Long line detected",
        message: `Line ${i + 1} is ${lines[i].length} characters long. Lines over 120 characters are harder to read.`,
        suggestion: "Break long lines by placing each column, condition, or join on its own line.",
        lineNumber: i + 1,
      });
      break; // Only report the first occurrence
    }
  }

  // Check for missing aliases on joined tables
  const joinPattern = /\bJOIN\s+(\w+)\s*\n?\s*ON\b/gi;
  let match;
  while ((match = joinPattern.exec(sql)) !== null) {
    const tableName = match[1];
    const afterTable = sql.substring(match.index + match[0].indexOf(tableName) + tableName.length, match.index + match[0].length);
    if (!/\s+(AS\s+)?\w+\s+ON/i.test(afterTable) && !/\s+\w+\s+ON/i.test(` ${sql.substring(match.index + match[0].indexOf(tableName), match.index + match[0].length + 20)}`)) {
      // Simplified check: if no alias pattern between table name and ON
    }
  }

  // Check for multiple JOINs suggesting complexity
  const joinCount = (sql.match(/\bJOIN\b/gi) || []).length;
  if (joinCount > 4) {
    results.push({
      agentType: "structure",
      severity: "info",
      title: "Complex multi-join query",
      message: `This query contains ${joinCount} JOIN operations. Complex joins can be difficult for others to understand and review.`,
      suggestion: "Consider adding comments to explain the purpose of each join, or break the query into CTEs for clarity.",
    });
  }

  // Check overall query length
  if (lines.length > 50) {
    results.push({
      agentType: "structure",
      severity: "info",
      title: "Long query",
      message: `This query is ${lines.length} lines long. Very long queries are harder to review and maintain.`,
      suggestion: "Consider breaking this into smaller views, CTEs, or stored procedures for better maintainability.",
    });
  }

  // Positive feedback for good structure
  if (results.length === 0 && trimmed.length > 20) {
    const hasCTEs = /\bWITH\b/i.test(sql);
    const hasComments = /--/.test(sql) || /\/\*/.test(sql);
    if (hasCTEs || hasComments) {
      results.push({
        agentType: "structure",
        severity: "success",
        title: "Good query structure",
        message: "This query demonstrates good structural practices" +
          (hasCTEs ? " with CTEs for readability" : "") +
          (hasComments ? " and includes helpful comments" : "") + ".",
      });
    }
  }

  return results;
}

// Optimization Agent: suggests performance improvements
function analyzeOptimization(sql: string): AgentResult[] {
  const results: AgentResult[] = [];
  const upperSql = sql.toUpperCase();

  // Check for SELECT *
  const selectStarPattern = /\bSELECT\s+\*/gi;
  if (selectStarPattern.test(sql)) {
    results.push({
      agentType: "optimization",
      severity: "warning",
      title: "SELECT * usage detected",
      message: "SELECT * retrieves all columns from the table, which can transfer more data than needed and may prevent the query optimizer from using covering indexes.",
      suggestion: "Consider listing only the columns you need, e.g., SELECT col1, col2, col3 FROM table.",
      lineNumber: findLineNumber(sql, /\bSELECT\s+\*/i),
    });
  }

  // Check for missing WHERE clause on SELECT
  if (/\bSELECT\b/i.test(sql) && !/\bWHERE\b/i.test(sql) && /\bFROM\b/i.test(sql)) {
    // Only flag if it's not a simple count or aggregation without GROUP BY
    if (!/\bLIMIT\b/i.test(sql)) {
      results.push({
        agentType: "optimization",
        severity: "warning",
        title: "Query without WHERE clause",
        message: "This query selects from a table without a WHERE clause or LIMIT, which may result in a full table scan on large datasets.",
        suggestion: "Consider adding a WHERE clause to filter results, or a LIMIT to restrict the number of rows returned.",
      });
    }
  }

  // Check for functions on indexed columns in WHERE
  const funcOnColumnPattern = /\bWHERE\b[\s\S]*?\b(UPPER|LOWER|TRIM|LTRIM|RTRIM|SUBSTRING|LEFT|RIGHT|CONVERT|CAST|DATEPART|YEAR|MONTH|DAY)\s*\(/gi;
  if (funcOnColumnPattern.test(sql)) {
    results.push({
      agentType: "optimization",
      severity: "warning",
      title: "Function on column in WHERE clause",
      message: "Applying functions to columns in the WHERE clause prevents the database from using indexes on those columns, causing full table scans.",
      suggestion: "If possible, rewrite the condition to avoid wrapping the column in a function. For example, instead of WHERE YEAR(date_col) = 2024, use WHERE date_col >= '2024-01-01' AND date_col < '2025-01-01'.",
    });
  }

  // Check for DISTINCT that might indicate a join issue
  if (/\bSELECT\s+DISTINCT\b/i.test(sql) && /\bJOIN\b/i.test(sql)) {
    results.push({
      agentType: "optimization",
      severity: "info",
      title: "DISTINCT with JOINs",
      message: "Using DISTINCT with JOINs may indicate an unintended many-to-many relationship producing duplicate rows.",
      suggestion: "Review your JOIN conditions to ensure they are correct. If duplicates are expected, consider whether EXISTS or IN would be more efficient than JOIN + DISTINCT.",
    });
  }

  // Check for LIKE with leading wildcard
  const likeLeadingWildcard = /\bLIKE\s+['"]%/gi;
  if (likeLeadingWildcard.test(sql)) {
    results.push({
      agentType: "optimization",
      severity: "warning",
      title: "Leading wildcard in LIKE",
      message: "Using LIKE with a leading wildcard (e.g., LIKE '%value') prevents index usage and forces a full table scan.",
      suggestion: "If possible, restructure the search to avoid leading wildcards. Consider using full-text search for pattern matching on large datasets.",
      lineNumber: findLineNumber(sql, /\bLIKE\s+['"]%/i),
    });
  }

  // Check for OR in WHERE that could be replaced with IN or UNION
  const orCount = (upperSql.match(/\bWHERE\b[\s\S]*?\bOR\b/gi) || []).length;
  if (orCount > 2) {
    results.push({
      agentType: "optimization",
      severity: "info",
      title: "Multiple OR conditions",
      message: `Found ${orCount + 1} OR conditions in the WHERE clause. Multiple ORs can prevent efficient index usage.`,
      suggestion: "Consider replacing OR conditions on the same column with IN (col IN (val1, val2, val3)) or using UNION ALL for different columns.",
    });
  }

  // Check for NOT IN with subquery
  if (/\bNOT\s+IN\s*\(\s*SELECT\b/i.test(sql)) {
    results.push({
      agentType: "optimization",
      severity: "warning",
      title: "NOT IN with subquery",
      message: "NOT IN with a subquery can produce unexpected results with NULL values and may not perform well on large datasets.",
      suggestion: "Use NOT EXISTS instead, which handles NULLs correctly and often performs better: WHERE NOT EXISTS (SELECT 1 FROM ... WHERE ...).",
    });
  }

  return results;
}

// Error Detection Agent: finds potential SQL issues
function analyzeErrors(sql: string): AgentResult[] {
  const results: AgentResult[] = [];
  const trimmed = sql.trim();

  if (!trimmed) return results;

  // Check for unmatched parentheses
  let parenCount = 0;
  let inString = false;
  let stringChar = "";
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    if (inString) {
      if (char === stringChar && sql[i + 1] !== stringChar) {
        inString = false;
      }
    } else {
      if (char === "'" || char === '"') {
        inString = true;
        stringChar = char;
      } else if (char === "(") {
        parenCount++;
      } else if (char === ")") {
        parenCount--;
      }
    }
    if (parenCount < 0) break;
  }
  if (parenCount !== 0) {
    results.push({
      agentType: "error",
      severity: "error",
      title: "Unmatched parentheses",
      message: parenCount > 0
        ? `Found ${parenCount} unclosed opening parenthesis(es).`
        : `Found ${Math.abs(parenCount)} extra closing parenthesis(es).`,
      suggestion: "Review and balance all parentheses. Check subqueries and function calls for matching open and close parentheses.",
    });
  }

  // Check for common typos: FORM instead of FROM
  if (/\bFORM\b/i.test(sql) && !/\bFROM\b/i.test(sql)) {
    results.push({
      agentType: "error",
      severity: "error",
      title: "Possible typo: FORM instead of FROM",
      message: "Found 'FORM' which is likely a typo for the 'FROM' keyword.",
      suggestion: "Replace 'FORM' with 'FROM'.",
      lineNumber: findLineNumber(sql, /\bFORM\b/i),
    });
  }

  // Check for WEHRE instead of WHERE
  if (/\bWEHRE\b/i.test(sql)) {
    results.push({
      agentType: "error",
      severity: "error",
      title: "Possible typo: WEHRE instead of WHERE",
      message: "Found 'WEHRE' which is likely a typo for the 'WHERE' keyword.",
      suggestion: "Replace 'WEHRE' with 'WHERE'.",
      lineNumber: findLineNumber(sql, /\bWEHRE\b/i),
    });
  }

  // Check for GROUP BY without aggregate function
  if (/\bGROUP\s+BY\b/i.test(sql)) {
    const hasAggregate = /\b(COUNT|SUM|AVG|MIN|MAX)\s*\(/i.test(sql);
    if (!hasAggregate) {
      results.push({
        agentType: "error",
        severity: "warning",
        title: "GROUP BY without aggregate function",
        message: "The query uses GROUP BY but no aggregate function (COUNT, SUM, AVG, MIN, MAX) was detected.",
        suggestion: "GROUP BY is typically used with aggregate functions. Verify that you intended to use GROUP BY and add the appropriate aggregate(s).",
      });
    }
  }

  // Check for ambiguous column references with multiple tables
  const joinCount = (sql.match(/\bJOIN\b/gi) || []).length;
  if (joinCount > 0) {
    // Check if SELECT columns are unqualified
    const selectMatch = sql.match(/\bSELECT\b([\s\S]*?)\bFROM\b/i);
    if (selectMatch) {
      const selectClause = selectMatch[1];
      const columns = selectClause.split(",").map(c => c.trim());
      const unqualified = columns.filter(c => {
        const col = c.replace(/\bAS\s+\w+/i, "").trim();
        return col !== "*" && !col.includes(".") && !/\(/.test(col) && col.length > 0;
      });
      if (unqualified.length > 0) {
        results.push({
          agentType: "error",
          severity: "warning",
          title: "Potentially ambiguous column references",
          message: `Found ${unqualified.length} unqualified column(s) in a multi-table query: ${unqualified.slice(0, 3).join(", ")}${unqualified.length > 3 ? "..." : ""}. These may be ambiguous.`,
          suggestion: "Prefix columns with table aliases (e.g., t.column_name) to avoid ambiguity in multi-table queries.",
        });
      }
    }
  }

  // Check for missing semicolon at end
  if (trimmed.length > 10 && !trimmed.endsWith(";") && /\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(trimmed)) {
    results.push({
      agentType: "error",
      severity: "info",
      title: "Missing trailing semicolon",
      message: "The query does not end with a semicolon. While not always required, semicolons are a best practice to terminate SQL statements.",
      suggestion: "Add a semicolon at the end of the query.",
    });
  }

  return results;
}

// Style Agent: checks formatting consistency and conventions
function analyzeStyle(sql: string): AgentResult[] {
  const results: AgentResult[] = [];
  const lines = getLines(sql);
  const trimmed = sql.trim();

  if (!trimmed) return results;

  // Check keyword casing consistency
  const keywordPattern = /\b(SELECT|FROM|WHERE|JOIN|AND|OR|ON|GROUP BY|ORDER BY|HAVING|LIMIT|INSERT|UPDATE|DELETE|SET|INTO|VALUES|CREATE|ALTER|DROP|WITH|AS|CASE|WHEN|THEN|ELSE|END|UNION|DISTINCT|BETWEEN|LIKE|IN|EXISTS|NOT|NULL|IS)\b/gi;
  let upper = 0;
  let lower = 0;
  let mixed = 0;
  let kwMatch;
  while ((kwMatch = keywordPattern.exec(sql)) !== null) {
    const kw = kwMatch[0];
    if (kw === kw.toUpperCase()) upper++;
    else if (kw === kw.toLowerCase()) lower++;
    else mixed++;
  }
  const total = upper + lower + mixed;
  if (total > 2 && mixed > 0) {
    results.push({
      agentType: "style",
      severity: "info",
      title: "Inconsistent keyword casing",
      message: `Found mixed keyword casing: ${upper} UPPERCASE, ${lower} lowercase, ${mixed} MixedCase. Consistent casing improves readability.`,
      suggestion: "Use UPPERCASE for all SQL keywords (e.g., SELECT, FROM, WHERE) as this is the most common convention.",
    });
  } else if (total > 2 && lower > upper) {
    results.push({
      agentType: "style",
      severity: "info",
      title: "Lowercase SQL keywords",
      message: "SQL keywords are written in lowercase. While perfectly valid, UPPERCASE keywords are a common convention that can help distinguish keywords from identifiers.",
      suggestion: "Some teams prefer UPPERCASE for SQL keywords (e.g., select -> SELECT, from -> FROM). Choose whatever convention works best for your team.",
    });
  }

  // Check for inconsistent indentation
  const indentLevels = lines
    .filter(l => l.trim().length > 0)
    .map(l => {
      const match = l.match(/^(\s*)/);
      return match ? match[1].length : 0;
    });
  const usesTabs = lines.some(l => l.startsWith("\t"));
  const usesSpaces = lines.some(l => /^ /.test(l));
  if (usesTabs && usesSpaces) {
    results.push({
      agentType: "style",
      severity: "info",
      title: "Mixed tabs and spaces",
      message: "The query uses both tabs and spaces for indentation, which can cause inconsistent alignment across editors.",
      suggestion: "Choose one indentation style (spaces are recommended) and use it consistently.",
    });
  }

  // Check for trailing whitespace
  const trailingWsLines = lines.filter((l, i) => l !== l.trimEnd() && l.trim().length > 0);
  if (trailingWsLines.length > 3) {
    results.push({
      agentType: "style",
      severity: "info",
      title: "Trailing whitespace",
      message: `Found trailing whitespace on ${trailingWsLines.length} lines.`,
      suggestion: "Remove trailing whitespace for cleaner code.",
    });
  }

  // Check for lack of comments on complex queries
  if (lines.length > 20 && !/--/.test(sql) && !/\/\*/.test(sql)) {
    results.push({
      agentType: "style",
      severity: "info",
      title: "No comments on complex query",
      message: "This query is over 20 lines long but contains no comments. Comments help others understand the intent and logic.",
      suggestion: "Add comments explaining the purpose of the query and key logic sections using -- for single-line or /* */ for multi-line comments.",
    });
  }

  // Check comma placement consistency (leading vs trailing)
  const leadingCommas = lines.filter(l => /^\s*,/.test(l)).length;
  const trailingCommas = lines.filter(l => /,\s*$/.test(l)).length;
  if (leadingCommas > 0 && trailingCommas > 0 && leadingCommas + trailingCommas > 3) {
    results.push({
      agentType: "style",
      severity: "info",
      title: "Inconsistent comma placement",
      message: `Found both leading commas (${leadingCommas} lines) and trailing commas (${trailingCommas} lines). Pick one style for consistency.`,
      suggestion: "Choose either leading or trailing comma style and apply it consistently throughout the query.",
    });
  }

  return results;
}

const AGENT_MAP: Record<AgentType, (sql: string) => AgentResult[]> = {
  structure: analyzeStructure,
  optimization: analyzeOptimization,
  error: analyzeErrors,
  style: analyzeStyle,
};

export const AGENT_DESCRIPTIONS: Record<AgentType, { name: string; description: string }> = {
  structure: {
    name: "Structure",
    description: "Reviews query structure, nesting depth, complexity, and readability.",
  },
  optimization: {
    name: "Performance",
    description: "Reviews query patterns and highlights performance considerations.",
  },
  error: {
    name: "Correctness",
    description: "Checks for potential SQL issues, typos, and syntax patterns.",
  },
  style: {
    name: "Style",
    description: "Reviews formatting consistency, keyword casing, and coding conventions.",
  },
};

export function runAgents(
  queryId: number,
  sql: string,
  enabledAgents: AgentType[] = ["structure", "optimization", "error", "style"]
): InsertFeedback[] {
  const allResults: InsertFeedback[] = [];

  for (const agentType of enabledAgents) {
    const agentFn = AGENT_MAP[agentType];
    if (!agentFn) continue;

    const results = agentFn(sql);
    for (const result of results) {
      allResults.push({
        queryId,
        agentType: result.agentType,
        severity: result.severity,
        title: result.title,
        message: result.message,
        suggestion: result.suggestion ?? null,
        lineNumber: result.lineNumber ?? null,
        isResolved: false,
      });
    }
  }

  return allResults;
}
