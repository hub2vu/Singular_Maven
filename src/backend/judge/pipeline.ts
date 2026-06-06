import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { redactJson, redactObservation } from "../../shared/redaction.js";
import type { JudgePrompt, JudgmentCard, ModerationObservation, PolicyEvidence } from "../../shared/types.js";
import { resolveJudgeModel } from "./models.js";
import { makeOpenAIJudgeProvider, makeOpenAITextJudgeProvider, type LlmProvider, type TextJudgeProvider } from "./openaiProvider.js";
import { createJudgePrompt, createPageTextJudgePrompt, validateJudgeCard } from "./schema.js";

export interface JudgeObservationOptions {
  observation: ModerationObservation;
  evidence: PolicyEvidence[];
  screenshotDataUrl?: string;
  imageUrls?: string[];
  imageSourceUrls?: string[];
  imageInputKinds?: Array<"url" | "data-url">;
  dataDir?: string;
  model?: string;
  promptMode?: "page" | "uploaded-images";
  visionEnabled?: boolean;
  llmProvider?: LlmProvider;
}

export interface JudgeObservationResult {
  card: JudgmentCard;
  auditId: string;
  auditPath: string;
  screenshotPath?: string;
  prompt: JudgePrompt;
}

export interface JudgeTextObservationOptions {
  observation: ModerationObservation;
  evidence: PolicyEvidence[];
  dataDir?: string;
  model?: string;
  llmProvider?: TextJudgeProvider;
}

export interface JudgeTextObservationResult {
  card: JudgmentCard;
  auditId: string;
  auditPath: string;
  prompt: JudgePrompt;
}

export interface HumanDecisionAudit {
  outcome: string;
  note?: string;
  decidedAt?: string;
}

export interface AuditDecisionOptions {
  dataDir: string;
  auditId: string;
  decision: HumanDecisionAudit;
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function today(timestamp: string): string {
  return timestamp.slice(0, 10);
}

async function saveScreenshot(dataDir: string, auditId: string, screenshotDataUrl?: string): Promise<string | undefined> {
  if (!screenshotDataUrl?.startsWith("data:image/")) return undefined;
  const [, base64] = screenshotDataUrl.split(",", 2);
  if (!base64) return undefined;
  const screenshotsDir = path.join(dataDir, "screenshots");
  await mkdir(screenshotsDir, { recursive: true });
  const screenshotPath = path.join(screenshotsDir, `${auditId}.png`);
  await writeFile(screenshotPath, Buffer.from(base64, "base64"));
  return screenshotPath;
}

function auditImageRefs(imageUrls: string[], sourceUrls?: string[]): string[] {
  return imageUrls.map((url, index) => {
    if (url.startsWith("data:image/")) return sourceUrls?.[index] ?? "data:image/[inline]";
    return url;
  });
}

function auditImageInputKinds(imageUrls: string[], kinds?: Array<"url" | "data-url">): Array<"url" | "data-url"> {
  return kinds ?? imageUrls.map((url) => url.startsWith("data:image/") ? "data-url" : "url");
}

export function pageTextObservation(observation: ModerationObservation): ModerationObservation {
  return { ...observation, images: [] };
}

function auditTextObservation(observation: ModerationObservation): Record<string, unknown> {
  const redacted = redactObservation(pageTextObservation(observation)) as unknown as Record<string, unknown>;
  const textObservation = { ...redacted };
  delete textObservation.images;
  return textObservation;
}

export async function judgeTextObservation(options: JudgeTextObservationOptions): Promise<JudgeTextObservationResult> {
  const timestamp = new Date().toISOString();
  const dataDir = options.dataDir ?? path.join(process.cwd(), "data");
  const model = resolveJudgeModel(options.model ?? process.env.OPENAI_MODEL);
  const textObservation = pageTextObservation(options.observation);
  const redactedObservation = auditTextObservation(textObservation);
  const observationHash = sha256(JSON.stringify(redactedObservation));
  const auditId = `${timestamp.replace(/[:.]/gu, "-")}_${observationHash.slice(0, 12)}`;
  const prompt = createPageTextJudgePrompt({ observation: textObservation, evidence: options.evidence, model });
  const provider = options.llmProvider ?? makeOpenAITextJudgeProvider();
  const rawCard = await provider({
    prompt,
    model,
    evidence: options.evidence
  });
  const card = validateJudgeCard(rawCard);

  const auditDir = path.join(dataDir, "audit", today(timestamp));
  await mkdir(auditDir, { recursive: true });
  const auditPath = path.join(auditDir, `${auditId}.json`);
  const auditRecord = redactJson({
    auditId,
    timestamp,
    model,
    judgmentMode: "page-text",
    observationHash,
    redactedObservation,
    retrievedPolicyRefs: options.evidence,
    llmInput: prompt,
    llmOutput: card
  });
  await writeFile(auditPath, JSON.stringify(auditRecord, null, 2), "utf8");

  return { card, auditId, auditPath, prompt };
}

export async function judgeObservation(options: JudgeObservationOptions): Promise<JudgeObservationResult> {
  const timestamp = new Date().toISOString();
  const dataDir = options.dataDir ?? path.join(process.cwd(), "data");
  const model = resolveJudgeModel(options.model ?? process.env.OPENAI_MODEL);
  const visionEnabled = options.visionEnabled ?? process.env.ENABLE_VISION === "1";
  const redactedObservation = redactObservation(options.observation);
  const observationHash = sha256(JSON.stringify(redactedObservation));
  const auditId = `${timestamp.replace(/[:.]/gu, "-")}_${observationHash.slice(0, 12)}`;
  const screenshotPath = await saveScreenshot(dataDir, auditId, options.screenshotDataUrl);
  const imageUrls = (options.imageUrls ?? []).filter(Boolean);
  const prompt = createJudgePrompt({ observation: redactedObservation, evidence: options.evidence, model, visionEnabled, mode: options.promptMode ?? "page" });
  const provider = options.llmProvider ?? makeOpenAIJudgeProvider();
  const rawCard = await provider({
    prompt,
    model,
    evidence: options.evidence,
    screenshotDataUrl: visionEnabled && imageUrls.length === 0 ? options.screenshotDataUrl : undefined,
    imageUrls: visionEnabled ? imageUrls : undefined,
    visionEnabled
  });
  const card = validateJudgeCard(rawCard);

  const auditDir = path.join(dataDir, "audit", today(timestamp));
  await mkdir(auditDir, { recursive: true });
  const auditPath = path.join(auditDir, `${auditId}.json`);
  const auditRecord = redactJson({
    auditId,
    timestamp,
    model,
    visionEnabled,
    observationHash,
    redactedObservation,
    retrievedPolicyRefs: options.evidence,
    llmInput: prompt,
    llmOutput: card,
    attachedImageUrls: auditImageRefs(imageUrls, options.imageSourceUrls),
    attachedImageInputKinds: auditImageInputKinds(imageUrls, options.imageInputKinds),
    screenshotPath
  });
  await writeFile(auditPath, JSON.stringify(auditRecord, null, 2), "utf8");

  return { card, auditId, auditPath, screenshotPath, prompt };
}

export async function auditDecision(options: AuditDecisionOptions): Promise<string> {
  const timestamp = new Date().toISOString();
  const decisionsDir = path.join(options.dataDir, "audit", "decisions");
  await mkdir(decisionsDir, { recursive: true });
  const decisionPath = path.join(decisionsDir, `${options.auditId}-decision.json`);
  const existing = await safeReadExistingAudit(options.dataDir, options.auditId);
  await writeFile(decisionPath, JSON.stringify(redactJson({
    auditId: options.auditId,
    timestamp,
    originalAuditFound: Boolean(existing),
    decision: options.decision
  }), null, 2), "utf8");
  return decisionPath;
}

async function safeReadExistingAudit(dataDir: string, auditId: string): Promise<string | undefined> {
  const root = path.join(dataDir, "audit");
  const datePrefix = auditId.slice(0, 10);
  const candidate = path.join(root, datePrefix, `${auditId}.json`);
  try {
    return await readFile(candidate, "utf8");
  } catch {
    return undefined;
  }
}
