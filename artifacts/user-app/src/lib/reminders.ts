import type { QueryClient } from "@tanstack/react-query";
import {
  getListRemindersQueryKey,
  type ListRemindersParams,
  type Reminder,
} from "@workspace/api-client-react";

/**
 * The single canonical reminders query every surface shares (composer popover,
 * left-pane row bells, header hub). Using one query key lets React Query dedupe
 * the polling and keeps all three views in agreement.
 */
export const ALL_REMINDERS_PARAMS: ListRemindersParams = { status: "all" };

/** Invalidate every reminders list variant (all/due/pending) after a mutation. */
export function invalidateReminders(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: getListRemindersQueryKey() });
}

/**
 * A reminder is "due" the moment its time passes — independent of the 60s
 * server timer that stamps `firedAt`. Checking `remindAt <= now` too avoids up
 * to a minute of UI latency.
 */
export function isReminderDue(
  r: Pick<Reminder, "firedAt" | "remindAt">,
  now: number = Date.now(),
): boolean {
  if (r.firedAt) return true;
  return new Date(r.remindAt).getTime() <= now;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Format a Date into the value an <input type="datetime-local"> expects (local time). */
export function toLocalDatetimeInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export type ReminderPreset = { label: string; build: () => Date };

export const REMINDER_PRESETS: ReminderPreset[] = [
  { label: "+15m", build: () => new Date(Date.now() + 15 * 60 * 1000) },
  { label: "+1h", build: () => new Date(Date.now() + 60 * 60 * 1000) },
  { label: "+4h", build: () => new Date(Date.now() + 240 * 60 * 1000) },
  {
    label: "Tomorrow 9am",
    build: () => {
      const t = new Date();
      t.setDate(t.getDate() + 1);
      t.setHours(9, 0, 0, 0);
      return t;
    },
  },
];
