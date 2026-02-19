// SQL Formatter - Formats SQL queries for readability
// Handles keyword capitalization, indentation, and line breaks

const MAJOR_KEYWORDS = [
  "SELECT", "FROM", "WHERE", "JOIN", "INNER JOIN", "LEFT JOIN", "RIGHT JOIN",
  "FULL JOIN", "FULL OUTER JOIN", "CROSS JOIN", "LEFT OUTER JOIN", "RIGHT OUTER JOIN",
  "ON", "AND", "OR", "ORDER BY", "GROUP BY", "HAVING", "LIMIT", "OFFSET",
  "UNION", "UNION ALL", "INTERSECT", "EXCEPT", "INSERT INTO", "VALUES",
  "UPDATE", "SET", "DELETE FROM", "CREATE TABLE", "ALTER TABLE", "DROP TABLE",
  "WITH", "AS", "CASE", "WHEN", "THEN", "ELSE", "END",
];

const ALL_KEYWORDS = [
  ...MAJOR_KEYWORDS,
  "DISTINCT", "TOP", "INTO", "IN", "EXISTS", "NOT", "NULL", "IS",
  "BETWEEN", "LIKE", "ASC", "DESC", "COUNT", "SUM", "AVG", "MIN", "MAX",
  "COALESCE", "NULLIF", "CAST", "CONVERT", "OVER", "PARTITION BY",
  "ROW_NUMBER", "RANK", "DENSE_RANK", "BEGIN", "COMMIT", "ROLLBACK",
  "DECLARE", "EXEC", "EXECUTE", "PROCEDURE", "FUNCTION", "RETURNS",
  "RETURN", "IF", "WHILE", "CURSOR", "FETCH", "OPEN", "CLOSE", "DEALLOCATE",
  "OUTPUT", "PRIMARY KEY", "FOREIGN KEY", "REFERENCES", "CONSTRAINT",
  "INDEX", "UNIQUE", "DEFAULT", "CHECK", "NOT NULL", "AUTO_INCREMENT",
  "SERIAL", "BIGINT", "INT", "INTEGER", "VARCHAR", "TEXT", "BOOLEAN",
  "TIMESTAMP", "DATE", "TIME", "FLOAT", "DECIMAL", "NUMERIC",
];

interface FormatOptions {
  uppercaseKeywords: boolean;
  indentSize: number;
  commaPosition: "trailing" | "leading";
  maxLineLength: number;
}

const DEFAULT_OPTIONS: FormatOptions = {
  uppercaseKeywords: true,
  indentSize: 2,
  commaPosition: "trailing",
  maxLineLength: 120,
};

// Tokenizer: splits SQL into meaningful tokens
type TokenType = "keyword" | "identifier" | "string" | "number" | "operator" | "comma" | "paren_open" | "paren_close" | "comment" | "whitespace" | "semicolon" | "dot" | "star";

interface Token {
  type: TokenType;
  value: string;
  upper?: string;
}

function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < sql.length) {
    // Single-line comment
    if (sql[i] === "-" && sql[i + 1] === "-") {
      let end = sql.indexOf("\n", i);
      if (end === -1) end = sql.length;
      tokens.push({ type: "comment", value: sql.substring(i, end) });
      i = end;
      continue;
    }

    // Multi-line comment
    if (sql[i] === "/" && sql[i + 1] === "*") {
      let end = sql.indexOf("*/", i + 2);
      if (end === -1) end = sql.length - 2;
      tokens.push({ type: "comment", value: sql.substring(i, end + 2) });
      i = end + 2;
      continue;
    }

    // String literal (single or double quote)
    if (sql[i] === "'" || sql[i] === '"') {
      const quote = sql[i];
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === quote) {
          if (sql[j + 1] === quote) {
            j += 2; // escaped quote
          } else {
            break;
          }
        } else {
          j++;
        }
      }
      tokens.push({ type: "string", value: sql.substring(i, j + 1) });
      i = j + 1;
      continue;
    }

    // Whitespace
    if (/\s/.test(sql[i])) {
      let j = i;
      while (j < sql.length && /\s/.test(sql[j])) j++;
      tokens.push({ type: "whitespace", value: " " });
      i = j;
      continue;
    }

    // Semicolon
    if (sql[i] === ";") {
      tokens.push({ type: "semicolon", value: ";" });
      i++;
      continue;
    }

    // Parentheses
    if (sql[i] === "(") {
      tokens.push({ type: "paren_open", value: "(" });
      i++;
      continue;
    }
    if (sql[i] === ")") {
      tokens.push({ type: "paren_close", value: ")" });
      i++;
      continue;
    }

    // Comma
    if (sql[i] === ",") {
      tokens.push({ type: "comma", value: "," });
      i++;
      continue;
    }

    // Dot
    if (sql[i] === ".") {
      tokens.push({ type: "dot", value: "." });
      i++;
      continue;
    }

    // Star
    if (sql[i] === "*" && (tokens.length === 0 || tokens[tokens.length - 1].type !== "number")) {
      tokens.push({ type: "star", value: "*" });
      i++;
      continue;
    }

    // Number
    if (/\d/.test(sql[i])) {
      let j = i;
      while (j < sql.length && /[\d.]/.test(sql[j])) j++;
      tokens.push({ type: "number", value: sql.substring(i, j) });
      i = j;
      continue;
    }

    // Operators
    if (/[=<>!+\-*/%&|^~]/.test(sql[i])) {
      let op = sql[i];
      if (i + 1 < sql.length && /[=<>!]/.test(sql[i + 1])) {
        op += sql[i + 1];
        i++;
      }
      tokens.push({ type: "operator", value: op });
      i++;
      continue;
    }

    // Word (keyword or identifier)
    if (/[a-zA-Z_@#]/.test(sql[i])) {
      let j = i;
      while (j < sql.length && /[a-zA-Z0-9_@#$]/.test(sql[j])) j++;
      const word = sql.substring(i, j);
      const upper = word.toUpperCase();

      // Check for multi-word keywords
      let combined = upper;
      let lookAhead = j;
      // Skip whitespace and check next word
      while (lookAhead < sql.length && /\s/.test(sql[lookAhead])) lookAhead++;
      if (lookAhead < sql.length && /[a-zA-Z]/.test(sql[lookAhead])) {
        let k = lookAhead;
        while (k < sql.length && /[a-zA-Z0-9_]/.test(sql[k])) k++;
        const nextWord = sql.substring(lookAhead, k);
        const twoWord = upper + " " + nextWord.toUpperCase();

        // Check three-word keywords
        let threeWordMatch = false;
        let lookAhead2 = k;
        while (lookAhead2 < sql.length && /\s/.test(sql[lookAhead2])) lookAhead2++;
        if (lookAhead2 < sql.length && /[a-zA-Z]/.test(sql[lookAhead2])) {
          let m = lookAhead2;
          while (m < sql.length && /[a-zA-Z0-9_]/.test(sql[m])) m++;
          const thirdWord = sql.substring(lookAhead2, m);
          const threeWord = twoWord + " " + thirdWord.toUpperCase();
          if (ALL_KEYWORDS.includes(threeWord)) {
            tokens.push({ type: "keyword", value: word + " " + nextWord + " " + thirdWord, upper: threeWord });
            i = m;
            threeWordMatch = true;
          }
        }

        if (!threeWordMatch) {
          if (ALL_KEYWORDS.includes(twoWord)) {
            tokens.push({ type: "keyword", value: word + " " + nextWord, upper: twoWord });
            i = k;
          } else if (ALL_KEYWORDS.includes(upper)) {
            tokens.push({ type: "keyword", value: word, upper });
            i = j;
          } else {
            tokens.push({ type: "identifier", value: word });
            i = j;
          }
        }
      } else {
        if (ALL_KEYWORDS.includes(upper)) {
          tokens.push({ type: "keyword", value: word, upper });
        } else {
          tokens.push({ type: "identifier", value: word });
        }
        i = j;
      }
      continue;
    }

    // Anything else
    tokens.push({ type: "identifier", value: sql[i] });
    i++;
  }

  return tokens.filter(t => t.type !== "whitespace" || true);
}

// New-line-inducing keywords (these get their own line)
const NEWLINE_KEYWORDS = new Set([
  "SELECT", "FROM", "WHERE", "JOIN", "INNER JOIN", "LEFT JOIN", "RIGHT JOIN",
  "FULL JOIN", "FULL OUTER JOIN", "CROSS JOIN", "LEFT OUTER JOIN", "RIGHT OUTER JOIN",
  "ORDER BY", "GROUP BY", "HAVING", "LIMIT", "OFFSET",
  "UNION", "UNION ALL", "INTERSECT", "EXCEPT",
  "INSERT INTO", "VALUES", "UPDATE", "SET", "DELETE FROM",
  "CREATE TABLE", "ALTER TABLE", "DROP TABLE",
  "WITH", "ON",
]);

// Keywords that increase indent
const INDENT_KEYWORDS = new Set(["AND", "OR"]);

export function formatSQL(sql: string, options: Partial<FormatOptions> = {}): string {
  const opts: FormatOptions = { ...DEFAULT_OPTIONS, ...options };
  const indent = " ".repeat(opts.indentSize);

  const trimmed = sql.trim();
  if (!trimmed) return "";

  const tokens = tokenize(trimmed);

  // Filter out pure whitespace tokens and rebuild
  const filtered = tokens.filter(t => t.type !== "whitespace");

  const lines: string[] = [];
  let currentLine = "";
  let indentLevel = 0;
  let parenDepth = 0;
  let inSelect = false;

  for (let i = 0; i < filtered.length; i++) {
    const token = filtered[i];
    const upper = token.upper || token.value.toUpperCase();
    const prevToken = i > 0 ? filtered[i - 1] : null;
    const nextToken = i < filtered.length - 1 ? filtered[i + 1] : null;

    if (token.type === "comment") {
      if (currentLine.trim()) {
        lines.push(indent.repeat(indentLevel) + currentLine.trim());
        currentLine = "";
      }
      lines.push(indent.repeat(indentLevel) + token.value);
      continue;
    }

    if (token.type === "keyword" && NEWLINE_KEYWORDS.has(upper) && parenDepth === 0) {
      // Push current line
      if (currentLine.trim()) {
        lines.push(indent.repeat(indentLevel) + currentLine.trim());
        currentLine = "";
      }

      inSelect = upper === "SELECT";

      const kwValue = opts.uppercaseKeywords ? upper : token.value.toLowerCase();
      currentLine = kwValue;
      continue;
    }

    if (token.type === "keyword" && INDENT_KEYWORDS.has(upper) && parenDepth === 0) {
      if (currentLine.trim()) {
        lines.push(indent.repeat(indentLevel) + currentLine.trim());
        currentLine = "";
      }
      const kwValue = opts.uppercaseKeywords ? upper : token.value.toLowerCase();
      currentLine = indent + kwValue;
      continue;
    }

    if (token.type === "keyword" && (upper === "CASE") && parenDepth === 0) {
      const kwValue = opts.uppercaseKeywords ? upper : token.value.toLowerCase();
      currentLine += " " + kwValue;
      continue;
    }

    if (token.type === "keyword" && (upper === "WHEN" || upper === "THEN" || upper === "ELSE" || upper === "END") && parenDepth === 0) {
      if (currentLine.trim()) {
        lines.push(indent.repeat(indentLevel) + currentLine.trim());
        currentLine = "";
      }
      const kwValue = opts.uppercaseKeywords ? upper : token.value.toLowerCase();
      if (upper === "END") {
        currentLine = indent + kwValue;
      } else {
        currentLine = indent.repeat(2) + kwValue;
      }
      continue;
    }

    if (token.type === "comma" && parenDepth === 0) {
      if (opts.commaPosition === "trailing") {
        currentLine += ",";
        if (currentLine.trim()) {
          lines.push(indent.repeat(indentLevel) + currentLine.trim());
          currentLine = indent;
        }
      } else {
        if (currentLine.trim()) {
          lines.push(indent.repeat(indentLevel) + currentLine.trim());
          currentLine = indent + ",";
        }
      }
      continue;
    }

    if (token.type === "paren_open") {
      parenDepth++;
      currentLine += " (";
      continue;
    }

    if (token.type === "paren_close") {
      parenDepth--;
      currentLine += ")";
      continue;
    }

    if (token.type === "semicolon") {
      currentLine += ";";
      if (currentLine.trim()) {
        lines.push(indent.repeat(indentLevel) + currentLine.trim());
        currentLine = "";
      }
      // Add blank line between statements
      lines.push("");
      continue;
    }

    if (token.type === "dot") {
      currentLine += ".";
      continue;
    }

    // Add space before token if needed
    if (currentLine && !currentLine.endsWith("(") && !currentLine.endsWith(".") && token.type !== "dot") {
      currentLine += " ";
    }

    if (token.type === "keyword") {
      currentLine += opts.uppercaseKeywords ? upper : token.value.toLowerCase();
    } else {
      currentLine += token.value;
    }
  }

  // Push remaining line
  if (currentLine.trim()) {
    lines.push(indent.repeat(indentLevel) + currentLine.trim());
  }

  // Clean up: remove trailing empty lines
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }

  return lines.join("\n");
}
