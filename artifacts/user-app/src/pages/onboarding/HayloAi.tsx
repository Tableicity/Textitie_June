import EngagementModeCard from "@/components/settings/EngagementModeCard";
import { SectionHeader } from "./components/SectionHeader";

export default function HayloAi() {
  return (
    <div>
      <SectionHeader
        title="Haylo Ai"
        subtitle="Choose how Haylo AI engages on inbound texts across your workspace. You can override this per conversation from the inbox."
      />

      <div className="space-y-6">
        <EngagementModeCard />
      </div>
    </div>
  );
}
