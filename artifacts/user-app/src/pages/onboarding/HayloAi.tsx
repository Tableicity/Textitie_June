import EngagementModeCard from "@/components/settings/EngagementModeCard";
import { SectionHeader } from "./components/SectionHeader";

export default function HayloAi() {
  return (
    <div>
      <SectionHeader
        title="Haylo Ai"
        subtitle="Set the default mode for new conversations across your workspace. Your agents can override it per contact from the inbox."
      />

      <div className="space-y-6">
        <EngagementModeCard />
      </div>
    </div>
  );
}
