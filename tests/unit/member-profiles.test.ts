import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  deriveMemberKey,
  memberRefsFromObservation,
  MemberProfileStore
} from "../../src/backend/members/profiles.js";
import type { ModerationObservation } from "../../src/shared/types.js";

function observationFixture(): ModerationObservation {
  return {
    url: "https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=777777",
    title: "Fixture DCInside post",
    galleryId: "thesingularity",
    postNo: "777777",
    author: { name: "fixed-user", uid: "semi123", ip: "118.235", raw: "fixed-user semi123 118.235" },
    bodyText: "Observed body.",
    comments: [
      {
        id: "comment_li_1",
        author: "guest",
        authorIdentity: { name: "guest", ip: "223.39", raw: "guest 223.39" },
        text: "first comment",
        depth: 0
      },
      {
        id: "reply_li_2",
        author: "fixed-user",
        authorIdentity: { name: "fixed-user", uid: "semi123", ip: "118.235", raw: "fixed-user semi123 118.235" },
        text: "reply",
        depth: 1
      }
    ],
    images: [],
    links: [],
    clickableLabels: [],
    metadata: {}
  };
}

describe("member profile storage", () => {
  it("derives stable local member keys from uid first, then ip plus nickname, then nickname", () => {
    expect(deriveMemberKey({ uid: "Semi123", ip: "118.235", name: "fixed-user" })).toBe("uid:semi123");
    expect(deriveMemberKey({ ip: "223.39", name: "guest" })).toBe("ip-name:223.39:guest");
    expect(deriveMemberKey({ name: "nickname only" })).toBe("name:nickname only");
  });

  it("extracts post and comment member references from an observation", () => {
    const refs = memberRefsFromObservation(observationFixture());

    expect(refs).toHaveLength(3);
    expect(refs[0]).toMatchObject({ role: "post_author", key: "uid:semi123" });
    expect(refs[1]).toMatchObject({ role: "comment_author", key: "ip-name:223.39:guest", commentId: "comment_li_1" });
    expect(refs[2]).toMatchObject({ role: "comment_author", key: "uid:semi123", commentId: "reply_li_2" });
  });

  it("upserts observed members and persists manual risk overrides locally", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "maven-members-"));
    try {
      const store = new MemberProfileStore({ dataDir: tmp });
      const observed = await store.observeObservation(observationFixture());
      await store.setRisk({ key: "uid:semi123", riskLevel: "high", note: "manual moderator mark" });
      const persisted = JSON.parse(await readFile(path.join(tmp, "member-profiles.json"), "utf8"));

      expect(observed.profiles.map((profile) => profile.key)).toEqual(["uid:semi123", "ip-name:223.39:guest"]);
      expect(observed.profiles[0]).toMatchObject({
        key: "uid:semi123",
        riskLevel: "low",
        observationCount: 2,
        postCount: 1,
        commentCount: 1
      });
      expect(persisted.profiles["uid:semi123"].riskLevel).toBe("high");
      expect(persisted.profiles["uid:semi123"].riskNote).toBe("manual moderator mark");
      expect(persisted.profiles["uid:semi123"].aliases).toContain("fixed-user");
      expect(persisted.profiles["uid:semi123"].uids).toContain("semi123");
      expect(persisted.profiles["uid:semi123"].ips).toContain("118.235");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
