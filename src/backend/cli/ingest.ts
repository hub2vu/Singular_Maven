import "dotenv/config";
import { discoverPolicyPath } from "../policy/pathDiscovery.js";
import { ingestPolicyCorpus } from "../policy/ingest.js";

const cwd = process.cwd();
const sourceArg = process.argv[2];
const discovered = await discoverPolicyPath({ cwd, requestedPath: sourceArg ?? process.env.POLICY_JSON_PATH ?? process.env.POLICY_REPORT_PATH });
const corpus = await ingestPolicyCorpus({ sourcePath: discovered.path });

console.log(JSON.stringify({
  ok: true,
  source: discovered.path,
  reason: discovered.reason,
  posts: corpus.count,
  documents: corpus.documents.length
}, null, 2));
