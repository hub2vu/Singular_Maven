import "dotenv/config";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { redactObservation } from "../shared/redaction.js";
import { assertSafeAutomationAction, IRREVERSIBLE_DENYLIST } from "../shared/safety.js";
import type { ModerationObservation, ObservationImage, PolicyCorpus, PolicyEvidence } from "../shared/types.js";
import { openAIOAuthProxyStatus } from "./auth/openaiOAuthProxy.js";
import { auditDecision, judgeObservation } from "./judge/pipeline.js";
import { policyEvidenceForPrompt } from "./judge/schema.js";
import { makeMockJudgeProvider, makeOpenAIImageBriefProvider, makeOpenAIJudgeProvider, makeOpenAITextProvider } from "./judge/openaiProvider.js";
import { ALLOWED_JUDGE_MODELS, isAllowedJudgeModel, resolveJudgeModel } from "./judge/models.js";
import { isMemberRiskLevel, MemberProfileStore } from "./members/profiles.js";
import { discoverPolicyPath } from "./policy/pathDiscovery.js";
import { ingestPolicyCorpus } from "./policy/ingest.js";
import { retrievePolicyEvidence } from "./policy/retrieval.js";

export interface BuildServerOptions {
  dataDir?: string;
  policyPath?: string;
  mockLlm?: boolean;
}

const observationAuthorSchema = z.object({
  name: z.string().optional(),
  uid: z.string().optional(),
  ip: z.string().optional(),
  raw: z.string().optional()
}).strict();

const observationSchema = z.object({
  url: z.string(),
  title: z.string(),
  galleryId: z.string().optional(),
  postNo: z.string().optional(),
  head: z.string().optional(),
  author: observationAuthorSchema.optional(),
  createdAtText: z.string().optional(),
  counts: z.record(z.string(), z.string().optional()).optional(),
  bodyText: z.string(),
  htmlExcerpt: z.string().optional(),
  comments: z.array(z.object({
    id: z.string().optional(),
    author: z.string().optional(),
    authorIdentity: observationAuthorSchema.optional(),
    date: z.string().optional(),
    text: z.string(),
    depth: z.number()
  })),
  images: z.array(z.object({
    src: z.string(),
    alt: z.string().optional(),
    nearbyText: z.string().optional(),
    dataUrl: z.string().optional()
  })),
  links: z.array(z.object({
    href: z.string(),
    text: z.string().optional()
  })),
  selectedText: z.string().optional(),
  viewportText: z.string().optional(),
  clickableLabels: z.array(z.string()),
  metadata: z.record(z.string(), z.unknown())
});

const judgeRequestSchema = z.object({
  observation: observationSchema,
  model: z.string().optional(),
  screenshotDataUrl: z.string().nullable().optional()
});

const contextChatRequestSchema = z.object({
  observation: observationSchema,
  question: z.string().trim().min(1).max(4000),
  model: z.string().optional(),
  card: z.unknown().optional(),
  auditId: z.string().optional(),
  history: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1).max(8000)
  }).strict()).max(12).optional()
});

const decisionRequestSchema = z.object({
  auditId: z.string().min(1),
  decision: z.object({
    outcome: z.string().min(1),
    note: z.string().optional(),
    decidedAt: z.string().optional()
  })
});

const safetyRequestSchema = z.object({
  kind: z.enum(["copy", "open_tab", "download", "scroll", "prefill", "click", "submit", "delete", "ban", "post", "comment", "confirm"]),
  label: z.string().optional(),
  selector: z.string().optional()
});

const memberRiskRequestSchema = z.object({
  key: z.string().min(1),
  riskLevel: z.string().refine(isMemberRiskLevel),
  note: z.string().optional()
});

const MAVEN_CAPABILITIES = {
  service: "dcinside-maven-copilot",
  version: "0.1.0",
  features: [
    "members.observe",
    "openai-oauth-proxy",
    "judge.model-select",
    "judge.uploaded-images",
    "images.list-title-brief",
    "context.chat"
  ]
} as const;

const AD_IMAGE_PATTERN = /(^|[/_.\-\s])(ad|ads|adn|adfit|advert|advertise|banner|sponsor|doubleclick|googlesyndication|criteo|taboola|outbrain|tracking|beacon|pixel|logo|icon)([/_.\-\s]|$)/iu;
const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  avif: "image/avif"
};

interface LoadedImageInput {
  image: ObservationImage;
  input: string;
}

interface ImageLoadFailure {
  src: string;
  reason: string;
}

function isUsableImageUrl(src: string): boolean {
  return /^https?:\/\//iu.test(src) || /^data:image\//iu.test(src);
}

function isNonEmptyImageDataUrl(value?: string): boolean {
  const match = String(value ?? "").match(/^data:image\/[a-z0-9.+-]+;base64,(.*)$/isu);
  return Boolean(match && match[1].trim().length > 0);
}

function imageMimeFromSource(src: string, fallbackType?: string | null): string | undefined {
  if (String(fallbackType || "").startsWith("image/")) return String(fallbackType);
  try {
    const url = new URL(src);
    const filename = decodeURIComponent(url.searchParams.get("f_no") || url.pathname);
    const extension = filename.match(/\.([a-z0-9]+)(?:$|[?#])/iu)?.[1]?.toLowerCase();
    return extension ? IMAGE_MIME_BY_EXTENSION[extension] : undefined;
  } catch {
    return undefined;
  }
}

function imageMimeFromBytes(bytes: Uint8Array): string | undefined {
  if (bytes.length < 4) return undefined;
  if (bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return "image/gif";
  }
  if (bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50) {
    return "image/webp";
  }
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return "image/bmp";
  }
  if (bytes.length >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70 &&
    bytes[8] === 0x61 &&
    bytes[9] === 0x76 &&
    bytes[10] === 0x69 &&
    (bytes[11] === 0x66 || bytes[11] === 0x73)) {
    return "image/avif";
  }
  return undefined;
}

function shouldRedownloadImage(image: ObservationImage): boolean {
  try {
    const url = new URL(image.src);
    return /(^|\.)dcinside\.(com|co\.kr)$/iu.test(url.hostname) || /^dcimg\d*\.dcinside\.co\.kr$/iu.test(url.hostname);
  } catch {
    return false;
  }
}

async function downloadImageAsDataUrl(image: ObservationImage, pageUrl?: string): Promise<string> {
  if (!/^https?:\/\//iu.test(image.src)) {
    throw new Error("image source is not downloadable");
  }
  const response = await fetch(image.src, {
    redirect: "follow",
    headers: {
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0",
      ...(pageUrl ? { Referer: pageUrl } : {})
    }
  });
  if (!response.ok) {
    throw new Error(`image download failed ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0) {
    throw new Error("image download returned empty image bytes");
  }
  const mimeType = imageMimeFromSource(image.src, response.headers.get("content-type")) ?? imageMimeFromBytes(bytes);
  if (!mimeType) {
    throw new Error(`image download returned non-image content-type: ${response.headers.get("content-type") || "unknown"}`);
  }
  return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
}

async function loadUploadedImageInputs(images: ObservationImage[], pageUrl?: string): Promise<{ loaded: LoadedImageInput[]; failures: ImageLoadFailure[] }> {
  const loaded: LoadedImageInput[] = [];
  const failures: ImageLoadFailure[] = [];
  for (const image of images) {
    try {
      if (shouldRedownloadImage(image)) {
        loaded.push({ image, input: await downloadImageAsDataUrl(image, pageUrl) });
      } else if (isNonEmptyImageDataUrl(image.dataUrl)) {
        loaded.push({ image, input: image.dataUrl as string });
      } else if (isNonEmptyImageDataUrl(image.src)) {
        loaded.push({ image, input: image.src });
      } else if (/^https?:\/\//iu.test(image.src)) {
        loaded.push({ image, input: await downloadImageAsDataUrl(image, pageUrl) });
      } else {
        throw new Error("image source did not include downloadable URL or non-empty data URL");
      }
    } catch (error) {
      failures.push({ src: image.src, reason: String(error instanceof Error ? error.message : error) });
    }
  }
  return { loaded, failures };
}

function createContextChatPrompt(options: {
  observation: ModerationObservation;
  question: string;
  evidence: PolicyEvidence[];
  card?: unknown;
  auditId?: string;
}): { system: string; user: string } {
  const system = [
    "You are a read-only DCInside Maven Copilot follow-up assistant.",
    "Answer the user's question using the current page observation, latest judgment card, and retrieved policy evidence.",
    "Do not execute or claim to execute moderation actions. Do not tell the user that deletion, ban, submit, or comment actions were completed.",
    "Keep final decisions human-only. If evidence is insufficient, say so plainly.",
    "Answer in Korean unless the user asks for another language."
  ].join("\n");
  const user = [
    "USER QUESTION:",
    options.question,
    "",
    `AUDIT ID: ${options.auditId || "-"}`,
    "",
    "CURRENT PAGE OBSERVATION (redacted JSON):",
    JSON.stringify(redactObservation(options.observation), null, 2),
    "",
    "LATEST JUDGMENT CARD (if present):",
    JSON.stringify(options.card ?? null, null, 2),
    "",
    "RETRIEVED POLICY / EVIDENCE POSTS:",
    JSON.stringify(policyEvidenceForPrompt(options.evidence))
  ].join("\n");
  return { system, user };
}

function createImageBriefPrompt(options: {
  observation: ModerationObservation;
  imageSourceUrls: string[];
}): { system: string; user: string } {
  const system = [
    "You are a read-only DCInside Maven image briefing assistant.",
    "Describe only the attached images from the selected post. Ignore ads, page chrome, screenshots, profile icons, and unrelated UI.",
    "This is not a moderation judgment card. Do not recommend deletion, banning, or any irreversible action.",
    "Brief the visible subject, objects, characters, text, and uncertainty. Mention moderation-relevant visual cues only as cues, not as final decisions.",
    "Answer in concise Korean."
  ].join("\n");
  const user = [
    "SELECTED POST OBSERVATION (redacted JSON):",
    JSON.stringify(redactObservation(options.observation), null, 2),
    "",
    "ATTACHED IMAGE SOURCE URLS:",
    JSON.stringify(options.imageSourceUrls, null, 2),
    "",
    "Write 3-6 concise bullets. Include image count. If the image is hard to read, say what is uncertain."
  ].join("\n");
  return { system, user };
}

function mockImageBrief(observation: ModerationObservation, imageCount: number): string {
  return `mock image brief: ${observation.title} includes ${imageCount} uploaded image(s). This response describes the selected post images only and does not create a moderation judgment card.`;
}

function mockContextAnswer(question: string, observation: ModerationObservation): string {
  return `mock context answer: ${observation.title} 기준으로 "${question}"에 답하려면 현재 본문, 댓글, 이미지 후보, 최근 판단 카드, policy evidence를 함께 확인해야 합니다. 최종 조치는 사람이 결정해야 합니다.`;
}

function isLikelyAdOrChromeImage(image: ObservationImage): boolean {
  const haystack = `${image.src} ${image.alt ?? ""} ${image.nearbyText ?? ""}`.toLowerCase();
  return AD_IMAGE_PATTERN.test(haystack);
}

function isLikelyPostPageUrl(src: string): boolean {
  try {
    const url = new URL(src);
    return /(^|\.)gall\.dcinside\.com$/iu.test(url.hostname) && /\/board\/view\//iu.test(url.pathname);
  } catch {
    return true;
  }
}

function uploadedPostImages(observation: ModerationObservation): ObservationImage[] {
  const seen = new Set<string>();
  return observation.images
    .map((image) => ({
      src: image.src.trim(),
      alt: image.alt,
      nearbyText: image.nearbyText,
      dataUrl: image.dataUrl
    }))
    .filter((image) => {
      if (!image.src || seen.has(image.src)) return false;
      seen.add(image.src);
      return isUsableImageUrl(image.src) && !isLikelyPostPageUrl(image.src) && !isLikelyAdOrChromeImage(image);
    });
}

export async function buildServer(options: BuildServerOptions = {}): Promise<FastifyInstance> {
  const server = Fastify({ logger: true });
  const dataDir = options.dataDir ?? path.join(process.cwd(), "data");
  const memberStore = new MemberProfileStore({ dataDir });
  let corpus: PolicyCorpus | undefined;

  await server.register(cors, {
    origin: [/^chrome-extension:\/\//u, /^http:\/\/127\.0\.0\.1/u, /^http:\/\/localhost/u, "null"],
    methods: ["GET", "POST", "OPTIONS"]
  });

  async function ensureCorpus(): Promise<PolicyCorpus> {
    if (corpus) return corpus;
    const discovered = await discoverPolicyPath({ cwd: process.cwd(), requestedPath: options.policyPath ?? process.env.POLICY_JSON_PATH ?? process.env.POLICY_REPORT_PATH });
    corpus = await ingestPolicyCorpus({ sourcePath: discovered.path, outDir: dataDir });
    return corpus;
  }

  server.get("/health", async () => ({
    ok: true,
    service: "dcinside-maven-copilot",
    readOnly: true,
    capabilitiesPath: "/api/capabilities"
  }));

  server.get("/api/capabilities", async () => MAVEN_CAPABILITIES);

  server.get("/api/auth/openai/status", async () => {
    return {
      ...await openAIOAuthProxyStatus(),
      model: resolveJudgeModel(process.env.OPENAI_MODEL),
      allowedModels: ALLOWED_JUDGE_MODELS,
      visionEnabled: process.env.ENABLE_VISION === "1",
      mockEnabled: options.mockLlm ?? process.env.MAVEN_ALLOW_MOCK_LLM === "1"
    };
  });

  server.post("/api/ingest", async () => {
    corpus = undefined;
    const ingested = await ensureCorpus();
    return { ok: true, count: ingested.count, documents: ingested.documents.length, source: ingested.source };
  });

  server.post("/api/retrieve", async (request) => {
    const body = judgeRequestSchema.pick({ observation: true }).parse(request.body);
    const ingested = await ensureCorpus();
    return { evidence: retrievePolicyEvidence(ingested, body.observation as ModerationObservation, 8) };
  });

  server.post("/api/members/observe", async (request) => {
    const body = judgeRequestSchema.pick({ observation: true }).parse(request.body);
    return memberStore.observeObservation(body.observation as ModerationObservation);
  });

  server.post("/api/members/risk", async (request, reply) => {
    const body = memberRiskRequestSchema.parse(request.body);
    try {
      const profile = await memberStore.setRisk(body);
      return { ok: true, profile };
    } catch (error) {
      return reply.code(404).send({ error: String(error instanceof Error ? error.message : error) });
    }
  });

  server.post("/api/judge", async (request, reply) => {
    const body = judgeRequestSchema.parse(request.body);
    if (body.model !== undefined && !isAllowedJudgeModel(body.model)) {
      return reply.code(400).send({
        error: "Unsupported judge model",
        model: body.model,
        allowedModels: ALLOWED_JUDGE_MODELS
      });
    }
    const ingested = await ensureCorpus();
    const evidence = retrievePolicyEvidence(ingested, body.observation as ModerationObservation, 8);
    const mockEnabled = options.mockLlm ?? process.env.MAVEN_ALLOW_MOCK_LLM === "1";
    const provider = mockEnabled ? makeMockJudgeProvider() : makeOpenAIJudgeProvider();
    const result = await judgeObservation({
      observation: body.observation as ModerationObservation,
      screenshotDataUrl: body.screenshotDataUrl ?? undefined,
      evidence,
      dataDir,
      model: resolveJudgeModel(body.model ?? process.env.OPENAI_MODEL),
      llmProvider: provider
    });
    return {
      auditId: result.auditId,
      card: result.card,
      screenshotPath: result.screenshotPath
    };
  });

  server.post("/api/judge/images", async (request, reply) => {
    const body = judgeRequestSchema.parse(request.body);
    if (body.model !== undefined && !isAllowedJudgeModel(body.model)) {
      return reply.code(400).send({
        error: "Unsupported judge model",
        model: body.model,
        allowedModels: ALLOWED_JUDGE_MODELS
      });
    }

    const observation = body.observation as ModerationObservation;
    const images = uploadedPostImages(observation);
    if (!images.length) {
      return reply.code(400).send({
        error: "No uploaded post images found",
        message: "No uploaded post images remained after excluding ad-like, UI, and tracking images."
      });
    }

    const imageInputs = await loadUploadedImageInputs(images, observation.url);
    if (!imageInputs.loaded.length) {
      return reply.code(400).send({
        error: "Uploaded post images could not be loaded",
        message: "Uploaded post image URLs were found, but none could be loaded as non-empty images.",
        failures: imageInputs.failures
      });
    }

    const loadedImages = imageInputs.loaded.map((item) => item.image);
    const imageObservation: ModerationObservation = {
      ...observation,
      images: loadedImages.map((image) => ({
        src: image.src,
        alt: image.alt,
        nearbyText: image.nearbyText
      }))
    };
    const ingested = await ensureCorpus();
    const evidence = retrievePolicyEvidence(ingested, imageObservation, 8);
    const mockEnabled = options.mockLlm ?? process.env.MAVEN_ALLOW_MOCK_LLM === "1";
    const provider = mockEnabled ? makeMockJudgeProvider() : makeOpenAIJudgeProvider();
    const result = await judgeObservation({
      observation: imageObservation,
      imageUrls: imageInputs.loaded.map((item) => item.input),
      imageSourceUrls: loadedImages.map((image) => image.src),
      imageInputKinds: imageInputs.loaded.map(() => "data-url"),
      evidence,
      dataDir,
      model: resolveJudgeModel(body.model ?? process.env.OPENAI_MODEL),
      promptMode: "uploaded-images",
      visionEnabled: true,
      llmProvider: provider
    });
    return {
      auditId: result.auditId,
      card: result.card,
      imageCount: loadedImages.length,
      attachedImageUrls: loadedImages.map((image) => image.src),
      imageLoadFailures: imageInputs.failures
    };
  });

  server.post("/api/images/brief", async (request, reply) => {
    const body = judgeRequestSchema.parse(request.body);
    if (body.model !== undefined && !isAllowedJudgeModel(body.model)) {
      return reply.code(400).send({
        error: "Unsupported judge model",
        model: body.model,
        allowedModels: ALLOWED_JUDGE_MODELS
      });
    }

    const observation = body.observation as ModerationObservation;
    const images = uploadedPostImages(observation);
    if (!images.length) {
      return reply.code(400).send({
        error: "No uploaded post images found",
        message: "No uploaded post images remained after excluding ad-like, UI, and tracking images."
      });
    }

    const imageInputs = await loadUploadedImageInputs(images, observation.url);
    if (!imageInputs.loaded.length) {
      return reply.code(400).send({
        error: "Uploaded post images could not be loaded",
        message: "Uploaded post image URLs were found, but none could be loaded as non-empty images.",
        failures: imageInputs.failures
      });
    }

    const loadedImages = imageInputs.loaded.map((item) => item.image);
    const imageObservation: ModerationObservation = {
      ...observation,
      images: loadedImages.map((image) => ({
        src: image.src,
        alt: image.alt,
        nearbyText: image.nearbyText
      }))
    };
    const model = resolveJudgeModel(body.model ?? process.env.OPENAI_MODEL);
    const prompt = createImageBriefPrompt({
      observation: imageObservation,
      imageSourceUrls: loadedImages.map((image) => image.src)
    });
    const mockEnabled = options.mockLlm ?? process.env.MAVEN_ALLOW_MOCK_LLM === "1";
    const answer = mockEnabled
      ? mockImageBrief(imageObservation, loadedImages.length)
      : await makeOpenAIImageBriefProvider()({
        ...prompt,
        model,
        imageUrls: imageInputs.loaded.map((item) => item.input)
      });

    return {
      answer,
      model,
      imageCount: loadedImages.length,
      attachedImageUrls: loadedImages.map((image) => image.src),
      imageLoadFailures: imageInputs.failures
    };
  });

  server.post("/api/chat/context", async (request, reply) => {
    const body = contextChatRequestSchema.parse(request.body);
    if (body.model !== undefined && !isAllowedJudgeModel(body.model)) {
      return reply.code(400).send({
        error: "Unsupported judge model",
        model: body.model,
        allowedModels: ALLOWED_JUDGE_MODELS
      });
    }

    const observation = body.observation as ModerationObservation;
    const model = resolveJudgeModel(body.model ?? process.env.OPENAI_MODEL);
    const ingested = await ensureCorpus();
    const evidence = retrievePolicyEvidence(ingested, observation, 6);
    const prompt = createContextChatPrompt({
      observation,
      question: body.question,
      evidence,
      card: body.card,
      auditId: body.auditId
    });
    const mockEnabled = options.mockLlm ?? process.env.MAVEN_ALLOW_MOCK_LLM === "1";
    const answer = mockEnabled
      ? mockContextAnswer(body.question, observation)
      : await makeOpenAITextProvider()({
        ...prompt,
        model,
        history: body.history
      });

    return {
      answer,
      model,
      evidenceCount: evidence.length
    };
  });

  server.post("/api/action/validate", async (request) => {
    const body = safetyRequestSchema.parse(request.body);
    return assertSafeAutomationAction(body);
  });

  server.get("/api/safety/denylist", async () => IRREVERSIBLE_DENYLIST);

  server.post("/api/audit/decision", async (request) => {
    const body = decisionRequestSchema.parse(request.body);
    const decisionPath = await auditDecision({ dataDir, auditId: body.auditId, decision: body.decision });
    return { ok: true, decisionPath };
  });

  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 8787);
  const host = process.env.HOST ?? "127.0.0.1";
  const server = await buildServer();
  await server.listen({ port, host });
}
