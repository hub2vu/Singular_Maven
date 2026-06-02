import type { JudgePrompt, JudgmentCard, PolicyEvidence } from "../../shared/types.js";
import { ensureOpenAIOAuthProxy } from "../auth/openaiOAuthProxy.js";
import { validateJudgeCard } from "./schema.js";

export interface OpenAIJudgeProviderOptions {
  model?: string;
  baseUrl?: string;
  port?: number;
  autoStartProxy?: boolean;
}

export interface LlmProviderInput {
  prompt: JudgePrompt;
  model: string;
  evidence: PolicyEvidence[];
  screenshotDataUrl?: string;
  imageUrls?: string[];
  visionEnabled: boolean;
}

export type LlmProvider = (input: LlmProviderInput) => Promise<JudgmentCard | string>;

export interface TextProviderInput {
  system: string;
  user: string;
  model: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

export type TextProvider = (input: TextProviderInput) => Promise<string>;

function extractOutputText(response: any): string {
  const messageContent = response.choices?.[0]?.message?.content;
  if (typeof messageContent === "string") return messageContent;
  if (Array.isArray(messageContent)) {
    const parts = messageContent
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part?.text === "string") return part.text;
        return "";
      })
      .filter(Boolean);
    if (parts.length) return parts.join("\n");
  }
  if (typeof response.output_text === "string") return response.output_text;
  const chunks: string[] = [];
  for (const output of response.output ?? []) {
    for (const content of output.content ?? []) {
      if (typeof content.text === "string") chunks.push(content.text);
    }
  }
  if (chunks.length) return chunks.join("\n");
  throw new Error("openai-oauth response did not include text output");
}

function buildUserContent(prompt: JudgePrompt, options: { screenshotDataUrl?: string; imageUrls?: string[]; visionEnabled: boolean }): any {
  if (!options.visionEnabled) return prompt.user;
  const imageUrls = (options.imageUrls ?? []).filter(Boolean);
  const fallbackScreenshot = imageUrls.length ? undefined : options.screenshotDataUrl;
  const attachments = [...imageUrls, ...(fallbackScreenshot ? [fallbackScreenshot] : [])];
  if (!attachments.length) return prompt.user;
  return [
    { type: "text", text: prompt.user },
    ...attachments.map((url) => ({ type: "image_url", image_url: { url } }))
  ];
}

export function makeOpenAIJudgeProvider(options: OpenAIJudgeProviderOptions = {}): LlmProvider {
  return async ({ prompt, model, screenshotDataUrl, imageUrls, visionEnabled }) => {
    const status = await ensureOpenAIOAuthProxy({
      baseUrl: options.baseUrl,
      port: options.port,
      autoStart: options.autoStartProxy
    });

    const response = await fetch(`${status.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: options.model ?? model,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: buildUserContent(prompt, { screenshotDataUrl, imageUrls, visionEnabled }) }
        ],
        temperature: 0.2
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`openai-oauth request failed ${response.status}: ${errorText.slice(0, 500)}`);
    }

    const json = await response.json();
    return validateJudgeCard(extractOutputText(json));
  };
}

export function makeOpenAITextProvider(options: OpenAIJudgeProviderOptions = {}): TextProvider {
  return async ({ system, user, model, history = [] }) => {
    const status = await ensureOpenAIOAuthProxy({
      baseUrl: options.baseUrl,
      port: options.port,
      autoStart: options.autoStartProxy
    });

    const messages = [
      { role: "system", content: system },
      ...history.map((item) => ({ role: item.role, content: item.content })),
      { role: "user", content: user }
    ];
    const response = await fetch(`${status.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: options.model ?? model,
        messages,
        temperature: 0.2
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`openai-oauth request failed ${response.status}: ${errorText.slice(0, 500)}`);
    }

    return extractOutputText(await response.json());
  };
}

export function makeMockJudgeProvider(): LlmProvider {
  return async ({ evidence }) => ({
    summary: "개발용 mock LLM 판단 카드입니다. 실제 운영에서는 openai-oauth 로컬 프록시 로그인을 사용하세요.",
    issue_types: evidence.some((item) => item.tags.includes("특갤봇 명령 후보")) ? ["특갤봇 명령 후보"] : [],
    matched_rules: evidence,
    llm_reasoning: "테스트 환경에서 observation + policy evidence 배선을 검증하기 위한 mock 결과입니다.",
    uncertainty: "높음",
    false_positive_risk: "mock 결과이므로 실제 판단에 사용하지 마세요.",
    recommended_actions: [{ type: "보류", label: "수동 검토", rationale: "mock provider" }],
    current_page_evidence: [{ quote: "mock observation quote", location: "test" }],
    policy_evidence: evidence.slice(0, 3).map((item) => ({ source_post_no: item.source_post_no, quote: item.excerpt, rule_id: item.rule_id })),
    special_bot_command_candidates: [],
    final_human_decision_required: true
  });
}
