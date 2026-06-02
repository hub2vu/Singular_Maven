export const ALLOWED_JUDGE_MODELS = [
  "gpt-5.5",
  "gpt-5.5-mini",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark",
  "gpt-5.2"
] as const;

export type JudgeModel = typeof ALLOWED_JUDGE_MODELS[number];

export const DEFAULT_JUDGE_MODEL: JudgeModel = "gpt-5.5";

export function isAllowedJudgeModel(value: unknown): value is JudgeModel {
  return typeof value === "string" && (ALLOWED_JUDGE_MODELS as readonly string[]).includes(value);
}

export function resolveJudgeModel(value: unknown): JudgeModel {
  return isAllowedJudgeModel(value) ? value : DEFAULT_JUDGE_MODEL;
}
