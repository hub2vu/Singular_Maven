export type SafeActionKind =
  | "copy"
  | "open_tab"
  | "download"
  | "scroll"
  | "prefill"
  | "click"
  | "submit"
  | "delete"
  | "ban"
  | "post"
  | "comment"
  | "confirm";

export interface SafeAutomationAction {
  kind: SafeActionKind;
  label?: string;
  selector?: string;
}

export interface SafeAutomationResult {
  allowed: boolean;
  reason?: string;
}

const DENIED_KOREAN_TERMS = [
  "삭제",
  "차단",
  "등록",
  "작성완료",
  "댓글등록",
  "확인",
  "저장",
  "적용",
  "전송",
  "완료",
  "게시",
  "발행"
];

const DENIED_ENGLISH_TERMS = [
  "delete",
  "remove",
  "ban",
  "block",
  "submit",
  "post",
  "comment",
  "confirm",
  "save",
  "apply",
  "send",
  "publish"
];

const DENIED_KINDS = new Set<SafeActionKind>(["submit", "delete", "ban", "post", "comment", "confirm"]);

function normalizeLabel(label: string): string {
  return label.toLowerCase().replace(/\s+/g, "");
}

export function isIrreversibleActionLabel(label: string | undefined): boolean {
  if (!label) return false;
  const normalized = normalizeLabel(label);
  return [...DENIED_KOREAN_TERMS, ...DENIED_ENGLISH_TERMS].some((term) => normalized.includes(normalizeLabel(term)));
}

export function isIrreversibleSelector(selector: string | undefined): boolean {
  if (!selector) return false;
  const normalized = selector.toLowerCase().replace(/\s+/g, "");
  return [
    "button[type=submit]",
    "input[type=submit]",
    "input[type=button]",
    "form[action*=delete]",
    "form[action*=ban]",
    "[data-action=delete]",
    "[data-action=ban]",
    "[onclick*=delete]",
    "[onclick*=submit]",
    "[onclick*=comment]"
  ].some((term) => normalized.includes(term.replace(/\s+/g, "")));
}

export function assertSafeAutomationAction(action: SafeAutomationAction): SafeAutomationResult {
  if (DENIED_KINDS.has(action.kind)) {
    return { allowed: false, reason: `Blocked irreversible action kind: ${action.kind}` };
  }
  if (isIrreversibleActionLabel(action.label)) {
    return { allowed: false, reason: `Blocked irreversible action label: ${action.label}` };
  }
  if (isIrreversibleSelector(action.selector)) {
    return { allowed: false, reason: `Blocked irreversible selector: ${action.selector}` };
  }
  return { allowed: true };
}

export const IRREVERSIBLE_DENYLIST = {
  korean: DENIED_KOREAN_TERMS,
  english: DENIED_ENGLISH_TERMS,
  kinds: [...DENIED_KINDS]
};
