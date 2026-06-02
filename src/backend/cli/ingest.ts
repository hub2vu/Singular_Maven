import "dotenv/config";
import path from "node:path";
import { discoverPolicyPath } from "../policy/pathDiscovery.js";
import { ingestPolicyCorpus } from "../policy/ingest.js";

const cwd = process.cwd();
const sourceArg = process.argv[2];
const dataDir = process.env.DATA_DIR ?? path.join(cwd, "data");
const discovered = await discoverPolicyPath({ cwd, requestedPath: sourceArg ?? process.env.POLICY_JSON_PATH ?? process.env.POLICY_REPORT_PATH });
const corpus = await ingestPolicyCorpus({ sourcePath: discovered.path, outDir: dataDir });

console.log(JSON.stringify({
  ok: true,
  source: discovered.path,
  reason: discovered.reason,
  posts: corpus.count,
  documents: corpus.documents.length,
  indexPath: path.join(dataDir, "policy-index.json")
}, null, 2));
