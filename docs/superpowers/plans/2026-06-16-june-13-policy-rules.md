# June 13 Policy Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the 2026-06-13 gallery rules to the moderation copilot's local policy retrieval and LLM prompt path.

**Architecture:** Extend the existing seed-document and keyword retrieval approach. Keep the LLM-first judgment model and the existing read-only safety broker unchanged.

**Tech Stack:** TypeScript, Fastify backend, Zod schema validation, Vitest.

---

### Task 1: Add Failing Tests

**Files:**
- Modify: `tests/unit/policy.test.ts`
- Modify: `tests/unit/judge-safety.test.ts`

- [ ] Add a policy corpus test asserting 2026-06-13 seed rules are present.
- [ ] Add retrieval cases for religion/conspiracy, anti-science, unreferenced anti-singularity claims, politics/gender hate, nickname/clique/impersonation, false information, banned topics, and allowed exceptions.
- [ ] Add a prompt test asserting the current rule guidance is visible.
- [ ] Run `npm test -- tests/unit/policy.test.ts tests/unit/judge-safety.test.ts` and confirm the new tests fail because the rules are missing.

### Task 2: Add Rule Categories

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/backend/judge/schema.ts`

- [ ] Extend `IssueType` and `ISSUE_TYPE_VALUES` with the new 2026-06-13 categories.
- [ ] Add enum aliases for common English model outputs.
- [ ] Update prompt requirements for the new public rule, exceptions, and reference standards.

### Task 3: Add Seed Policy Documents

**Files:**
- Modify: `src/backend/policy/ingest.ts`

- [ ] Add `TAG_KEYWORDS` entries for each new category.
- [ ] Add compact 2026-06-13 seed documents covering the public notice.
- [ ] Keep seed bodies concise but include actionable examples and allowed exceptions.

### Task 4: Add Retrieval Keywords

**Files:**
- Modify: `src/backend/policy/retrieval.ts`

- [ ] Mirror the new issue keywords in retrieval.
- [ ] Update category priority so specific new categories outrank generic operating evidence.
- [ ] Ensure the nickname/clique category retrieves only policy evidence and does not bypass human review.

### Task 5: Verify

**Files:**
- All modified files

- [ ] Run `npm test -- tests/unit/policy.test.ts tests/unit/judge-safety.test.ts`.
- [ ] Run `npm run typecheck`.
- [ ] Fix any regression in the focused tests.

