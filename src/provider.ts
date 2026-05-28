/**
 * TombstoneRetentionProvider — implements SecurityProvider for stage
 * `archive.offboard`.
 *
 * Pure JS / no subprocess. At run() the provider:
 *   1. Opens the agent's local security.sqlite (if `host.getDataDir()`
 *      is available) and walks the `security_scan_runs` table for the
 *      vibe to count past scan runs and read the most recent
 *      `conclusion`.
 *   2. Builds a tombstone summary object (vibeId, archivedAt,
 *      scanRunCount, lastConclusion, retentionDays).
 *   3. Writes that summary as `tombstone.json` to `input.workdir`.
 *   4. Surfaces the artifact in `evidence[]`.
 *
 * The agent host clears the local sqlite rows for the vibe after the
 * archive runs (handled by the host, not by this provider).
 *
 * NOTE: the SecurityEvidenceType union in @vibecontrols/vibe-plugin-security
 * does not yet have a "tombstone-json" member, so this provider uses
 * "opa-decision" as a placeholder. TODO: add "tombstone-json" to the
 * SecurityEvidenceType union in the meta plugin and switch this over.
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { fingerprint } from "@vibecontrols/vibe-plugin-security/fingerprint";
import type { HostServices } from "@vibecontrols/plugin-sdk/contract";
import type {
  NormalizedFinding,
  ScanEvidenceArtifact,
  SecurityProvider,
  SecurityProviderMetadata,
  SecurityScanInput,
  SecurityScanResult,
  SecurityScanSummary,
  SecurityStage,
} from "@vibecontrols/vibe-plugin-security/types";

const TOOL_VERSION = "tombstone-retention@1.0.0";

interface ArchiveConfig {
  retentionDays?: number;
}

interface TombstoneRecord {
  vibeId: string;
  workspaceId: string;
  repoUrl: string;
  archivedAt: string;
  scanRunCount: number;
  lastConclusion?: string;
  retentionDays: number;
  producedBy: string;
}

export class TombstoneRetentionProvider implements SecurityProvider {
  readonly name = "tombstone-retention";
  readonly stage: SecurityStage = "archive.offboard";
  readonly toolVersion = TOOL_VERSION;

  private host?: HostServices;

  async init(host: HostServices): Promise<void> {
    this.host = host;
  }

  async ensureToolInstalled(): Promise<void> {
    // Pure-JS provider — no external binary.
  }

  async run(input: SecurityScanInput): Promise<SecurityScanResult> {
    const startedAt = Date.now();
    const cfg = (input.config as ArchiveConfig) ?? {};
    const retentionDays = typeof cfg.retentionDays === "number" ? cfg.retentionDays : 90;

    input.onProgress?.({ pct: 10, message: "Reading local scan history" });

    const stats = await this.readScanHistory(input.vibeId);

    input.onProgress?.({ pct: 60, message: "Writing tombstone.json" });

    const tombstone: TombstoneRecord = {
      vibeId: input.vibeId,
      workspaceId: input.workspaceId,
      repoUrl: input.repoUrl,
      archivedAt: new Date().toISOString(),
      scanRunCount: stats.scanRunCount,
      lastConclusion: stats.lastConclusion,
      retentionDays,
      producedBy: this.name,
    };

    const tombstonePath = path.join(input.workdir, "tombstone.json");
    const tombstoneJson = JSON.stringify(tombstone, null, 2);
    await fs.mkdir(input.workdir, { recursive: true });
    await fs.writeFile(tombstonePath, tombstoneJson, "utf-8");
    const sha256 = createHash("sha256").update(tombstoneJson).digest("hex");
    const stat = await fs.stat(tombstonePath);

    const evidence: ScanEvidenceArtifact[] = [
      {
        // TODO: switch to "tombstone-json" once SecurityEvidenceType in
        // @vibecontrols/vibe-plugin-security gains that member. Using
        // "opa-decision" as a placeholder here — the artifact is JSON.
        type: "opa-decision",
        localPath: tombstonePath,
        sha256,
        sizeBytes: stat.size,
      },
    ];

    const finding: NormalizedFinding = {
      fingerprint: fingerprint({
        providerName: this.name,
        ruleId: "archive.tombstone",
        file: tombstonePath,
      }),
      ruleId: "archive.tombstone",
      title: `Vibe archived — tombstone written (${stats.scanRunCount} historical scan run(s))`,
      description:
        `Vibe ${input.vibeId} archived at ${tombstone.archivedAt}. ` +
        `Last conclusion: ${stats.lastConclusion ?? "n/a"}. ` +
        `Retention policy: ${retentionDays} day(s). Tombstone artifact persisted at ${tombstonePath}.`,
      severity: "info",
      category: "policy",
      rawProviderRef: "tombstone",
    };

    input.onProgress?.({ pct: 100, message: "Archive complete" });

    return {
      runId: input.runId,
      status: "succeeded",
      findings: [finding],
      evidence,
      durationMs: Date.now() - startedAt,
      summary: summarize([finding]),
    };
  }

  async cancel(_runId: string): Promise<void> {
    // No subprocess — nothing to cancel.
  }

  metadata(): SecurityProviderMetadata {
    return {
      stage: this.stage,
      supportedProfiles: [
        "backend",
        "frontend",
        "cli",
        "sdk",
        "mcp",
        "chrome-extension",
        "vscode-extension",
        "container",
        "iac",
      ],
      toolVersion: this.toolVersion,
      description:
        "Archive / offboard provider — emits a tombstone.json summary for archived vibes.",
    };
  }

  /**
   * Open the agent's local security.sqlite and walk
   * `security_scan_runs` for this vibe. Returns zero counts when the
   * sqlite file is unavailable (e.g. fresh agent, no scans yet).
   *
   * Defensive: the meta plugin owns the schema; if the table shape
   * changes this falls back to defaults rather than crashing the
   * archive run.
   */
  private async readScanHistory(
    vibeId: string,
  ): Promise<{ scanRunCount: number; lastConclusion?: string }> {
    const dataDir = this.host?.getDataDir?.();
    if (!dataDir) return { scanRunCount: 0 };

    const dbPath = path.join(dataDir, "security", "security.sqlite");
    try {
      await fs.access(dbPath);
    } catch {
      return { scanRunCount: 0 };
    }

    try {
      // Lazy import so the provider remains importable in environments
      // without bun:sqlite (e.g. tooling that statically loads the
      // plugin module for metadata inspection).
      const { Database } = await import("bun:sqlite");
      const db = new Database(dbPath, { readonly: true });
      try {
        const countRow = db
          .prepare("SELECT COUNT(*) AS c FROM security_scan_runs WHERE vibe_id = $vibe_id")
          .get({ $vibe_id: vibeId }) as { c?: number } | undefined;
        const lastRow = db
          .prepare(
            "SELECT conclusion FROM security_scan_runs WHERE vibe_id = $vibe_id ORDER BY started_at DESC LIMIT 1",
          )
          .get({ $vibe_id: vibeId }) as { conclusion?: string } | undefined;
        return {
          scanRunCount: countRow?.c ?? 0,
          lastConclusion: lastRow?.conclusion ?? undefined,
        };
      } finally {
        db.close();
      }
    } catch (err) {
      this.host?.logger?.warn?.(
        "security-archive-provider",
        `scan history read failed; defaulting to zero counts: ${String(err)}`,
      );
      return { scanRunCount: 0 };
    }
  }
}

function summarize(findings: NormalizedFinding[]): SecurityScanSummary {
  const s: SecurityScanSummary = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) s[f.severity]++;
  return s;
}
