import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import pkg from "../package.json" with { type: "json" };

/**
 * The MCP handshake version reached npm as a stale literal once (published
 * 1.2.1 self-reported 1.2.0), so clients could not tell which build they were
 * talking to. These guards pin the two ways that can recur: a hardcoded
 * literal creeping back into the source, and a stale `dist/` being published.
 */
describe("handshake version single-source", () => {
  const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");

  test("the Server constructor derives name/version from package.json", () => {
    expect(source).toContain("{ name: pkg.name, version: pkg.version }");
  });

  test("no hardcoded semver literal survives in the source", () => {
    // Strip comments so a version mentioned in prose cannot fail the guard.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/["']\d+\.\d+\.\d+["']/);
  });

  test("package.json declares a prepublishOnly build so dist cannot go stale", () => {
    expect(pkg.scripts.prepublishOnly).toBe("bun run build");
  });
});
