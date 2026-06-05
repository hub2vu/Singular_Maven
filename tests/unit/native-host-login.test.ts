import { describe, expect, it } from "vitest";
import { openAIOAuthProxyLaunchSpec } from "../../scripts/native-host/oauth-proxy-command.mjs";

describe("native host OpenAI OAuth proxy launcher", () => {
  it("starts only the local openai-oauth proxy through node plus the package CLI on Windows", () => {
    const spec = openAIOAuthProxyLaunchSpec({
      platform: "win32",
      port: 10531,
      nodePath: "C:\\node\\node.exe",
      openaiOauthCliPath: "C:\\repo\\node_modules\\openai-oauth\\dist\\cli.js"
    });

    expect(spec.file).toBe("C:\\node\\node.exe");
    expect(spec.args).toEqual(["C:\\repo\\node_modules\\openai-oauth\\dist\\cli.js", "--port", "10531"]);
    expect(spec.args.join(" ")).not.toContain("npx");
    expect(spec.args.join(" ")).not.toContain(".cmd");
    expect(spec.args.join(" ")).not.toContain("@openai/codex");
    expect(spec.windowsHide).toBe(true);
    expect(spec.stdio).toBe("log-file");
  });

  it("keeps the user-facing proxy command stable", () => {
    const spec = openAIOAuthProxyLaunchSpec({ platform: "win32", port: 10531 });

    expect(spec.proxyCommand).toBe("npx -y openai-oauth --port 10531");
  });
});
