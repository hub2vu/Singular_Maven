import { access, readdir } from "node:fs/promises";
import path from "node:path";

export interface DiscoverPolicyPathOptions {
  cwd: string;
  requestedPath?: string;
}

export interface DiscoveredPolicyPath {
  path: string;
  kind: "json" | "markdown";
  reason: string;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function extractDate(filePath: string): string | undefined {
  return filePath.match(/\d{4}-\d{2}-\d{2}/u)?.[0];
}

function isGeneratedPolicyIndex(filePath: string): boolean {
  return path.basename(filePath).toLowerCase() === "policy-index.json";
}

async function findJsonCorpus(dir: string, dateHint?: string): Promise<string | undefined> {
  const entries = await readdir(dir);
  const candidates = entries
    .filter((name) => /^dcinside_manager_posts_.*\.json$/u.test(name))
    .filter((name) => !/비밀번호|password|credential|secret/iu.test(name))
    .map((name) => path.join(dir, name));

  if (dateHint) {
    const exact = candidates.find((candidate) => candidate.includes(dateHint));
    if (exact) return exact;
  }
  return candidates.sort().at(-1);
}

export async function discoverPolicyPath(options: DiscoverPolicyPathOptions): Promise<DiscoveredPolicyPath> {
  const requested = options.requestedPath ? path.resolve(options.requestedPath) : undefined;
  const cwd = path.resolve(options.cwd);

  if (requested && !isGeneratedPolicyIndex(requested) && /\.json$/iu.test(requested) && (await exists(requested))) {
    return { path: requested, kind: "json", reason: "requested JSON corpus exists" };
  }

  if (requested && /\.md$/iu.test(requested) && (await exists(requested))) {
    const sibling = await findJsonCorpus(path.dirname(requested), extractDate(requested));
    if (sibling) {
      return { path: sibling, kind: "json", reason: "structured sibling JSON preferred over report markdown" };
    }
    return { path: requested, kind: "markdown", reason: "only markdown report found" };
  }

  const envPath = process.env.POLICY_JSON_PATH ? path.resolve(process.env.POLICY_JSON_PATH) : undefined;
  if (envPath && !isGeneratedPolicyIndex(envPath) && /\.json$/iu.test(envPath) && (await exists(envPath))) {
    return { path: envPath, kind: "json", reason: "POLICY_JSON_PATH" };
  }

  const discovered = await findJsonCorpus(cwd);
  if (discovered) {
    return { path: discovered, kind: "json", reason: "discovered repository JSON corpus" };
  }

  throw new Error(`No dcinside_manager_posts_*.json corpus found under ${cwd}`);
}
