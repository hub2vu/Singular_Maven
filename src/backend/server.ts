import "dotenv/config";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { assertSafeAutomationAction, IRREVERSIBLE_DENYLIST } from "../shared/safety.js";
import type { ModerationObservation, ObservationImage, PolicyCorpus } from "../shared/types.js";
import { openAIOAuthProxyStatus } from "./auth/openaiOAuthProxy.js";
import { auditDecision, judgeObservation } from "./judge/pipeline.js";
import { makeMockJudgeProvider, makeOpenAIJudgeProvider } from "./judge/openaiProvider.js";
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
    nearbyText: z.string().optional()
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
    "judge.uploaded-images"
  ]
} as const;

const AD_IMAGE_PATTERN = /(^|[/_.\-\s])(ad|ads|adn|adfit|advert|advertise|banner|sponsor|doubleclick|googlesyndication|criteo|taboola|outbrain|tracking|beacon|pixel|logo|icon)([/_.\-\s]|$)/iu;

function isUsableImageUrl(src: string): boolean {
  return /^https?:\/\//iu.test(src) || /^data:image\//iu.test(src);
}

function isLikelyAdOrChromeImage(image: ObservationImage): boolean {
  const haystack = `${image.src} ${image.alt ?? ""} ${image.nearbyText ?? ""}`.toLowerCase();
  return AD_IMAGE_PATTERN.test(haystack);
}

function uploadedPostImages(observation: ModerationObservation): ObservationImage[] {
  const seen = new Set<string>();
  return observation.images
    .map((image) => ({
      src: image.src.trim(),
      alt: image.alt,
      nearbyText: image.nearbyText
    }))
    .filter((image) => {
      if (!image.src || seen.has(image.src)) return false;
      seen.add(image.src);
      return isUsableImageUrl(image.src) && !isLikelyAdOrChromeImage(image);
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
    return { evidence: retrievePolicyEvidence(ingested, body.observation as ModerationObservation, 10) };
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
    const evidence = retrievePolicyEvidence(ingested, body.observation as ModerationObservation, 12);
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

    const imageObservation: ModerationObservation = {
      ...observation,
      images
    };
    const ingested = await ensureCorpus();
    const evidence = retrievePolicyEvidence(ingested, imageObservation, 12);
    const mockEnabled = options.mockLlm ?? process.env.MAVEN_ALLOW_MOCK_LLM === "1";
    const provider = mockEnabled ? makeMockJudgeProvider() : makeOpenAIJudgeProvider();
    const result = await judgeObservation({
      observation: imageObservation,
      imageUrls: images.map((image) => image.src),
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
      imageCount: images.length,
      attachedImageUrls: images.map((image) => image.src)
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
