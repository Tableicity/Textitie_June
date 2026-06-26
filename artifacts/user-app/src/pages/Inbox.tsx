import {
  useListConversations,
  useGetConversation,
  useListMessages,
  useSendMessage,
  useListDepartments,
  useListAgents,
  useClaimConversation,
  useCreateConversation,
  useTransferConversation,
  useUnassignConversation,
  useListConversationEvents,
  useListShortcuts,
  usePostWhisper,
  useUpdateConversation,
  useListDispositions,
  useCreateReminder,
  useListContacts,
  useCreateContact,
  useUpdateContact,
  useSetContactBlocked,
  useCreateOptOut,
  listContacts,
  getListMessagesQueryKey,
  getListConversationsQueryKey,
  getGetConversationQueryKey,
  getListConversationEventsQueryKey,
  getListShortcutsQueryKey,
  getListDispositionsQueryKey,
  getListRemindersQueryKey,
  getListContactsQueryKey,
} from "@workspace/api-client-react";
import type { UpdateConversationInputEngagementModeOverride } from "@workspace/api-client-react";
import { useSearch, useLocation } from "wouter";
import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useRealtimeInbox } from "@/hooks/useRealtimeInbox";
import ReminderBell from "@/components/ReminderBell";
import { format } from "date-fns";
import {
  Search,
  Send,
  Clock,
  User,
  Phone,
  CheckCircle2,
  MessageSquare,
  Building2,
  Filter,
  Hand,
  ArrowRightLeft,
  MapPin,
  PencilLine,
  UserX,
  History,
  Loader2,
  Circle,
  StickyNote,
  CheckSquare,
  BellPlus,
  X as XIcon,
  Sparkles,
  Fuel,
  Paperclip,
  MoreVertical,
  Mail,
  Globe,
  Tag,
  Ban,
  Archive,
  BellOff,
  BookUser,
  AlertCircle,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { formatPhone, cityStateForPhone, toE164 } from "@/lib/phone";

type ContactCardDraft = {
  name: string;
  email: string;
  preferredLanguage: string;
  tagsCsv: string;
  notes: string;
};

const blankContactDraft: ContactCardDraft = {
  name: "",
  email: "",
  preferredLanguage: "",
  tagsCsv: "",
  notes: "",
};

const PREFERRED_LANGUAGES = [
  "English",
  "Spanish",
  "Chinese (Mandarin)",
  "Vietnamese",
  "Tagalog",
  "Korean",
  "French",
  "Arabic",
  "Other",
];

function contactCsvToTags(s: string): string[] | null {
  const arr = s
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return arr.length ? arr : null;
}

// Identity of a Co-Pilot draft for de-dup, keyed on the inbound TURN it answers
// (latestInboundMessageId) rather than updatedAt. A slow background AI write
// (finalize/stage) for the SAME turn bumps updatedAt but not the turn, so a
// turn key collapses those re-emits — and, critically, a key recorded when the
// agent sends marks the turn consumed so a late draft can't re-fill the cleared
// composer. Falls back to a timestamp key only when no turn is known.
function aiTurnKey(
  selectedId: number,
  turn: number | null | undefined,
  updatedAt?: string | null,
): string {
  return typeof turn === "number"
    ? `${selectedId}:turn:${turn}`
    : `${selectedId}:ts:${updatedAt ?? ""}`;
}

export default function Inbox() {
  const queryClient = useQueryClient();
  useRealtimeInbox();
  const searchString = useSearch();
  const [, setLocation] = useLocation();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [composeText, setComposeText] = useState("");
  const [isWhisperMode, setIsWhisperMode] = useState(false);
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [searchQ, setSearchQ] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferTarget, setTransferTarget] = useState<string>("");
  const [transferNote, setTransferNote] = useState("");
  const [showEvents, setShowEvents] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [shortcutFilter, setShortcutFilter] = useState("");
  const [shortcutIndex, setShortcutIndex] = useState(0);
  const [showResolve, setShowResolve] = useState(false);
  const [resolveDispId, setResolveDispId] = useState<string>("");
  const [resolveNote, setResolveNote] = useState("");
  const [showRemind, setShowRemind] = useState(false);
  const [remindAt, setRemindAt] = useState("");
  const [remindNote, setRemindNote] = useState("");
  const [showNewMessage, setShowNewMessage] = useState(false);
  const [showHaloAi, setShowHaloAi] = useState(false);
  const [showBuyGas, setShowBuyGas] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [newName, setNewName] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Tracks the last Co-Pilot draft we auto-inserted, so we prefill a draft once
  // per distinct draft and never re-fight an agent who cleared or edited it.
  const appliedDraftKeyRef = useRef<string | null>(null);
  const COMPOSE_MAX_CHARS = 1000;
  const COMMON_EMOJIS = [
    "😀","😂","😉","😍","🥰","😎","🤔","🙏",
    "👍","👏","🙌","💪","✅","❌","🔥","🎉",
    "❤️","💙","💯","⭐","☀️","🚗","📞","📅",
  ];
  const [showEmoji, setShowEmoji] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [showContactCard, setShowContactCard] = useState(false);
  const [editingContact, setEditingContact] = useState(false);
  const [contactDraft, setContactDraft] = useState<ContactCardDraft>(blankContactDraft);

  // Auto-select conversation from URL param (e.g. from reminder bell jump)
  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const cid = params.get("conversation");
    if (cid) {
      const n = parseInt(cid);
      if (!Number.isNaN(n)) setSelectedId(n);
    }
  }, [searchString]);

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setSearchQ(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data: departments } = useListDepartments();
  const { data: agents } = useListAgents();
  const { data: shortcuts } = useListShortcuts({ query: { queryKey: getListShortcutsQueryKey() } });

  const deptMap = useMemo(() => {
    const map = new Map<number, string>();
    departments?.forEach((d) => map.set(d.id, d.name));
    return map;
  }, [departments]);

  const agentMap = useMemo(() => {
    const map = new Map<number, string>();
    agents?.forEach((a) => map.set(a.id, a.name));
    return map;
  }, [agents]);

  const filterParams = useMemo(() => {
    const p: Record<string, string | number> = {};
    if (deptFilter !== "all") p.departmentId = Number(deptFilter);
    if (statusFilter !== "all") p.status = statusFilter;
    if (searchQ) p.q = searchQ;
    return Object.keys(p).length ? (p as { departmentId?: number; status?: "open" | "closed"; q?: string }) : undefined;
  }, [deptFilter, statusFilter, searchQ]);

  const { data: conversations, isLoading: loadingConversations } =
    useListConversations(filterParams, {
      query: {
        queryKey: getListConversationsQueryKey(filterParams),
        refetchInterval: 30000,
      },
    });

  // Auto-select the first (most recent) conversation if none is selected,
  // so the conversation header + action buttons are always visible.
  useEffect(() => {
    if (selectedId == null && conversations && conversations.length > 0) {
      setSelectedId(conversations[0].id);
    }
  }, [conversations, selectedId]);

  const { data: dispositions } = useListDispositions({
    query: { queryKey: getListDispositionsQueryKey() },
  });

  const { data: selectedConv, isLoading: loadingConv } = useGetConversation(
    selectedId as number,
    {
      query: {
        enabled: !!selectedId,
        queryKey: getGetConversationQueryKey(selectedId as number),
      },
    },
  );

  const { data: messages, isLoading: loadingMessages } = useListMessages(
    selectedId as number,
    {
      query: {
        enabled: !!selectedId,
        queryKey: getListMessagesQueryKey(selectedId as number),
        refetchInterval: 30000,
      },
    },
  );

  // The inbound TURN the agent is currently answering = the newest inbound
  // message in the thread. Used to mark a turn consumed on send so a late
  // Co-Pilot draft for that same turn can't re-fill the composer. Mirrored into
  // a ref so the send mutation's onSuccess always sees the live value.
  const latestInboundId = useMemo(() => {
    if (!messages) return null;
    let maxId: number | null = null;
    for (const m of messages) {
      if (m.direction === "inbound" && (maxId === null || m.id > maxId)) {
        maxId = m.id;
      }
    }
    return maxId;
  }, [messages]);
  const latestInboundIdRef = useRef<number | null>(null);
  useEffect(() => {
    latestInboundIdRef.current = latestInboundId;
  }, [latestInboundId]);

  const { data: events } = useListConversationEvents(selectedId as number, {
    query: {
      enabled: !!selectedId && showEvents,
      queryKey: getListConversationEventsQueryKey(selectedId as number),
    },
  });

  // Contact card: look up the stored contact for the selected conversation's
  // phone. The inbound webhook never creates a contact row, so this may be
  // empty — in which case saving creates one (find-or-create on save).
  const contactPhone = selectedConv?.contactPhone ?? "";
  const { data: contactMatches } = useListContacts(
    { q: contactPhone },
    {
      query: {
        enabled: showContactCard && contactPhone.length > 0,
        queryKey: getListContactsQueryKey({ q: contactPhone }),
      },
    },
  );
  const existingContact =
    contactMatches?.find((c) => c.phone === contactPhone) ?? null;

  // Close/reset the contact card whenever the selected conversation changes.
  useEffect(() => {
    setShowContactCard(false);
    setEditingContact(false);
  }, [selectedId]);

  const invalidateContactViews = () => {
    queryClient.invalidateQueries({
      predicate: (qq) => {
        const k = qq.queryKey?.[0];
        return (
          typeof k === "string" &&
          (k.startsWith("/api/contacts") || k.startsWith("/api/conversations"))
        );
      },
    });
  };

  const createContactMut = useCreateContact({
    mutation: {
      onSuccess: () => {
        invalidateContactViews();
        setEditingContact(false);
      },
    },
  });

  const updateContactMut = useUpdateContact({
    mutation: {
      onSuccess: () => {
        invalidateContactViews();
        setEditingContact(false);
      },
    },
  });

  const setBlockedMut = useSetContactBlocked({
    mutation: { onSuccess: () => invalidateContactViews() },
  });

  const createOptOutMut = useCreateOptOut({
    mutation: { onSuccess: () => invalidateContactViews() },
  });

  // Which destructive contact-card action is awaiting confirmation.
  const [contactConfirm, setContactConfirm] = useState<
    "block" | "archive" | "unsubscribe" | null
  >(null);

  const handleViewInAddressBook = () => {
    setShowContactCard(false);
    setLocation(`/contacts?q=${encodeURIComponent(contactPhone)}`);
  };

  const handleUnblock = async () => {
    if (!contactPhone) return;
    await setBlockedMut.mutateAsync({ data: { phone: contactPhone, blocked: false } });
  };

  const openContactEdit = () => {
    setContactSaveError(null);
    setContactDraft({
      name: existingContact?.name ?? (selectedConv?.contactName && selectedConv.contactName !== contactPhone ? selectedConv.contactName : ""),
      email: existingContact?.email ?? "",
      preferredLanguage: existingContact?.preferredLanguage ?? "",
      tagsCsv: existingContact?.tags?.join(", ") ?? "",
      notes: existingContact?.notes ?? "",
    });
    setEditingContact(true);
  };

  const [contactSaveError, setContactSaveError] = useState<string | null>(null);

  const handleSaveContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactPhone) return;
    setContactSaveError(null);
    const body = {
      name: contactDraft.name.trim() || null,
      email: contactDraft.email.trim() || null,
      preferredLanguage: contactDraft.preferredLanguage.trim() || null,
      tags: contactCsvToTags(contactDraft.tagsCsv),
      notes: contactDraft.notes.trim() || null,
    };
    try {
      if (existingContact) {
        await updateContactMut.mutateAsync({ id: existingContact.id, data: body });
      } else {
        try {
          await createContactMut.mutateAsync({ data: { phone: contactPhone, ...body } });
        } catch (err) {
          // The contact was created between our lookup and this save (POST
          // returns 409 on duplicate phone). Recover by re-fetching the row by
          // phone and applying the edit as an update instead of failing.
          const status = (err as { status?: number } | null)?.status;
          if (status !== 409) throw err;
          const matches = await listContacts({ q: contactPhone });
          const conflicting = matches?.find((c) => c.phone === contactPhone);
          if (!conflicting) throw err;
          await updateContactMut.mutateAsync({ id: conflicting.id, data: body });
        }
      }
    } catch {
      setContactSaveError("Couldn't save the contact. Please try again.");
    }
  };

  const contactSaving = createContactMut.isPending || updateContactMut.isPending;

  const invalidateConv = () => {
    if (selectedId) {
      queryClient.invalidateQueries({
        queryKey: getGetConversationQueryKey(selectedId),
      });
      queryClient.invalidateQueries({
        queryKey: getListConversationEventsQueryKey(selectedId),
      });
    }
    queryClient.invalidateQueries({
      queryKey: getListConversationsQueryKey(filterParams),
    });
  };

  const sendMessage = useSendMessage({
    mutation: {
      onSuccess: () => {
        setComposeText("");
        if (selectedId) {
          // Mark the inbound turn we just answered as consumed. A slow Co-Pilot
          // finalize/stage can land a draft for this same turn a beat after the
          // send; recording its turn key here makes the prefill effect skip it
          // so the cleared composer is never re-filled with the sent reply.
          appliedDraftKeyRef.current = aiTurnKey(
            selectedId,
            latestInboundIdRef.current,
          );
          queryClient.invalidateQueries({
            queryKey: getListMessagesQueryKey(selectedId),
          });
          queryClient.invalidateQueries({
            queryKey: getListConversationsQueryKey(),
          });
          // Refresh the conversation detail so the AI-state (button color +
          // handback chip) updates after a human send marks the row handled,
          // independent of the SSE stream.
          queryClient.invalidateQueries({
            queryKey: getGetConversationQueryKey(selectedId),
          });
        }
      },
    },
  });

  const whisperMutation = usePostWhisper({
    mutation: {
      onSuccess: () => {
        setComposeText("");
        if (selectedId) {
          queryClient.invalidateQueries({
            queryKey: getListMessagesQueryKey(selectedId),
          });
        }
      },
    },
  });

  const updateConv = useUpdateConversation({
    mutation: {
      onSuccess: () => {
        invalidateConv();
        setShowResolve(false);
        setResolveDispId("");
        setResolveNote("");
      },
    },
  });

  // Per-conversation engagement-mode override. Kept separate from updateConv so
  // it doesn't touch the resolve dialog state.
  const setOverrideMut = useUpdateConversation({
    mutation: { onSuccess: invalidateConv },
  });

  const contactActionPending =
    setBlockedMut.isPending ||
    createOptOutMut.isPending ||
    updateConv.isPending;

  const confirmContactAction = async () => {
    if (!contactPhone) return;
    try {
      if (contactConfirm === "block") {
        await setBlockedMut.mutateAsync({ data: { phone: contactPhone, blocked: true } });
      } else if (contactConfirm === "unsubscribe") {
        await createOptOutMut.mutateAsync({ data: { phone: contactPhone } });
      } else if (contactConfirm === "archive" && selectedId) {
        await updateConv.mutateAsync({ id: selectedId, data: { status: "closed" } });
      }
      setContactConfirm(null);
      setShowContactCard(false);
    } catch {
      // Keep the dialog open so the agent can retry.
    }
  };

  const createReminder = useCreateReminder({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListRemindersQueryKey() });
        setShowRemind(false);
        setRemindAt("");
        setRemindNote("");
      },
    },
  });

  const claimMutation = useClaimConversation({
    mutation: { onSuccess: invalidateConv },
  });

  const createConvMutation = useCreateConversation({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({
          queryKey: getListConversationsQueryKey(filterParams),
        });
        setShowNewMessage(false);
        setNewPhone("");
        setNewName("");
        if (data?.id) setSelectedId(data.id);
      },
    },
  });

  const transferMutation = useTransferConversation({
    mutation: {
      onSuccess: () => {
        invalidateConv();
        setShowTransfer(false);
        setTransferTarget("");
        setTransferNote("");
      },
    },
  });

  const unassignMutation = useUnassignConversation({
    mutation: { onSuccess: invalidateConv },
  });

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const filteredShortcuts = useMemo(() => {
    if (!shortcuts || !shortcutFilter) return shortcuts || [];
    const q = shortcutFilter.toLowerCase();
    return shortcuts.filter(
      (s) =>
        s.shortcutKey.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.body.toLowerCase().includes(q)
    );
  }, [shortcuts, shortcutFilter]);

  const handleComposeChange = useCallback(
    (value: string) => {
      const clipped = value.length > 1000 ? value.slice(0, 1000) : value;
      setComposeText(clipped);
      if (clipped.startsWith("/") && clipped.length >= 1) {
        setShowShortcuts(true);
        setShortcutFilter(clipped);
        setShortcutIndex(0);
      } else {
        setShowShortcuts(false);
        setShortcutFilter("");
      }
    },
    []
  );

  const insertShortcut = useCallback(
    (body: string) => {
      setComposeText(body);
      setShowShortcuts(false);
      setShortcutFilter("");
      inputRef.current?.focus();
    },
    []
  );

  const handleComposeKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (showShortcuts && filteredShortcuts.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setShortcutIndex((i) =>
            Math.min(i + 1, filteredShortcuts.length - 1),
          );
          return;
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setShortcutIndex((i) => Math.max(i - 1, 0));
          return;
        } else if (e.key === "Tab" || e.key === "Enter") {
          e.preventDefault();
          insertShortcut(filteredShortcuts[shortcutIndex].body);
          return;
        } else if (e.key === "Escape") {
          setShowShortcuts(false);
          return;
        }
      }
      // Enter sends; Shift+Enter inserts a newline.
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
      }
    },
    [showShortcuts, filteredShortcuts, shortcutIndex, insertShortcut],
  );

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!composeText.trim() || !selectedId) return;
    if (isWhisperMode) {
      whisperMutation.mutate({ id: selectedId, data: { body: composeText } });
    } else {
      sendMessage.mutate({ id: selectedId, data: { body: composeText } });
    }
  };

  const dispMap = useMemo(() => {
    const m = new Map<number, { label: string; color: string }>();
    dispositions?.forEach((d) => m.set(d.id, { label: d.label, color: d.color }));
    return m;
  }, [dispositions]);

  const composerBusy = sendMessage.isPending || whisperMutation.isPending;

  // --- AI engagement (per-conversation) ---
  const effectiveMode = selectedConv?.effectiveEngagementMode ?? null;
  const aiState = selectedConv?.aiState ?? null;
  const overrideValue = selectedConv?.engagementModeOverride ?? null;

  // Auto-Pilot handed this one message back to a human (gate refused or Grok failed).
  const isAiHandback =
    effectiveMode === "autopilot" &&
    (aiState?.status === "failed" || aiState?.status === "refused");

  // A Co-Pilot (or pre-handback) draft is waiting for a human to review/send.
  const aiDraftBody = aiState?.draftBody?.trim() ?? "";
  const aiDraftReady = aiState?.status === "drafted" && aiDraftBody.length > 0;

  // Provenance label for the Co-Pilot triage router's two short-circuit drafts,
  // so the agent knows a "drafted" reply isn't a Classroom-grounded answer.
  const draftProvenanceLabel = !aiDraftReady
    ? null
    : aiState?.draftSource === "student_flash"
      ? "Grok general draft — not Classroom grounded"
      : aiState?.draftSource === "router_decline"
        ? "Off-scope decline"
        : aiState?.draftSource === "fallback_phrase"
          ? "Fallback holding phrase — not grounded; escalate for the real answer"
          : null;

  // Live send-button colour reflects the effective mode; an Auto-Pilot→Blue
  // handback overrides green for the one message that needs a human. Whisper
  // mode keeps its own amber styling and is independent of engagement mode.
  const sendButtonClass = isWhisperMode
    ? "bg-amber-600 hover:bg-amber-700"
    : effectiveMode === "copilot"
      ? "bg-yellow-500 hover:bg-yellow-600"
      : effectiveMode === "autopilot" && !isAiHandback
        ? "bg-emerald-600 hover:bg-emerald-700"
        : "bg-blue-600 hover:bg-blue-700";

  const modeChip =
    effectiveMode === "copilot"
      ? { chip: "bg-yellow-50 text-yellow-800 border border-yellow-300", dot: "bg-yellow-500", label: "Co-Pilot" }
      : effectiveMode === "autopilot"
        ? { chip: "bg-emerald-50 text-emerald-700 border border-emerald-200", dot: "bg-emerald-500", label: "Auto-Pilot" }
        : { chip: "bg-blue-50 text-blue-700 border border-blue-200", dot: "bg-blue-500", label: "Manual" };

  const insertAiDraft = useCallback(() => {
    if (!aiState?.draftBody || !selectedId) return;
    setComposeText(aiState.draftBody.slice(0, COMPOSE_MAX_CHARS));
    appliedDraftKeyRef.current = aiTurnKey(
      selectedId,
      aiState.latestInboundMessageId,
      aiState.updatedAt,
    );
    inputRef.current?.focus();
  }, [
    aiState?.draftBody,
    aiState?.latestInboundMessageId,
    aiState?.updatedAt,
    selectedId,
    COMPOSE_MAX_CHARS,
  ]);

  // Auto-prefill the composer with a fresh Co-Pilot draft, but never overwrite
  // text the agent has already typed and never re-apply a draft for a turn the
  // agent already answered. Keyed on the inbound turn (not updatedAt) so a slow
  // background AI write for the same turn — including one that lands just after
  // the agent sent — does not re-fill the cleared composer.
  useEffect(() => {
    if (!selectedId || !aiDraftReady || isWhisperMode) return;
    const key = aiTurnKey(
      selectedId,
      aiState?.latestInboundMessageId,
      aiState?.updatedAt,
    );
    if (appliedDraftKeyRef.current === key) return;
    if (composeText.trim().length > 0) return;
    setComposeText(aiDraftBody.slice(0, COMPOSE_MAX_CHARS));
    appliedDraftKeyRef.current = key;
  }, [
    selectedId,
    aiDraftReady,
    aiDraftBody,
    aiState?.latestInboundMessageId,
    aiState?.updatedAt,
    composeText,
    isWhisperMode,
    COMPOSE_MAX_CHARS,
  ]);

  const statusColor = (s: string) => {
    if (s === "online") return "bg-emerald-500";
    if (s === "away") return "bg-amber-400";
    return "bg-slate-300";
  };

  return (
    <div className="flex h-full bg-white divide-x divide-slate-200">
      {/* Left Panel: Conversation List */}
      <div className="w-80 flex flex-col bg-slate-50 flex-shrink-0">
        <div className="p-4 border-b border-slate-200 bg-white space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search name, phone, or message..."
              className="pl-9 bg-slate-50 border-slate-200 focus-visible:ring-blue-500"
              data-testid="input-conversation-search"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
              >
                <XIcon className="w-3 h-3" />
              </button>
            )}
          </div>
          <Select
            value={statusFilter}
            onValueChange={(v) => {
              setStatusFilter(v);
              setSelectedId(null);
            }}
          >
            <SelectTrigger className="h-8 text-xs bg-slate-50 border-slate-200">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Open conversations</SelectItem>
              <SelectItem value="closed">Closed conversations</SelectItem>
              <SelectItem value="all">All conversations</SelectItem>
            </SelectContent>
          </Select>
          {departments && departments.length > 0 && (
            <Select
              value={deptFilter}
              onValueChange={(v) => {
                setDeptFilter(v);
                setSelectedId(null);
              }}
            >
              <SelectTrigger className="h-8 text-xs bg-slate-50 border-slate-200">
                <div className="flex items-center gap-1.5">
                  <Filter className="w-3 h-3 text-slate-400" />
                  <SelectValue placeholder="All Departments" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                <SelectItem value="0">Unassigned</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id.toString()}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <ScrollArea className="flex-1">
          {loadingConversations ? (
            <div className="p-4 space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex gap-3">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-3 w-2/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : conversations?.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-sm">
              No conversations found.
            </div>
          ) : (
            <div>
              {conversations?.map((conv) => {
                const cityState = cityStateForPhone(conv.contactPhone);
                const isSelected = selectedId === conv.id;
                return (
                <button
                  key={conv.id}
                  onClick={() => setSelectedId(conv.id)}
                  className={`w-full text-left p-4 hover:bg-blue-50/50 transition-colors border-b ${
                    isSelected
                      ? "bg-blue-50 border-l-4 border-l-blue-500 border-b-blue-500"
                      : "border-l-4 border-l-transparent border-b-slate-200"
                  }`}
                >
                  <div className="flex justify-between items-start mb-1">
                    <span className="font-semibold text-sm text-slate-900 truncate pr-2">
                      {conv.contactName || formatPhone(conv.contactPhone)}
                    </span>
                    {(conv.lastMessageAt || conv.createdAt) && (
                      <span className="text-xs text-slate-400 flex-shrink-0 whitespace-nowrap">
                        {format(
                          new Date(conv.lastMessageAt ?? conv.createdAt),
                          "MMM d, yyyy h:mma",
                        )}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span className="truncate pr-4">{formatPhone(conv.contactPhone)}</span>
                    {conv.status === "open" ? (
                      <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                    ) : (
                      <CheckCircle2 className="w-3 h-3 text-slate-400" />
                    )}
                  </div>
                  {cityState && (
                    <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                      {cityState}
                    </div>
                  )}
                  <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                    {conv.departmentId &&
                      deptMap.get(conv.departmentId) && (
                        <div className="flex items-center gap-1">
                          <Building2 className="w-3 h-3 text-slate-400" />
                          <span className="text-[10px] font-medium text-slate-400">
                            {deptMap.get(conv.departmentId)}
                          </span>
                        </div>
                      )}
                    {conv.assignedUserId &&
                      agentMap.get(conv.assignedUserId) && (
                        <div className="flex items-center gap-1">
                          <User className="w-3 h-3 text-blue-400" />
                          <span className="text-[10px] font-medium text-blue-400">
                            {agentMap.get(conv.assignedUserId)}
                          </span>
                        </div>
                      )}
                  </div>
                </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Right Panel: Selected Conversation */}
      <div className="flex-1 flex flex-col bg-white min-w-0">
        {selectedId ? (
          <>
            {/* Header */}
            <div className="border-b border-slate-200 px-6 py-3 flex items-center justify-between flex-shrink-0 bg-white z-10">
              <button
                type="button"
                onClick={() => setShowContactCard(true)}
                className="flex items-center gap-4 text-left rounded-lg -mx-1 px-1 py-0.5 hover:bg-slate-50 transition-colors group"
                data-testid="button-open-contact-card"
                title="View contact info"
              >
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                  <User className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="font-semibold text-slate-900 leading-tight group-hover:text-blue-700 transition-colors">
                    {loadingConv ? (
                      <Skeleton className="h-5 w-32" />
                    ) : (
                      selectedConv?.contactName || formatPhone(selectedConv?.contactPhone)
                    )}
                  </h2>
                  <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                    <Phone className="w-3 h-3" />
                    {formatPhone(selectedConv?.contactPhone)}
                    {selectedConv?.departmentId &&
                      deptMap.get(selectedConv.departmentId) && (
                        <>
                          <span className="w-1 h-1 rounded-full bg-slate-300 mx-1"></span>
                          <span className="flex items-center gap-1">
                            <Building2 className="w-3 h-3" />
                            {deptMap.get(selectedConv.departmentId)}
                          </span>
                        </>
                      )}
                    {selectedConv?.assignedUserId &&
                      agentMap.get(selectedConv.assignedUserId) && (
                        <>
                          <span className="w-1 h-1 rounded-full bg-slate-300 mx-1"></span>
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3 text-blue-500" />
                            {agentMap.get(selectedConv.assignedUserId)}
                          </span>
                        </>
                      )}
                    {selectedConv?.contactLocation && (
                      <>
                        <span className="w-1 h-1 rounded-full bg-slate-300 mx-1"></span>
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {selectedConv.contactLocation}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <MoreVertical className="w-5 h-5 text-slate-400 group-hover:text-blue-600 transition-colors flex-shrink-0 self-center" />
              </button>

              <div className="flex items-center gap-1.5">
                {/* Per-conversation AI engagement override (null = inherit tenant). */}
                {selectedConv && (
                  <Select
                    value={overrideValue ?? "inherit"}
                    onValueChange={(v) => {
                      if (!selectedId) return;
                      setOverrideMut.mutate({
                        id: selectedId,
                        data: {
                          engagementModeOverride:
                            v === "inherit"
                              ? null
                              : (v as UpdateConversationInputEngagementModeOverride),
                        },
                      });
                    }}
                    disabled={setOverrideMut.isPending}
                  >
                    <SelectTrigger
                      className="h-8 w-[150px] text-xs"
                      data-testid="select-engagement-override"
                    >
                      <span className="flex items-center gap-1.5">
                        <span className={`h-2 w-2 rounded-full ${modeChip.dot}`} />
                        <SelectValue />
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="inherit">Mode: Inherit</SelectItem>
                      <SelectItem value="manual">Mode: Manual</SelectItem>
                      <SelectItem value="copilot">Mode: Co-Pilot</SelectItem>
                      <SelectItem value="autopilot">Mode: Auto-Pilot</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                {/* Order: Claim → Resolve → New Message → Halo AI → Buy Gas */}
                {!selectedConv?.assignedUserId && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs font-medium gap-1.5 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                    disabled={claimMutation.isPending}
                    onClick={() => claimMutation.mutate({ id: selectedId })}
                    data-testid="button-claim-header"
                  >
                    {claimMutation.isPending ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Hand className="w-3 h-3" />
                    )}
                    Claim
                  </Button>
                )}
                {selectedConv?.status === "open" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs font-medium gap-1.5 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                    onClick={() => {
                      setResolveDispId("");
                      setResolveNote("");
                      setShowResolve(true);
                    }}
                    data-testid="button-resolve"
                  >
                    <CheckSquare className="w-3 h-3" /> Resolve
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs font-medium gap-1.5 border-blue-200 text-blue-700 hover:bg-blue-50"
                  onClick={() => {
                    setNewPhone("");
                    setNewName("");
                    setShowNewMessage(true);
                  }}
                  data-testid="button-new-message-header"
                >
                  <PencilLine className="w-3 h-3" />
                  New Message
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs font-medium gap-1.5 border-violet-200 text-violet-700 hover:bg-violet-50"
                  onClick={() => setShowHaloAi(true)}
                  data-testid="button-halo-ai"
                >
                  <Sparkles className="w-3 h-3" />
                  Halo AI
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs font-medium gap-1.5 border-amber-200 text-amber-700 hover:bg-amber-50"
                  onClick={() => setShowBuyGas(true)}
                  data-testid="button-buy-gas"
                >
                  <Fuel className="w-3 h-3" />
                  Buy Gas
                </Button>
                <ReminderBell
                  variant="header"
                  onJumpToConversation={(cid) => {
                    setSelectedId(cid);
                    setLocation(`/inbox?conversation=${cid}`);
                  }}
                />
                {selectedConv?.assignedUserId && (
                  <>
                    <Dialog
                      open={showTransfer}
                      onOpenChange={setShowTransfer}
                    >
                      <DialogTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs font-medium gap-1.5"
                        >
                          <ArrowRightLeft className="w-3 h-3" />
                          Transfer
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Transfer Conversation</DialogTitle>
                          <DialogDescription>
                            Transfer this conversation to another agent.
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                          <div>
                            <Label className="mb-2 block">
                              Transfer To
                            </Label>
                            <Select
                              value={transferTarget}
                              onValueChange={setTransferTarget}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select an agent" />
                              </SelectTrigger>
                              <SelectContent>
                                {agents
                                  ?.filter(
                                    (a) =>
                                      a.id !==
                                      selectedConv?.assignedUserId,
                                  )
                                  .map((a) => (
                                    <SelectItem
                                      key={a.id}
                                      value={a.id.toString()}
                                    >
                                      <div className="flex items-center gap-2">
                                        <Circle
                                          className={`w-2 h-2 fill-current ${
                                            a.status === "online"
                                              ? "text-emerald-500"
                                              : a.status === "away"
                                                ? "text-amber-400"
                                                : "text-slate-300"
                                          }`}
                                        />
                                        {a.name}
                                        <span className="text-slate-400">
                                          ({a.role})
                                        </span>
                                      </div>
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="mb-2 block">
                              Note (optional)
                            </Label>
                            <Input
                              value={transferNote}
                              onChange={(e) =>
                                setTransferNote(e.target.value)
                              }
                              placeholder="Context for the receiving agent..."
                            />
                          </div>
                        </div>
                        <DialogFooter>
                          <Button
                            variant="outline"
                            onClick={() => setShowTransfer(false)}
                          >
                            Cancel
                          </Button>
                          <Button
                            className="bg-blue-600 hover:bg-blue-700"
                            disabled={
                              !transferTarget ||
                              transferMutation.isPending
                            }
                            onClick={() => {
                              if (!transferTarget) return;
                              transferMutation.mutate({
                                id: selectedId,
                                data: {
                                  targetUserId: parseInt(transferTarget),
                                  note: transferNote || undefined,
                                },
                              });
                            }}
                          >
                            {transferMutation.isPending && (
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            )}
                            Transfer
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>

                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs font-medium gap-1.5 border-red-200 text-red-600 hover:bg-red-50"
                      disabled={unassignMutation.isPending}
                      onClick={() =>
                        unassignMutation.mutate({ id: selectedId })
                      }
                    >
                      {unassignMutation.isPending ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <UserX className="w-3 h-3" />
                      )}
                      Unassign
                    </Button>
                  </>
                )}

                {selectedConv?.status === "closed" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs font-medium gap-1.5"
                    onClick={() =>
                      updateConv.mutate({ id: selectedId, data: { status: "open" } })
                    }
                    disabled={updateConv.isPending}
                  >
                    Reopen
                  </Button>
                )}

                <Button
                  variant="ghost"
                  size="sm"
                  className={`h-8 w-8 p-0 ${showEvents ? "bg-slate-100" : ""}`}
                  onClick={() => setShowEvents(!showEvents)}
                  title="Activity log"
                >
                  <History className="w-4 h-4 text-slate-500" />
                </Button>
              </div>
            </div>

            {selectedConv?.status === "closed" && (
              <div className="border-b border-slate-200 bg-emerald-50 px-6 py-2 flex items-center gap-3 text-xs">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span className="font-semibold text-emerald-800">Resolved</span>
                {selectedConv.dispositionId && dispMap.get(selectedConv.dispositionId) && (
                  <Badge
                    variant="outline"
                    style={{
                      borderColor: dispMap.get(selectedConv.dispositionId)!.color,
                      color: dispMap.get(selectedConv.dispositionId)!.color,
                    }}
                  >
                    {dispMap.get(selectedConv.dispositionId)!.label}
                  </Badge>
                )}
                {selectedConv.resolutionNote && (
                  <span className="text-emerald-700 italic truncate">
                    "{selectedConv.resolutionNote}"
                  </span>
                )}
              </div>
            )}

            {showEvents && events && events.length > 0 && (
              <div className="border-b border-slate-200 bg-slate-50 px-6 py-3 max-h-40 overflow-auto">
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  Activity Log
                </div>
                <div className="space-y-1.5">
                  {events.map((evt) => (
                    <div
                      key={evt.id}
                      className="flex items-center gap-2 text-xs text-slate-500"
                    >
                      <span className="text-[10px] text-slate-400 w-16 flex-shrink-0">
                        {format(new Date(evt.createdAt), "MMM d, yyyy h:mma")}
                      </span>
                      <span className="font-medium capitalize">
                        {evt.eventType.replace("_", " ")}
                      </span>
                      {evt.actorId && agentMap.get(evt.actorId) && (
                        <span>
                          by{" "}
                          <span className="font-medium text-slate-700">
                            {agentMap.get(evt.actorId)}
                          </span>
                        </span>
                      )}
                      {evt.targetId && agentMap.get(evt.targetId) && (
                        <span>
                          →{" "}
                          <span className="font-medium text-slate-700">
                            {agentMap.get(evt.targetId)}
                          </span>
                        </span>
                      )}
                      {evt.note && (
                        <span className="italic text-slate-400 truncate">
                          "{evt.note}"
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Messages */}
            <ScrollArea className="flex-1 bg-slate-50/50 p-6">
              {loadingMessages ? (
                <div className="space-y-6">
                  <Skeleton className="h-16 w-2/3 ml-auto rounded-2xl rounded-tr-sm" />
                  <Skeleton className="h-12 w-1/2 rounded-2xl rounded-tl-sm" />
                  <Skeleton className="h-20 w-3/4 ml-auto rounded-2xl rounded-tr-sm" />
                </div>
              ) : messages?.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 py-12">
                  <Clock className="w-8 h-8 mb-3 opacity-20" />
                  <p className="text-sm">No messages yet.</p>
                </div>
              ) : (
                <div className="space-y-6 pb-4">
                  {messages?.map((msg) => {
                    const isInternal = msg.direction === "internal";
                    const isOutbound = msg.direction === "outbound";
                    if (isInternal) {
                      return (
                        <div key={msg.id} className="flex justify-center" data-testid={`whisper-${msg.id}`}>
                          <div className="max-w-[80%] bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 shadow-sm">
                            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-amber-700 uppercase tracking-wider mb-1">
                              <StickyNote className="w-3 h-3" />
                              Internal note
                              {msg.senderName && (
                                <span className="text-amber-500 font-normal normal-case ml-1">· {msg.senderName}</span>
                              )}
                              <span className="text-amber-500 font-normal normal-case ml-1">
                                · {format(new Date(msg.createdAt), "MMM d, yyyy h:mma")}
                              </span>
                            </div>
                            <div className="text-sm text-amber-900 whitespace-pre-wrap">{msg.body}</div>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col ${isOutbound ? "items-end" : "items-start"}`}
                      >
                        <div className="flex items-end gap-2 max-w-[75%]">
                          <div
                            className={`px-4 py-2.5 text-sm ${
                              isOutbound
                                ? msg.status === "failed"
                                  ? "bg-red-100 border border-red-300 text-red-900 rounded-2xl rounded-br-sm"
                                  : "bg-blue-600 text-white rounded-2xl rounded-br-sm"
                                : "bg-white border border-slate-200 text-slate-900 rounded-2xl rounded-bl-sm shadow-sm"
                            }`}
                          >
                            {msg.body}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 mt-1.5 px-1">
                          <span className="text-[10px] font-medium text-slate-400">
                            {format(new Date(msg.createdAt), "MMM d, yyyy h:mma")}
                          </span>
                          {isOutbound && msg.status === "failed" && (
                            <span
                              className="text-[10px] font-semibold text-red-600 uppercase tracking-wide"
                              data-testid={`msg-failed-${msg.id}`}
                            >
                              · Not delivered
                            </span>
                          )}
                          {isOutbound && msg.status === "delivered" && (
                            <span className="text-[10px] font-medium text-emerald-600">
                              · Delivered
                            </span>
                          )}
                        </div>
                        {isOutbound && msg.status === "failed" && msg.errorMessage && (
                          <div
                            className="mt-1 px-3 py-1.5 max-w-[75%] text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-md"
                            data-testid={`msg-error-${msg.id}`}
                          >
                            {msg.errorMessage}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </ScrollArea>

            {/* Compose Area */}
            <div className="p-4 border-t border-slate-200 bg-white">
              <div className="relative">
                {showShortcuts && filteredShortcuts.length > 0 && (
                  <div className="absolute bottom-full left-0 right-0 mb-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-52 overflow-auto z-20">
                    <div className="px-3 py-2 border-b border-slate-100">
                      <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Shortcuts</span>
                    </div>
                    {filteredShortcuts.map((s, i) => (
                      <button
                        key={s.id}
                        type="button"
                        className={`w-full text-left px-3 py-2 flex items-start gap-3 transition-colors ${
                          i === shortcutIndex ? "bg-blue-50" : "hover:bg-slate-50"
                        }`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          insertShortcut(s.body);
                        }}
                        onMouseEnter={() => setShortcutIndex(i)}
                      >
                        <Badge variant="outline" className="text-[10px] h-5 font-mono flex-shrink-0 mt-0.5">{s.shortcutKey}</Badge>
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-slate-900">{s.name}</div>
                          <div className="text-[11px] text-slate-400 truncate">{s.body}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {selectedConv && effectiveMode && !isWhisperMode && (
                  <div
                    className="flex flex-wrap items-center gap-2 mb-2 text-xs"
                    data-testid="ai-engagement-status"
                  >
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium ${modeChip.chip}`}
                      data-testid="ai-mode-chip"
                    >
                      <span className={`h-2 w-2 rounded-full ${modeChip.dot}`} />
                      {modeChip.label}
                    </span>
                    {isAiHandback && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-blue-700"
                        data-testid="ai-handback-reason"
                      >
                        <AlertCircle className="h-3 w-3" />
                        {aiState?.reasonText ||
                          aiState?.reasonCode ||
                          "Handed back to you"}
                      </span>
                    )}
                    {aiState?.status === "auto_sent" && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700">
                        <Sparkles className="h-3 w-3" />
                        Auto-Pilot replied
                      </span>
                    )}
                    {draftProvenanceLabel && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-600"
                        data-testid="ai-draft-provenance"
                      >
                        <Sparkles className="h-3 w-3" />
                        {draftProvenanceLabel}
                      </span>
                    )}
                    {aiDraftReady && composeText.trim() !== aiDraftBody && (
                      <button
                        type="button"
                        onClick={insertAiDraft}
                        className="inline-flex items-center gap-1 rounded-full border border-yellow-300 bg-yellow-50 px-2 py-0.5 text-yellow-800 hover:bg-yellow-100"
                        data-testid="button-insert-ai-draft"
                      >
                        <Sparkles className="h-3 w-3" />
                        Insert AI draft
                      </button>
                    )}
                  </div>
                )}
                <form onSubmit={handleSend} className="flex items-end gap-2">
                  <button
                    type="button"
                    onClick={() => setIsWhisperMode((m) => !m)}
                    className={`h-[66px] w-[66px] rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                      isWhisperMode
                        ? "bg-amber-100 border-2 border-amber-500 text-amber-700 ring-2 ring-amber-300"
                        : "bg-white border border-slate-200 text-slate-400 hover:text-slate-700 hover:bg-slate-50"
                    }`}
                    title={isWhisperMode ? "Whisper mode: only your team will see this" : "Click to leave an internal note"}
                    data-testid="button-toggle-whisper"
                  >
                    <StickyNote className="w-5 h-5" />
                  </button>
                  <Popover open={showEmoji} onOpenChange={setShowEmoji}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="h-[66px] w-[66px] rounded-xl flex items-center justify-center shrink-0 transition-colors border bg-white border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-50"
                        title="Insert emoji"
                        data-testid="button-emoji"
                      >
                        <span className="text-2xl leading-none">😊</span>
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-64 p-2" align="start">
                      <div className="grid grid-cols-8 gap-1">
                        {COMMON_EMOJIS.map((emo) => (
                          <button
                            key={emo}
                            type="button"
                            className="text-xl rounded hover:bg-slate-100 h-7 w-7 flex items-center justify-center"
                            onClick={() => {
                              handleComposeChange(composeText + emo);
                              setShowEmoji(false);
                              inputRef.current?.focus();
                            }}
                          >
                            {emo}
                          </button>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                  <button
                    type="button"
                    onClick={() => setShowAttach(true)}
                    className="h-[66px] w-[66px] rounded-xl flex items-center justify-center shrink-0 transition-colors border bg-white border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-50"
                    title="Attach photo or PDF"
                    data-testid="button-attach"
                  >
                    <Paperclip className="w-5 h-5" />
                  </button>
                  <div className="flex-1 relative">
                    <Textarea
                      ref={inputRef}
                      value={composeText}
                      onChange={(e) => handleComposeChange(e.target.value)}
                      onKeyDown={handleComposeKeyDown}
                      maxLength={COMPOSE_MAX_CHARS}
                      rows={2}
                      placeholder={
                        isWhisperMode
                          ? "Internal note (only your team will see this)..."
                          : 'Type a message... (type "/" for shortcuts)'
                      }
                      className={`pr-12 min-h-[66px] max-h-40 overflow-y-auto resize-none text-base focus-visible:ring-blue-500 rounded-xl py-3 ${
                        isWhisperMode
                          ? "bg-amber-50 border-2 border-amber-500 ring-2 ring-amber-300"
                          : "bg-slate-50 border-slate-200"
                      }`}
                    />
                    <div className="absolute bottom-1.5 right-3 text-[10px] text-slate-400 pointer-events-none select-none">
                      {composeText.length}/{COMPOSE_MAX_CHARS}
                    </div>
                  </div>
                  <Button
                    type="submit"
                    size="icon"
                    className={`rounded-xl h-[66px] w-[66px] shrink-0 ${sendButtonClass}`}
                    disabled={!composeText.trim() || composerBusy}
                    data-testid="button-send-message"
                  >
                    <Send className="h-5 w-5" />
                  </Button>
                </form>
              </div>
            </div>
          </>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 bg-slate-50/30">
            <div className="w-16 h-16 rounded-full bg-white shadow-sm border border-slate-100 flex items-center justify-center mb-4">
              <MessageSquare className="w-6 h-6 text-slate-300" />
            </div>
            <p className="text-sm font-medium text-slate-500">
              Select a conversation to start messaging
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4 h-8 text-xs font-medium gap-1.5 border-blue-200 text-blue-700 hover:bg-blue-50"
              onClick={() => {
                setNewPhone("");
                setNewName("");
                setShowNewMessage(true);
              }}
              data-testid="button-new-message-empty"
            >
              <PencilLine className="w-3 h-3" />
              New Message
            </Button>
          </div>
        )}
      </div>

      {/* Resolve dialog */}
      <Dialog open={showResolve} onOpenChange={setShowResolve}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve conversation</DialogTitle>
            <DialogDescription>
              Mark this conversation as resolved. You can reopen it later.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="mb-1.5 block">Disposition (optional)</Label>
              <Select value={resolveDispId} onValueChange={setResolveDispId}>
                <SelectTrigger data-testid="select-disposition">
                  <SelectValue placeholder="No disposition" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— No disposition —</SelectItem>
                  {dispositions?.map((d) => (
                    <SelectItem key={d.id} value={d.id.toString()}>
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: d.color }}
                        />
                        {d.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {dispositions?.length === 0 && (
                <p className="text-xs text-slate-400 mt-1">
                  No dispositions configured yet. Add some in Settings → Dispositions.
                </p>
              )}
            </div>
            <div>
              <Label className="mb-1.5 block">Resolution note (optional)</Label>
              <Textarea
                value={resolveNote}
                onChange={(e) => setResolveNote(e.target.value)}
                placeholder="What was the outcome?"
                rows={3}
                data-testid="textarea-resolution-note"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowResolve(false)}>
              Cancel
            </Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700"
              disabled={updateConv.isPending || !selectedId}
              onClick={() => {
                if (!selectedId) return;
                updateConv.mutate({
                  id: selectedId,
                  data: {
                    status: "closed",
                    dispositionId:
                      resolveDispId && resolveDispId !== "none"
                        ? Number(resolveDispId)
                        : null,
                    resolutionNote: resolveNote.trim() || null,
                  },
                });
              }}
              data-testid="button-confirm-resolve"
            >
              {updateConv.isPending && <Loader2 className="w-3 h-3 animate-spin mr-2" />}
              Resolve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Halo AI (placeholder) */}
      <Dialog open={showHaloAi} onOpenChange={setShowHaloAi}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-violet-600" />
              Halo AI
            </DialogTitle>
            <DialogDescription>
              Halo AI is coming soon. We'll surface AI-assisted replies, summaries,
              and lead intelligence right inside your conversations.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setShowHaloAi(false)}>Got it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Attach (placeholder) */}
      <Dialog open={showAttach} onOpenChange={setShowAttach}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Paperclip className="w-4 h-4 text-slate-600" />
              Attach photo or PDF
            </DialogTitle>
            <DialogDescription>
              MMS attachments (photos and PDFs) are coming soon. We're wiring up
              secure storage and Twilio MMS so you can send and receive images
              and documents right inside the conversation. Pricing will be
              tier-based with a per-attachment surcharge.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setShowAttach(false)}>Got it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Buy Gas (placeholder) */}
      <Dialog open={showBuyGas} onOpenChange={setShowBuyGas}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Fuel className="w-4 h-4 text-amber-600" />
              Buy Gas
            </DialogTitle>
            <DialogDescription>
              Top up your messaging credit ("gas"). This will let you keep sending
              messages once your monthly allowance is used. Coming soon.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setShowBuyGas(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Message dialog */}
      <Dialog open={showNewMessage} onOpenChange={setShowNewMessage}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New message</DialogTitle>
            <DialogDescription>
              Enter the recipient's phone number to start a new conversation. If an open
              conversation already exists for this number, you'll be taken to it.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const e164 = toE164(newPhone);
              if (!e164) return;
              createConvMutation.mutate({
                data: {
                  contactPhone: e164,
                  contactName: newName.trim() || null,
                },
              });
            }}
            className="space-y-4 py-2"
          >
            <div>
              <Label className="mb-1.5 block">To</Label>
              <Input
                autoFocus
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="(555) 123-4567"
                data-testid="input-new-message-phone"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                {newPhone.trim() === "" || toE164(newPhone)
                  ? "US/Canada numbers — any format works (we'll add the +1)."
                  : "That doesn't look like a valid 10-digit number yet."}
              </p>
            </div>
            <div>
              <Label className="mb-1.5 block">Name (optional)</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Jane Doe"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowNewMessage(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-blue-600 hover:bg-blue-700"
                disabled={createConvMutation.isPending || !toE164(newPhone)}
                data-testid="button-create-conversation"
              >
                {createConvMutation.isPending && (
                  <Loader2 className="w-3 h-3 animate-spin mr-2" />
                )}
                Done
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Reminder dialog */}
      <Dialog open={showRemind} onOpenChange={setShowRemind}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set a reminder</DialogTitle>
            <DialogDescription>
              We'll surface this conversation in your reminder bell when due.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="mb-1.5 block">Remind me at</Label>
              <Input
                type="datetime-local"
                value={remindAt}
                onChange={(e) => setRemindAt(e.target.value)}
                data-testid="input-remind-at"
              />
              <div className="flex gap-1.5 mt-2">
                {[
                  { label: "+15m", min: 15 },
                  { label: "+1h", min: 60 },
                  { label: "+4h", min: 240 },
                  { label: "Tomorrow 9am", min: -1 },
                ].map((q) => (
                  <Button
                    key={q.label}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      const d =
                        q.min === -1
                          ? (() => {
                              const t = new Date();
                              t.setDate(t.getDate() + 1);
                              t.setHours(9, 0, 0, 0);
                              return t;
                            })()
                          : new Date(Date.now() + q.min * 60 * 1000);
                      const pad = (n: number) => String(n).padStart(2, "0");
                      setRemindAt(
                        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
                      );
                    }}
                  >
                    {q.label}
                  </Button>
                ))}
              </div>
            </div>
            <div>
              <Label className="mb-1.5 block">Note (optional)</Label>
              <Textarea
                value={remindNote}
                onChange={(e) => setRemindNote(e.target.value)}
                placeholder="Follow up about pricing..."
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRemind(false)}>
              Cancel
            </Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700"
              disabled={createReminder.isPending || !remindAt || !selectedId}
              onClick={() => {
                if (!selectedId || !remindAt) return;
                createReminder.mutate({
                  data: {
                    conversationId: selectedId,
                    remindAt: new Date(remindAt).toISOString(),
                    note: remindNote.trim() || null,
                  },
                });
              }}
              data-testid="button-confirm-remind"
            >
              {createReminder.isPending && <Loader2 className="w-3 h-3 animate-spin mr-2" />}
              Set reminder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Contact info card / edit (opened by clicking the conversation header) */}
      <Sheet open={showContactCard} onOpenChange={setShowContactCard}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto p-0">
          {editingContact ? (
            <form onSubmit={handleSaveContact} className="flex flex-col h-full">
              <SheetHeader className="px-6 py-4 border-b border-slate-200">
                <SheetTitle>Edit Contact</SheetTitle>
              </SheetHeader>
              <div className="flex-1 space-y-4 px-6 py-5">
                <div>
                  <Label className="mb-1.5 block">Name</Label>
                  <Input
                    value={contactDraft.name}
                    onChange={(e) => setContactDraft({ ...contactDraft, name: e.target.value })}
                    placeholder="Full name"
                    autoFocus
                    data-testid="input-contact-name"
                  />
                </div>
                <div>
                  <Label className="mb-1.5 block">Number</Label>
                  <Input value={formatPhone(contactPhone)} disabled className="bg-slate-50" />
                  <p className="text-xs text-slate-400 mt-1">Phone numbers cannot be changed.</p>
                </div>
                <div>
                  <Label className="mb-1.5 block">Preferred Language</Label>
                  <Select
                    value={contactDraft.preferredLanguage || undefined}
                    onValueChange={(v) => setContactDraft({ ...contactDraft, preferredLanguage: v })}
                  >
                    <SelectTrigger data-testid="select-contact-language">
                      <SelectValue placeholder="Select a language" />
                    </SelectTrigger>
                    <SelectContent>
                      {PREFERRED_LANGUAGES.map((lang) => (
                        <SelectItem key={lang} value={lang}>
                          {lang}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1.5 block">Email</Label>
                  <Input
                    type="email"
                    value={contactDraft.email}
                    onChange={(e) => setContactDraft({ ...contactDraft, email: e.target.value })}
                    placeholder="name@example.com"
                    data-testid="input-contact-email"
                  />
                </div>
                <div>
                  <Label className="mb-1.5 block">Tags (comma separated)</Label>
                  <Input
                    value={contactDraft.tagsCsv}
                    onChange={(e) => setContactDraft({ ...contactDraft, tagsCsv: e.target.value })}
                    placeholder="vip, spanish, returning"
                    data-testid="input-contact-tags"
                  />
                </div>
                <div>
                  <Label className="mb-1.5 block">Notes</Label>
                  <Textarea
                    value={contactDraft.notes}
                    onChange={(e) => setContactDraft({ ...contactDraft, notes: e.target.value })}
                    rows={3}
                    data-testid="input-contact-notes"
                  />
                </div>
              </div>
              {contactSaveError && (
                <p
                  className="px-6 pb-2 text-sm text-red-600"
                  data-testid="text-contact-save-error"
                >
                  {contactSaveError}
                </p>
              )}
              <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-200">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditingContact(false)}
                  data-testid="button-cancel-contact"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="bg-blue-600 hover:bg-blue-700"
                  disabled={contactSaving}
                  data-testid="button-save-contact"
                >
                  {contactSaving && <Loader2 className="w-3 h-3 animate-spin mr-2" />}
                  Save
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex flex-col h-full">
              <SheetHeader className="relative px-6 pt-12 pb-4 border-b border-slate-200">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="absolute left-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                      data-testid="button-contact-menu"
                    >
                      <MoreVertical className="h-4 w-4" />
                      <span className="sr-only">Contact actions</span>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={openContactEdit} data-testid="menu-edit-contact">
                      <PencilLine className="w-4 h-4 mr-2" />
                      Edit
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 flex-shrink-0">
                    <User className="w-6 h-6" />
                  </div>
                  <div className="min-w-0">
                    <SheetTitle className="truncate">
                      {existingContact?.name ||
                        (selectedConv?.contactName && selectedConv.contactName !== contactPhone
                          ? selectedConv.contactName
                          : formatPhone(contactPhone))}
                    </SheetTitle>
                    <p className="text-xs text-slate-500 mt-0.5">{formatPhone(contactPhone)}</p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 flex-shrink-0"
                        data-testid="button-contact-menu"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={openContactEdit} data-testid="menu-edit-contact">
                        <PencilLine className="w-4 h-4 mr-2" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={handleViewInAddressBook}
                        data-testid="menu-view-address-book"
                      >
                        <BookUser className="w-4 h-4 mr-2" />
                        View in address book
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setContactConfirm("archive")}
                        data-testid="menu-archive-contact"
                      >
                        <Archive className="w-4 h-4 mr-2" />
                        Archive conversation
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setContactConfirm("unsubscribe")}
                        data-testid="menu-unsubscribe-contact"
                      >
                        <BellOff className="w-4 h-4 mr-2" />
                        Unsubscribe
                      </DropdownMenuItem>
                      {existingContact?.blocked ? (
                        <DropdownMenuItem
                          onClick={handleUnblock}
                          data-testid="menu-unblock-contact"
                        >
                          <Ban className="w-4 h-4 mr-2" />
                          Unblock
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          onClick={() => setContactConfirm("block")}
                          className="text-red-600 focus:text-red-600"
                          data-testid="menu-block-contact"
                        >
                          <Ban className="w-4 h-4 mr-2" />
                          Block
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </SheetHeader>

              <div className="flex-1 px-6 py-5 space-y-5">
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">
                    Info
                  </h4>
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <Phone className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs text-slate-400">Number</p>
                        <p className="text-sm text-slate-700">{formatPhone(contactPhone)}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Mail className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs text-slate-400">Email</p>
                        <p className="text-sm text-slate-700 break-all">
                          {existingContact?.email || <span className="text-slate-400">—</span>}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Globe className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs text-slate-400">Preferred Language</p>
                        <p className="text-sm text-slate-700">
                          {existingContact?.preferredLanguage || (
                            <span className="text-slate-400">—</span>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <MapPin className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs text-slate-400">Location</p>
                        <p className="text-sm text-slate-700">
                          {existingContact?.location ||
                            selectedConv?.contactLocation || (
                              <span className="text-slate-400">—</span>
                            )}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {existingContact?.tags && existingContact.tags.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2 flex items-center gap-1.5">
                      <Tag className="w-3 h-3" /> Tags
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {existingContact.tags.map((t) => (
                        <Badge key={t} variant="secondary" className="text-xs">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {existingContact?.notes && (
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2 flex items-center gap-1.5">
                      <StickyNote className="w-3 h-3" /> Notes
                    </h4>
                    <p className="text-sm text-slate-600 whitespace-pre-wrap">
                      {existingContact.notes}
                    </p>
                  </div>
                )}
              </div>

              <div className="px-6 py-4 border-t border-slate-200">
                <Button
                  className="w-full bg-blue-600 hover:bg-blue-700"
                  onClick={openContactEdit}
                  data-testid="button-edit-contact"
                >
                  <PencilLine className="w-4 h-4 mr-2" />
                  Edit Contact
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={contactConfirm !== null}
        onOpenChange={(open) => {
          if (!open) setContactConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {contactConfirm === "block" && "Block this contact?"}
              {contactConfirm === "archive" && "Archive this conversation?"}
              {contactConfirm === "unsubscribe" && "Unsubscribe this contact?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {contactConfirm === "block" &&
                `${formatPhone(contactPhone)} will be blocked. You won't be able to send them messages until you unblock them.`}
              {contactConfirm === "archive" &&
                "This conversation will be marked closed and removed from your open inbox. You can reopen it later."}
              {contactConfirm === "unsubscribe" &&
                `${formatPhone(contactPhone)} will be opted out (STOP). They won't receive any further outbound messages.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-contact-action">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmContactAction();
              }}
              disabled={contactActionPending}
              className={
                contactConfirm === "archive"
                  ? undefined
                  : "bg-red-600 hover:bg-red-700"
              }
              data-testid="button-confirm-contact-action"
            >
              {contactActionPending && (
                <Loader2 className="w-3 h-3 animate-spin mr-2" />
              )}
              {contactConfirm === "block" && "Block"}
              {contactConfirm === "archive" && "Archive"}
              {contactConfirm === "unsubscribe" && "Unsubscribe"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
