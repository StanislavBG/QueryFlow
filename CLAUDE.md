# QueryFlow — Project Guidelines

## Architecture Principles

- **All buttons, parsers, and smart features must be LLM-based.** Do not write local heuristic/regex parsing logic or rule-based feature implementations. Any intelligent behavior (schema parsing, format detection, query analysis, etc.) should go through an LLM call.
