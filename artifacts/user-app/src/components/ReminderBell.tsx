import { useState } from "react";
import { Bell, X } from "lucide-react";
import { format } from "date-fns";
import {
  useListReminders,
  useDismissReminder,
  getListRemindersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

export default function ReminderBell({
  onJumpToConversation,
}: {
  onJumpToConversation?: (conversationId: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const dueParams = { status: "due" as const };
  const { data: dueReminders } = useListReminders(dueParams, {
    query: {
      queryKey: getListRemindersQueryKey(dueParams),
      refetchInterval: 30000,
    },
  });

  const dismissMutation = useDismissReminder({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListRemindersQueryKey(dueParams) });
      },
    },
  });

  const count = dueReminders?.length ?? 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative w-10 h-10 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          title="Reminders"
          data-testid="button-reminder-bell"
        >
          <Bell className="w-5 h-5" />
          {count > 0 && (
            <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
              {count > 9 ? "9+" : count}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-80 p-0" data-testid="popover-reminders">
        <div className="px-4 py-3 border-b border-slate-200">
          <div className="text-sm font-semibold text-slate-900">Due reminders</div>
          <div className="text-xs text-slate-500 mt-0.5">
            {count === 0 ? "Nothing due right now" : `${count} reminder${count === 1 ? "" : "s"} waiting`}
          </div>
        </div>
        <ScrollArea className="max-h-80">
          {count === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-slate-400">
              You're all caught up.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {dueReminders?.map((r) => (
                <div key={r.id} className="px-4 py-3 hover:bg-slate-50">
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      className="flex-1 text-left"
                      onClick={() => {
                        if (onJumpToConversation) onJumpToConversation(r.conversationId);
                        setOpen(false);
                      }}
                    >
                      <div className="text-xs font-semibold text-slate-900">
                        {r.contactName || r.contactPhone || `Conversation #${r.conversationId}`}
                      </div>
                      {r.note && (
                        <div className="text-xs text-slate-600 mt-0.5">{r.note}</div>
                      )}
                      <div className="text-[10px] text-slate-400 mt-1">
                        Due {format(new Date(r.remindAt), "MMM d, h:mm a")}
                      </div>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-slate-400 hover:text-slate-700"
                      title="Dismiss"
                      onClick={() => dismissMutation.mutate({ id: r.id })}
                      disabled={dismissMutation.isPending}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
