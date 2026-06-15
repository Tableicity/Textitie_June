import IntegrationsSection from "@/components/settings/IntegrationsSection";
import { SectionHeader } from "./components/SectionHeader";

export default function Integrations() {
  return (
    <div>
      <SectionHeader
        title="Tools & Integrations"
        subtitle="Connect Textitie to the tools your team already uses."
      />
      <IntegrationsSection />
    </div>
  );
}
