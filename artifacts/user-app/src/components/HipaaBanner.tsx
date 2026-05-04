import { useQuery } from "@tanstack/react-query";
import { Shield } from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";
import { getTenantToken } from "@/lib/auth";

interface TenantSettings {
  hipaaEnabled: boolean;
  baaAcknowledgedAt: string | null;
}

export default function HipaaBanner() {
  const hasToken = !!getTenantToken();
  const { data } = useQuery<TenantSettings | null>({
    queryKey: ["tenant-settings/me"],
    queryFn: () => apiFetch<TenantSettings>("/tenant-settings/me"),
    enabled: hasToken,
    retry: false,
    staleTime: 60_000,
  });

  if (!data?.hipaaEnabled) return null;

  return (
    <div
      className="flex items-center gap-2 px-4 py-1.5 bg-emerald-50 border-b border-emerald-200 text-emerald-800 text-xs font-medium"
      data-testid="hipaa-banner"
    >
      <Shield className="w-3.5 h-3.5" />
      HIPAA Mode active — PHI redaction enabled in logs. BAA acknowledged
      {data.baaAcknowledgedAt
        ? ` on ${new Date(data.baaAcknowledgedAt).toLocaleDateString()}`
        : ""}
      .
    </div>
  );
}
