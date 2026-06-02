import type { ModerationObservation } from "./types.js";

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\b(password|passwd|비밀번호)\s*[:=]\s*([^\s"'&]+)/giu, "$1=[REDACTED]"],
  [/\b(cookie|session|token|authorization|bearer|secret)\s*[:=]\s*([^\s"'&]+)/giu, "$1=[REDACTED]"],
  [/\b(openai[_-]?api[_-]?key|api[_-]?key)\s*[:=]\s*([^\s"'&]+)/giu, "$1=[REDACTED]"],
  [/\bsk-[A-Za-z0-9_-]{10,}\b/gu, "[REDACTED_OPENAI_KEY]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{10,}\b/gu, "Bearer [REDACTED]"]
];

const SENSITIVE_KEY_RE = /(password|passwd|비밀번호|cookie|session|token|authorization|secret|api[_-]?key|csrf|credential)/iu;

export function redactText(input: string): string {
  return SECRET_PATTERNS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), input);
}

function redactDeep(value: unknown): unknown {
  if (typeof value === "string") {
    return redactText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactDeep(item));
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      output[key] = SENSITIVE_KEY_RE.test(key) ? "[REDACTED]" : redactDeep(child);
    }
    return output;
  }
  return value;
}

export function redactObservation<T extends ModerationObservation>(observation: T): T {
  return redactDeep(observation) as T;
}

export function redactJson<T>(value: T): T {
  return redactDeep(value) as T;
}
