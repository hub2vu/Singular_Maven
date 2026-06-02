export type DefenseCommandKind = "게시물방어" | "댓글방어" | "방어";

export interface ParsedBotCommand {
  kind: DefenseCommandKind;
  minutes: number;
  raw: string;
}

export function parseBotCommand(input: string): ParsedBotCommand | null {
  const match = input.trim().match(/^@특갤봇\s*(게시물방어|댓글방어|방어)\((\d+)\)$/u);
  if (!match) return null;
  const minutes = Number(match[2]);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10) return null;
  return { kind: match[1] as DefenseCommandKind, minutes, raw: input.trim() };
}

export function makeDefenseCommand(kind: DefenseCommandKind, minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10) {
    throw new Error("특갤봇 방어 명령의 n은 1~10 정수만 허용됩니다.");
  }
  return `@특갤봇 ${kind}(${minutes})`;
}

export function makePostPushCommand(postNo: string): string {
  if (!/^\d{3,}$/.test(postNo)) {
    throw new Error("게시물번호 명령 후보는 숫자 글번호만 허용됩니다.");
  }
  return `@특갤봇 ${postNo}`;
}
