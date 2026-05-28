import { describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { TombstoneRetentionProvider } from "../src/provider.js";
import type { SecurityScanInput } from "@vibecontrols/vibe-plugin-security/types";

function buildInput(
  overrides: Partial<SecurityScanInput> & Pick<SecurityScanInput, "workdir">,
): SecurityScanInput {
  return {
    runId: "run-test",
    vibeId: "vibe-test",
    workspaceId: "ws-test",
    repoUrl: "https://example.com/repo.git",
    repoLocalPath: "/tmp/repo",
    commit: "deadbeef",
    stage: "archive.offboard",
    profile: { kind: "backend", languages: ["typescript"], runtimes: ["bun"] },
    policyLevel: "advisory",
    config: {},
    workdir: overrides.workdir,
    ...overrides,
  };
}

describe("TombstoneRetentionProvider", () => {
  test("name + stage are immutable identifiers", () => {
    const p = new TombstoneRetentionProvider();
    expect(p.name).toBe("tombstone-retention");
    expect(p.stage).toBe("archive.offboard");
    expect(p.toolVersion).toBe("tombstone-retention@1.0.0");
  });

  test("metadata reports the offboard stage + base profiles", () => {
    const p = new TombstoneRetentionProvider();
    const m = p.metadata();
    expect(m.stage).toBe("archive.offboard");
    expect(m.supportedProfiles).toContain("backend");
    expect(m.supportedProfiles).toContain("container");
    expect(m.supportedProfiles).toContain("iac");
  });

  test("run() writes a tombstone.json to workdir and references it in evidence[]", async () => {
    const p = new TombstoneRetentionProvider();
    const workdir = await fs.mkdtemp(path.join(os.tmpdir(), "tombstone-test-"));
    try {
      const result = await p.run(
        buildInput({
          workdir,
          config: { retentionDays: 30 },
        }),
      );

      expect(result.status).toBe("succeeded");
      expect(result.evidence).toHaveLength(1);
      const tombstonePath = path.join(workdir, "tombstone.json");
      expect(result.evidence[0]?.localPath).toBe(tombstonePath);
      // Placeholder type until SecurityEvidenceType gains "tombstone-json".
      expect(result.evidence[0]?.type).toBe("opa-decision");

      const written = JSON.parse(await fs.readFile(tombstonePath, "utf-8"));
      expect(written.vibeId).toBe("vibe-test");
      expect(written.retentionDays).toBe(30);
      expect(written.producedBy).toBe("tombstone-retention");
      expect(typeof written.archivedAt).toBe("string");
      expect(typeof written.scanRunCount).toBe("number");
    } finally {
      await fs.rm(workdir, { recursive: true, force: true });
    }
  });

  test("cancel() on unknown run is a no-op", async () => {
    const p = new TombstoneRetentionProvider();
    await expect(p.cancel("nope")).resolves.toBeUndefined();
  });
});
