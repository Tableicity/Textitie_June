import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Removal control for a single reminder row.
 *
 * A fired/overdue reminder is an active alert, so clearing it one-click (the
 * natural meaning of the corner ✕) is expected. A still-scheduled reminder is a
 * persistent cue the agent set on purpose — and with a single reminder the ✕
 * sits in the top-right of the popover, exactly where a "close this panel" ✕
 * would be. Guard that case behind an inline confirm so a stray "close" click
 * can never silently delete a future reminder (and make its grey bell vanish).
 */
export default function ReminderRemoveButton({
  due,
  pending,
  onRemove,
}: {
  due: boolean;
  pending: boolean;
  onRemove: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  if (confirming && !due) {
    return (
      <div className="flex items-center gap-1 shrink-0">
        <Button
          size="sm"
          className="h-6 text-[11px] px-2 bg-red-600 hover:bg-red-700"
          onClick={() => {
            onRemove();
            setConfirming(false);
          }}
          disabled={pending}
          data-testid="button-confirm-remove-reminder"
        >
          Remove
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-[11px] px-2"
          onClick={() => setConfirming(false)}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6 text-slate-400 hover:text-slate-700 shrink-0"
      title={due ? "Dismiss" : "Remove reminder"}
      onClick={() => (due ? onRemove() : setConfirming(true))}
      disabled={pending}
      data-testid="button-remove-reminder"
    >
      <X className="w-3 h-3" />
    </Button>
  );
}
