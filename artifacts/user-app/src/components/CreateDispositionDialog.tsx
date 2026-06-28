import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateDisposition,
  getListDispositionsQueryKey,
  type Disposition,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { DISPOSITION_COLORS } from "@/lib/dispositions";

interface CreateDispositionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the created disposition after a successful create. */
  onCreated?: (disposition: Disposition) => void;
}

/**
 * Reusable "New disposition" create card. Used by the inbox Resolve dropdown's
 * inline "+ New disposition" option so agents can add an outcome tag without
 * leaving the conversation.
 */
export default function CreateDispositionDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateDispositionDialogProps) {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState("");
  const [color, setColor] = useState(DISPOSITION_COLORS[0]);

  const reset = () => {
    setLabel("");
    setColor(DISPOSITION_COLORS[0]);
  };

  const createMutation = useCreateDisposition({
    mutation: {
      onSuccess: (created) => {
        queryClient.invalidateQueries({ queryKey: getListDispositionsQueryKey() });
        onOpenChange(false);
        reset();
        onCreated?.(created);
      },
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New disposition</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!label.trim()) return;
            createMutation.mutate({ data: { label: label.trim(), color } });
          }}
          className="space-y-4 py-2"
        >
          <div>
            <Label className="mb-1.5 block">Label</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Resolved, Spam, Sales lead..."
              required
              maxLength={80}
              autoFocus
              data-testid="input-new-disposition-label"
            />
          </div>
          <div>
            <Label className="mb-1.5 block">Color</Label>
            <div className="flex gap-2 flex-wrap">
              {DISPOSITION_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-8 h-8 rounded-full border-2 transition ${
                    color === c ? "border-slate-900 scale-110" : "border-slate-200"
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                reset();
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-blue-600 hover:bg-blue-700"
              disabled={createMutation.isPending || !label.trim()}
              data-testid="button-create-new-disposition"
            >
              {createMutation.isPending && <Loader2 className="w-3 h-3 animate-spin mr-2" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
