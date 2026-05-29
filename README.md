# @vibecontrols/vibe-plugin-security-archive

Archive / offboard provider for the `archive.offboard` lifecycle stage in [VibeControls](https://vibecontrols.com). Registers under provider name `tombstone-retention` against provider type `security.archive`, wrapping a pure-JS tombstone writer (`tombstone-retention@1.0.0`). **Wave 2 scaffold — real tool integration pending (except archive which is fully implemented for tombstones).**

The host security meta plugin ([`@vibecontrols/vibe-plugin-security`](https://www.npmjs.com/package/@vibecontrols/vibe-plugin-security)) dispatches archive runs to this provider when the user picks "tombstone-retention" as their default for `archive.offboard`.

## Install

```bash
vibe plugin install @vibecontrols/vibe-plugin-security-archive
vibe security providers set-default --stage archive.offboard --provider tombstone-retention
```

No external binaries — pure JS.

## Behavior

At `run()` the provider:

1. Reads the agent's local `security.sqlite` (via `host.getDataDir()`) and walks the `security_scan_runs` table for the vibe. Counts past scan runs and reads the most recent `conclusion`. Falls back to zero counts when the sqlite file is unavailable.
2. Builds a tombstone summary object containing:
   - `vibeId`, `workspaceId`, `repoUrl`
   - `archivedAt` (ISO timestamp)
   - `scanRunCount`, `lastConclusion`
   - `retentionDays` (from `input.config`, default 90)
   - `producedBy`
3. Writes `tombstone.json` to `input.workdir`.
4. Surfaces the artifact in `evidence[]` so the host can upload it to long-term storage before clearing local rows.

## Configuration

Per-vibe config (stored in `RepositorySecurityConfig.pluginAssignments["archive.offboard"].config`):

```yaml
provider: tombstone-retention
config:
  retentionDays: 90 # default; how long downstream archives should keep the tombstone
```

## Evidence type note

The `SecurityEvidenceType` union in `@vibecontrols/vibe-plugin-security` does not yet have a `"tombstone-json"` member. As a placeholder, the tombstone artifact is emitted with `type: "opa-decision"`. When the meta plugin adds `"tombstone-json"`, this provider will switch over (see TODO in `src/provider.ts`).

<!-- VIBECONTROLS_OSS_FOOTER_START -->

---

## About VibeControls

**VibeControls** is the agentic engineering mission control for AI-native teams. Vibe-plugins extend the VibeControls agent with new providers, tools, sessions, tunnels, storage backends, and security stages.

- Website: <https://vibecontrols.com>
- Documentation: <https://docs.vibecontrols.com>
- Plugin SDK: <https://github.com/algoshred/vibecontrols-plugin-sdk>
- All plugins: <https://github.com/algoshred?q=vibe-plugin-&type=all>

## License

Released under the [MIT License](./LICENSE).

Copyright (c) 2026 Burdenoff Consultancy Services Private Limited, Algoshred Technologies Private Limited, and all its sister companies.

Maintainer: **Vignesh T.V** — <https://github.com/tvvignesh>

**Note**: this plugin is open source under MIT. The `@vibecontrols/agent` runtime that loads and orchestrates plugins is **closed source** and proprietary to Burdenoff Consultancy Services Pvt. Ltd. If you want a fully self-hostable agent, please open an issue or contact the maintainer.

<!-- VIBECONTROLS_OSS_FOOTER_END -->
