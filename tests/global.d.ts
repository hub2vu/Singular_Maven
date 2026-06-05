import type { ModerationObservation } from "../src/shared/types.js";

declare global {
  interface Window {
    __DC_MAVEN_TEST__?: {
      sendMessage: (message: Record<string, unknown>) => Promise<unknown>;
    };
    __dcMavenCollectObservationForTest: () => ModerationObservation;
    __dcMavenSafeActionForTest: (action: Record<string, unknown>) => { allowed: boolean; reason?: string };
    clickedDelete?: number;
    clickedBan?: number;
    clickedComment?: number;
    healthAttempts?: number;
    ensureBackendCalls?: number;
    tokenEndpointCalled?: boolean;
    loginCalled?: boolean;
    judgeRequestBody?: any;
    memberObserveRequestBody?: any;
    memberRiskRequestBody?: any;
  }
}

export {};
