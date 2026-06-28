import { useState } from "react";
import { Bell, Pencil, AlarmClockOff, Loader2 } from "lucide-react";
import { format, isToday } from "date-fns";
import {
  useListReminders,
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

type Variant = "sidebar" | "header";

export default function ReminderBell({
  onJumpToConversation,
  variant = "sidebar",
}: {
  onJumpToConversation?: (conversationId: number) => void;
  variant?: Variant;
}) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: allReminders } = useListReminders(ALL_REMINDERS_PARAMS, {
    query: {
      queryKey: getListRemindersQueryKey(ALL_REMINDERS_PARAMS),
      refetchInterval: 30000,
    },
  });

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editRemindAt, setEditRemindAt] = useState("");
  const [editNote, setEditNote] = useState("");

  function startEdit(r: Reminder) {
    setEditingId(r.id);
    setEditRemindAt(toLocalDatetimeInput(new Date(r.remindAt)));
    setEditNote(r.note ?? "");
  }
  function cancelEdit() {
    setEditingId(null);
    setEditRemindAt("");
    setEditNote("");
  }

  const onMutated = () => invalidateReminders(queryClient);
  const updateMut = useUpdateReminder({
    mutation: {
      onSuccess: () => {
        onMutated();
        cancelEdit();
      },
    },
  });
  const dismissMut = useDismissReminder({ mutation: { onSuccess: onMutated } });

  function saveEdit() {
    if (editingId == null || !editRemindAt) return;
    updateMut.mutate({
      id: editingId,
      data: {
        remindAt: new Date(editRemindAt).toISOString(),
        note: editNote.trim() ? editNote.trim() : null,
      },
    });
  }
  function snooze(r: Reminder) {
    updateMut.mutate({
      id: r.id,
      data: { remindAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
    });
  }

  // Group all active reminders into Overdue / Due today / Upcoming.
  const now = Date.now();
  const sorted = [...(allReminders ?? [])].sort(
    (a, b) => new Date(a.remindAt).getTime() - new Date(b.remindAt).getTime(),
  );
  const overdue: Reminder[] = [];
  const dueToday: Reminder[] = [];
  const upcoming: Reminder[] = [];
  for (const r of sorted) {
    if (isReminderDue(r, now)) overdue.push(r);
    else if (isToday(new Date(r.remindAt))) dueToday.push(r);
    else upcoming.push(r);
  }
  const total = sorted.length;
  const count = overdue.length;

  const triggerClass =
    variant === "header"
      ? "relative h-8 px-2.5 inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 text-xs font-medium transition-colors"
      : "relative w-10 h-10 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 transition-colors";

  const popoverSide = variant === "header" ? "bottom" : "right";
  const popoverAlign = variant === "header" ? "end" : "start";
  const iconClass = variant === "header" ? "w-3.5 h-3.5" : "w-5 h-5";
  const badgeClass =
    variant === "header"
      ? "absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center"
      : "absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center";

  function renderRow(r: Reminder, tone: "overdue" | "today" | "upcoming") {
    if (editingId === r.id) {
      return (
        <div key={r.id} className="px-4 py-3 bg-slate-50">
          <Label className="mb-1.5 block text-xs">Reschedule</Label>
          <Input
            type="datetime-local"
            value={editRemindAt}
            onChange={(e) => setEditRemindAt(e.target.value)}
            data-testid="input-edit-remind-at"
          />
          <div className="flex flex-wrap gap-1.5 mt-2">
            {REMINDER_PRESETS.map((p) => (
              <Button
                key={p.label}
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setEditRemindAt(toLocalDatetimeInput(p.build()))}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <Textarea
            value={editNote}
            onChange={(e) => setEditNote(e.target.value)}
            placeholder="Note (optional)"
            rows={2}
            className="mt-2"
          />
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="ghost" size="sm" onClick={cancelEdit} disabled={updateMut.isPending}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-blue-600 hover:bg-blue-700"
              disabled={updateMut.isPending || !editRemindAt}
              onClick={saveEdit}
              data-testid="button-save-edit-reminder"
            >
              {updateMut.isPending && <Loader2 className="w-3 h-3 animate-spin mr-1.5" />}
              Save
            </Button>
          </div>
        </div>
      );
    }
    const timeColor =
      tone === "overdue"
        ? "text-red-500"
        : tone === "today"
          ? "text-amber-600"
          : "text-slate-400";
    return (
      <div key={r.id} className="px-4 py-3 hover:bg-slate-50">
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            className="flex-1 text-left min-w-0"
            onClick={() => {
              if (onJumpToConversation) onJumpToConversation(r.conversationId);
              setOpen(false);
            }}
          >
            <div className="text-xs font-semibold text-slate-900 truncate">
              {r.contactName || r.contactPhone || `Conversation #${r.conversationId}`}
            </div>
            {r.note && (
              <div className="text-xs text-slate-600 mt-0.5 break-words">{r.note}</div>
            )}
            <div className={`text-[10px] mt-1 ${timeColor}`}>
              {format(new Date(r.remindAt), "MMM d, h:mm a")}
            </div>
          </button>
          <ReminderRemoveButton
            due={tone === "overdue"}
            pending={dismissMut.isPending}
            onRemove={() => dismissMut.mutate({ id: r.id })}
          />
        </div>
        <div className="flex gap-1.5 mt-2">
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-[11px] px-2 gap-1"
            onClick={() => startEdit(r)}
          >
            <Pencil className="w-2.5 h-2.5" />
            Edit
          </Button>
          {tone === "overdue" && (
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
    );
  }

  function renderGroup(
    label: string,
    items: Reminder[],
    tone: "overdue" | "today" | "upcoming",
    labelColor: string,
  ) {
    if (items.length === 0) return null;
    return (
      <div>
        <div
          className={`px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wide bg-slate-50 border-b border-slate-100 ${labelColor}`}
        >
          {label} · {items.length}
        </div>
        <div className="divide-y divide-slate-100">
          {items.map((r) => renderRow(r, tone))}
        </div>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={triggerClass}
          title="Reminders"
          data-testid="button-reminder-bell"
        >
          <Bell className={iconClass} />
          {variant === "header" && <span>Reminders</span>}
          {count > 0 && (
            <span className={badgeClass}>{count > 9 ? "9+" : count}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={popoverSide}
        align={popoverAlign}
        className="w-80 p-0"
        data-testid="popover-reminders"
      >
        <div className="px-4 py-3 border-b border-slate-200">
          <div className="text-sm font-semibold text-slate-900">Reminders</div>
          <div className="text-xs text-slate-500 mt-0.5">
            {total === 0
              ? "Nothing scheduled"
              : count > 0
                ? `${count} due now · ${total} total`
                : `${total} scheduled`}
          </div>
        </div>
        <ScrollArea className="max-h-96">
          {total === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-slate-400">
              You're all caught up.
            </div>
          ) : (
            <div>
              {renderGroup("Overdue", overdue, "overdue", "text-red-600")}
              {renderGroup("Due today", dueToday, "today", "text-amber-600")}
              {renderGroup("Upcoming", upcoming, "upcoming", "text-slate-500")}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
