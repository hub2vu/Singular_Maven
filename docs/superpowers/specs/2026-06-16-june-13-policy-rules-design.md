# June 13 Policy Rules Design

## Summary

The current copilot judges pages by retrieving compact policy evidence from a local corpus and passing that evidence to an LLM. The 2026-06-13 gallery rules should be added as canonical seed evidence so the system can surface them even when the older 2026-06-02 manager corpus does not contain the final public notice.

## Architecture

The change stays inside the existing read-only pipeline:

- `src/backend/policy/ingest.ts` will add 2026-06-13 seed documents and keyword tags.
- `src/backend/policy/retrieval.ts` will learn the same query categories so observations retrieve the right seed evidence.
- `src/backend/judge/schema.ts` and `src/shared/types.ts` will allow the new issue categories in judgment cards.
- Prompt requirements will summarize the latest policy, including exceptions for fact-based moderator criticism, current technology criticism, and simple profanity.

No action automation changes are planned. Delete, ban, submit, post, comment, confirm, save, and apply remain forbidden.

## Categories

The new seed categories cover: law/social norms, nickname mention/clique/impersonation, trolling, religion/conspiracy, anti-science/pseudoscience, unreferenced anti-singularity claims, uncited expert claims and fanboy/fight-bait, stocks/coins/investment, nationalism/demographic bait, politics/region/gender hate, other gallery/community mentions, pessimism-gallery activity, false information, abusive fights, banned topics, front-page restriction, reference standards, allowed exceptions, and program promotion.

## Testing

Tests should prove the new policy seeds are ingested, retrieve for representative new-rule language, and appear in prompts. Existing tests that asserted nickname-con policy removal must be updated because the user asked to reflect the current 2026-06-13 rule.

