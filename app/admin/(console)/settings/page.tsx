import { ConfigPanel } from "@/components/admin/config-panel";
import { PrelaunchSettingsPanel } from "@/components/admin/prelaunch-settings-panel";
import { SiteModePanel } from "@/components/admin/site-mode-panel";
import { OwnerWalletsPanel } from "@/components/admin/owner-wallets-panel";

/**
 * `/admin/settings` is launch control first, then server-side product behaviour.
 *
 * Website mode and prelaunch content live here; the raw `app_config` fields stay
 * available underneath so nothing that already existed was removed.
 */
export default function AdminSettingsPage() {
  return (
    <div>
      <SiteModePanel />
      <OwnerWalletsPanel />
      <PrelaunchSettingsPanel />
      <div className="mt-12 border-t border-[var(--cabi-hairline)] pt-10">
        <ConfigPanel
          configKey="app_config"
          eyebrow="Operations"
          title="App settings"
          description="Control server-side product behaviour without exposing secrets to the browser."
          fields={[
            { key: "knowledgeSource", label: "Knowledge source", kind: "url" },
            { key: "memoryExtraction", label: "Explicit memory extraction", kind: "boolean" },
            { key: "summaries", label: "Conversation summaries", kind: "boolean" },
            { key: "adminConversationAccess", label: "Allow audited admin conversation access", kind: "boolean" },
          ]}
        />
      </div>
    </div>
  );
}
