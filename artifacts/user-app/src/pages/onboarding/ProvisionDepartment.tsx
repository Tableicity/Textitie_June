import { DepartmentsSection } from "@/components/settings/DepartmentsSection";
import { RequirePaidTier } from "@/components/PaidTierGate";
import { SectionHeader } from "./components/SectionHeader";

export default function ProvisionDepartment() {
  return (
    <div>
      <SectionHeader
        title="Provision Department"
        subtitle="Create the departments your customers reach, assign each a number, and choose how inbound conversations route to your agents."
      />
      <RequirePaidTier>
        <DepartmentsSection />
      </RequirePaidTier>
    </div>
  );
}
