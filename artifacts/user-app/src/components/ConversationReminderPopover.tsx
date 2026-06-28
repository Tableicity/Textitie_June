import { useState, type ReactNode } from "react";
import { format } from "date-fns";
import { Clock, Pencil, Plus, Loader2, AlarmClockOff } from "lucide-react";
import {
  useListReminders,
  useCreateReminder,
  useUpdateReminder,
  useDismissReminder,
  getListRemindersQueryKey,
  type Reminder,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import ReminderRemoveButton from "@/components/ReminderRemoveButton";
import {
  ALL_REMINDERS_PARAMS,
  REMINDER_PRESETS,
  invalidateReminders,
  isReminderDue,
  toLocalDatetimeInput,
} from "@/lib/reminders";

/**
 * Reminder management card scoped to a single conversation. Lists that
 * conversation's active reminders and lets the agent create, edit, snooze, and
 * dismiss them. Shared by the composer toolbar icon and the left-pane row bell.
 */
export default function ConversationReminderPopover({
  conversationId,
  children,
  side = "bottom",
  align = "end",
  showRemove = true,
}: {
  conversationId: number;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  /**
   * Whether to show the per-row remove (✕) control. Off in the composer card,
   * where a stray ✕ reads like a "close panel" button and causes friction —
   * the agent dismisses from the left-pane bell or header hub instead.
   */
  showRemove?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  // Only this observer fetches while the card is open; when closed it still
  // reads the shared status=all cache the inbox/header keep warm, so opening is
  // instant without spinning up an extra polling observer per row.
  const { data: allReminders } = useListReminders(ALL_REMINDERS_PARAMS, {
    query: {
      queryKey: getListRemindersQueryKey(ALL_REMINDERS_PARAMS),
      refetchInterval: 30000,
      enabled: open,
    },
  });

  const reminders = (allReminders ?? [])
    .filter((r) => r.conversationId === conversationId)
    .sort((a, b) => new Date(a.remindAt).getTime() - new Date(b.remindAt).getTime());

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [remindAt, setRemindAt] = useState("");
  const [note, setNote] = useState("");

  function resetForm() {
    setShowForm(false);
    setEditingId(null);
    setRemindAt("");
    setNote("");
  }

  function openCreate() {
    setEditingId(null);
    setRemindAt("");
    setNote("");
    setShowForm(true);
  }

  function openEdit(r: Reminder) {
    setEditingId(r.id);
    setRemindAt(toLocalDatetimeInput(new Date(r.remindAt)));
    setNote(r.note ?? "");
    setShowForm(true);
  }

  const onMutated = () => invalidateReminders(queryClient);

  const createMut = useCreateReminder({
    mutation: {
      onSuccess: () => {
        onMutated();
        resetForm();
      },
    },
  });
  const updateMut = useUpdateReminder({
    mutation: {
      onSuccess: () => {
        onMutated();
        resetForm();
      },
    },
  });
  const dismissMut = useDismissReminder({ mutation: { onSuccess: onMutated } });

  const saving = createMut.isPending || updateMut.isPending;

  function save() {
    if (!remindAt) return;
    const iso = new Date(remindAt).toISOString();
    const noteValue = note.trim() ? note.trim() : null;
    if (editingId != null) {
      updateMut.mutate({ id: editingId, data: { remindAt: iso, note: noteValue } });
    } else {
      createMut.mutate({ data: { conversationId, remindAt: iso, note: noteValue } });
    }
  }

  // Snooze a fired/overdue reminder forward by an hour and re-arm it.
  function snooze(r: Reminder) {
    const when = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    updateMut.mutate({ id: r.id, data: { remindAt: when } });
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      // Jump straight to the form when there's nothing to manage yet.
      if (reminders.length === 0) openCreate();
      else resetForm();
    } else {
      resetForm();
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        className="w-80 p-0"
        data-testid="popover-conversation-reminders"
      >
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-900">Reminders</div>
            <div className="text-xs text-slate-500 mt-0.5">
              {reminders.length === 0
                ? "None for this conversation"
                : `${reminders.length} on this conversation`}
            </div>
          </div>
          {!showForm && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1"
              onClick={openCreate}
              data-testid="button-add-reminder"
            >
              <Plus className="w-3 h-3" />
              Add
            </Button>
          )}
        </div>

        {showForm ? (
          <div className="p-4 space-y-3">
            <div>
              <Label className="mb-1.5 block text-xs">Remind me at</Label>
              <Input
                type="datetime-local"
                value={remindAt}
                onChange={(e) => setRemindAt(e.target.value)}
                data-testid="input-remind-at"
              />
              <div className="flex flex-wrap gap-1.5 mt-2">
                {REMINDER_PRESETS.map((p) => (
                  <Button
                    key={p.label}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setRemindAt(toLocalDatetimeInput(p.build()))}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            </div>
            <div>
              <Label className="mb-1.5 block text-xs">Note (optional)</Label>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Follow up about pricing..."
                rows={2}
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={resetForm} disabled={saving}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="bg-blue-600 hover:bg-blue-700"
                disabled={saving || !remindAt}
                onClick={save}
                data-testid="button-save-reminder"
              >
                {saving && <Loader2 className="w-3 h-3 animate-spin mr-1.5" />}
                {editingId != null ? "Save" : "Set reminder"}
              </Button>
            </div>
          </div>
        ) : (
          <ScrollArea className="max-h-80">
            {reminders.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-slate-400">
                No reminders on this conversation yet.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {reminders.map((r) => {
                  const due = isReminderDue(r);
                  return (
                    <div key={r.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <Clock
                              className={`w-3 h-3 shrink-0 ${
                                due ? "text-red-500" : "text-slate-400"
                              }`}
                            />
                            <span
                              className={`text-[10px] font-semibold uppercase tracking-wide ${
                                due ? "text-red-600" : "text-slate-500"
                              }`}
                            >
                              {due ? "Due" : "Scheduled"}
                            </span>
                          </div>
                          <div className="text-xs text-slate-700 mt-1">
                            {format(new Date(r.remindAt), "MMM d, h:mm a")}
                          </div>
                          {r.note && (
                            <div className="text-xs text-slate-500 mt-0.5 break-words">
                              {r.note}
                            </div>
                          )}
                          <div className="flex gap-1.5 mt-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 text-[11px] px-2 gap-1"
                              onClick={() => openEdit(r)}
                            >
                              <Pencil className="w-2.5 h-2.5" />
                              Edit
                            </Button>
                            {due && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-6 text-[11px] px-2 gap-1"
                                onClick={() => snooze(r)}
                                disabled={updateMut.isPending}
                              >
                                <AlarmClockOff className="w-2.5 h-2.5" />
                                Snooze 1h
                              </Button>
                            )}
                          </div>
                        </div>
                        {showRemove && (
                          <ReminderRemoveButton
                            due={due}
                            pending={dismissMut.isPending}
                            onRemove={() => dismissMut.mutate({ id: r.id })}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
}
