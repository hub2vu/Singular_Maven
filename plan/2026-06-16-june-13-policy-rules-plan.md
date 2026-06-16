# June 13 Policy Rules Implementation Plan

Goal: reflect the 2026-06-13 thesingularity gallery rules in the current moderation copilot without changing the read-only safety model.

Approved direction: the user asked to apply the missing rules after the audit found partial coverage only. This plan treats that as approval for a focused rules/data update.

Scope:
- Add 2026-06-13 policy seed documents to the local policy corpus.
- Expand issue types, retrieval categories, and query keywords so the LLM can receive relevant policy evidence for the new rules.
- Replace the old nickname-con disabled guardrail with the current nickname mention / clique / impersonation rule while keeping evidence and human-review requirements.
- Keep all irreversible moderation actions human-only.

Implementation order:
1. Write failing policy and prompt tests for the new rules.
2. Add the new issue types to shared types and judge schema.
3. Add 2026-06-13 seed policy documents and keyword categories to ingest and retrieval.
4. Update prompt guidance so the LLM applies the current policy and allowed exceptions.
5. Run targeted tests, typecheck, and the existing policy/judge tests.

Verification:
- `npm test -- tests/unit/policy.test.ts tests/unit/judge-safety.test.ts`
- `npm run typecheck`

