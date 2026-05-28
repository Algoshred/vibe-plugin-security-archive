/**
 * @vibecontrols/vibe-plugin-security-archive
 *
 * Archive / offboard provider. Registers as a `security.archive`
 * provider with @vibecontrols/vibe-plugin-security on the host's
 * ServiceRegistry. The user picks "tombstone-retention" as their
 * default provider for the `archive.offboard` stage and the meta
 * plugin dispatches.
 *
 * Pure JS — no external binaries. Writes a tombstone.json artifact
 * summarising final scan state for the vibe at the moment of archival
 * and surfaces that artifact as evidence.
 */
import { ProviderRegistry, TelemetryEmitter, createLifecycleHooks } from "@vibecontrols/plugin-sdk";
import type {
  HostServices,
  ProfileContext,
  VibePlugin,
  VibePluginFactory,
} from "@vibecontrols/plugin-sdk/contract";

import { TombstoneRetentionProvider } from "./provider.js";

const PLUGIN_NAME = "security-archive";
const PLUGIN_VERSION = "2026.528.1";

export const createPlugin: VibePluginFactory = (_ctx: ProfileContext): VibePlugin => {
  const provider = new TombstoneRetentionProvider();
  const telemetry = new TelemetryEmitter(PLUGIN_NAME, PLUGIN_VERSION);

  const lifecycle = createLifecycleHooks({
    name: PLUGIN_NAME,
    telemetryEventName: "security.archive.ready",
    onInit: async (host: HostServices) => {
      await provider.init(host);
      const registry = new ProviderRegistry(host);
      registry.registerProvider("security.archive", "tombstone-retention", provider);
      telemetry.emit("security.archive.registered", {
        provider: "tombstone-retention",
        toolVersion: provider.toolVersion,
      });
    },
  });

  return {
    name: PLUGIN_NAME,
    version: PLUGIN_VERSION,
    description:
      "Archive / offboard provider for the archive.offboard lifecycle stage — writes a tombstone.json summarising final scan state.",
    tags: ["backend", "provider", "integration"],
    capabilities: {
      storage: "rw",
      audit: true,
      telemetry: true,
    },
    onServerStart: lifecycle.onServerStart,
    onServerStop: lifecycle.onServerStop,
  };
};

export default createPlugin;
export { TombstoneRetentionProvider } from "./provider.js";
