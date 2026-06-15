import { Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

// A consistent, honest banner for surfaces whose persistence depends on the
// Stripe billing integration (arriving at go-live). Used so the UI never
// pretends to save data it cannot yet persist.
export function GoLiveNotice({ children }: { children: React.ReactNode }) {
  return (
    <Alert className="border-amber-200 bg-amber-50">
      <Info className="h-4 w-4 text-amber-600" />
      <AlertDescription className="text-amber-800">{children}</AlertDescription>
    </Alert>
  );
}
