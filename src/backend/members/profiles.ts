import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ModerationObservation, ObservationAuthor } from "../../shared/types.js";

export type MemberRiskLevel = "low" | "watch" | "high";

export interface ObservedMemberRef {
  key: string;
  role: "post_author" | "comment_author";
  author: ObservationAuthor;
  postNo?: string;
  commentId?: string;
}

export interface MemberProfile {
  key: string;
  riskLevel: MemberRiskLevel;
  riskNote?: string;
  aliases: string[];
  uids: string[];
  ips: string[];
  rawAuthors: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  observationCount: number;
  postCount: number;
  commentCount: number;
}

export interface MemberProfilesFile {
  version: 1;
  updatedAt: string;
  profiles: Record<string, MemberProfile>;
}

export interface ObserveMembersResult {
  profiles: MemberProfile[];
  refs: ObservedMemberRef[];
}

export interface MemberProfileStoreOptions {
  dataDir: string;
}

export interface SetRiskOptions {
  key: string;
  riskLevel: MemberRiskLevel;
  note?: string;
}

const RISK_LEVELS = new Set<MemberRiskLevel>(["low", "watch", "high"]);

function normalize(value: unknown): string {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

function normalizeKeyPart(value: unknown): string {
  return normalize(value).toLowerCase();
}

function addUnique(values: string[], value: unknown): void {
  const normalized = normalize(value);
  if (normalized && !values.includes(normalized)) values.push(normalized);
}

function emptyProfilesFile(): MemberProfilesFile {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    profiles: {}
  };
}

export function isMemberRiskLevel(value: unknown): value is MemberRiskLevel {
  return typeof value === "string" && RISK_LEVELS.has(value as MemberRiskLevel);
}

export function deriveMemberKey(author: ObservationAuthor): string | undefined {
  const uid = normalizeKeyPart(author.uid);
  if (uid) return `uid:${uid}`;

  const ip = normalizeKeyPart(author.ip);
  const name = normalizeKeyPart(author.name);
  if (ip && name) return `ip-name:${ip}:${name}`;
  if (name) return `name:${name}`;
  return undefined;
}

function memberRefFromAuthor(
  role: ObservedMemberRef["role"],
  author: ObservationAuthor | undefined,
  postNo?: string,
  commentId?: string
): ObservedMemberRef | undefined {
  if (!author) return undefined;
  const key = deriveMemberKey(author);
  if (!key) return undefined;
  return { key, role, author, postNo, commentId };
}

export function memberRefsFromObservation(observation: ModerationObservation): ObservedMemberRef[] {
  const refs: ObservedMemberRef[] = [];
  const postAuthor = memberRefFromAuthor("post_author", observation.author, observation.postNo);
  if (postAuthor) refs.push(postAuthor);

  for (const comment of observation.comments) {
    const fallbackAuthor = comment.author ? { name: comment.author } : undefined;
    const commentRef = memberRefFromAuthor(
      "comment_author",
      comment.authorIdentity ?? fallbackAuthor,
      observation.postNo,
      comment.id
    );
    if (commentRef) refs.push(commentRef);
  }
  return refs;
}

export class MemberProfileStore {
  private readonly filePath: string;

  constructor(options: MemberProfileStoreOptions) {
    this.filePath = path.join(options.dataDir, "member-profiles.json");
  }

  async observeObservation(observation: ModerationObservation): Promise<ObserveMembersResult> {
    const refs = memberRefsFromObservation(observation);
    const file = await this.readProfiles();
    const timestamp = new Date().toISOString();

    for (const ref of refs) {
      const existing = file.profiles[ref.key];
      const profile = existing ?? {
        key: ref.key,
        riskLevel: "low" as MemberRiskLevel,
        aliases: [],
        uids: [],
        ips: [],
        rawAuthors: [],
        firstSeenAt: timestamp,
        lastSeenAt: timestamp,
        observationCount: 0,
        postCount: 0,
        commentCount: 0
      };

      profile.lastSeenAt = timestamp;
      profile.observationCount += 1;
      if (ref.role === "post_author") profile.postCount += 1;
      if (ref.role === "comment_author") profile.commentCount += 1;
      addUnique(profile.aliases, ref.author.name);
      addUnique(profile.uids, ref.author.uid);
      addUnique(profile.ips, ref.author.ip);
      addUnique(profile.rawAuthors, ref.author.raw);
      file.profiles[ref.key] = profile;
    }

    await this.writeProfiles(file);
    const seenKeys = [...new Set(refs.map((ref) => ref.key))];
    return {
      profiles: seenKeys.map((key) => file.profiles[key]).filter((profile): profile is MemberProfile => Boolean(profile)),
      refs
    };
  }

  async setRisk(options: SetRiskOptions): Promise<MemberProfile> {
    if (!isMemberRiskLevel(options.riskLevel)) {
      throw new Error(`Unsupported member risk level: ${options.riskLevel}`);
    }
    const file = await this.readProfiles();
    const existing = file.profiles[options.key];
    if (!existing) {
      throw new Error(`Member profile not found: ${options.key}`);
    }
    existing.riskLevel = options.riskLevel;
    existing.riskNote = normalize(options.note) || undefined;
    existing.lastSeenAt = new Date().toISOString();
    file.profiles[options.key] = existing;
    await this.writeProfiles(file);
    return existing;
  }

  private async readProfiles(): Promise<MemberProfilesFile> {
    try {
      return JSON.parse(await readFile(this.filePath, "utf8")) as MemberProfilesFile;
    } catch {
      return emptyProfilesFile();
    }
  }

  private async writeProfiles(file: MemberProfilesFile): Promise<void> {
    file.updatedAt = new Date().toISOString();
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(file, null, 2), "utf8");
  }
}
