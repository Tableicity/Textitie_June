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
  getListMessagesQueryKey,
  getListConversationsQueryKey,
  getGetConversationQueryKey,
  getListConversationEventsQueryKey,
  getListShortcutsQueryKey,
  getListDispositionsQueryKey,
  getListRemindersQueryKey,
} from "@workspace/api-client-react";
import { useSearch, Link } from "wouter";
import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useRealtimeInbox } from "@/hooks/useRealtimeInbox";
import { format } from "date-fns";
import {
  Search,
  Send,
  Clock,
  User,
  Phone,
  PhoneCall,
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
} from "lucide-react";
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
import { useQueryClient } from "@tanstack/react-query";
import { formatPhone, cityStateForPhone, toE164 } from "@/lib/phone";

export default function Inbox() {
  const queryClient = useQueryClient();
  useRealtimeInbox();
  const searchString = useSearch();
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
  const COMPOSE_MAX_CHARS = 1000;
  const COMMON_EMOJIS = [
    "😀","😂","😉","😍","🥰","😎","🤔","🙏",
    "👍","👏","🙌","💪","✅","❌","🔥","🎉",
    "❤️","💙","💯","⭐","☀️","🚗","📞","📅",
  ];
  const [showEmoji, setShowEmoji] = useState(false);
  const [showAttach, setShowAttach] = useState(false);

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

  const { data: events } = useListConversationEvents(selectedId as number, {
    query: {
      enabled: !!selectedId && showEvents,
      queryKey: getListConversationEventsQueryKey(selectedId as number),
    },
  });

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
          queryClient.invalidateQueries({
            queryKey: getListMessagesQueryKey(selectedId),
          });
          queryClient.invalidateQueries({
            queryKey: getListConversationsQueryKey(),
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
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                  <User className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="font-semibold text-slate-900 leading-tight">
                    {loadingConv ? (
                      <Skeleton className="h-5 w-32" />
                    ) : (
                      selectedConv?.contactName || formatPhone(selectedConv?.contactPhone)
                    )}
                  </h2>
                  <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                    <Phone className="w-3 h-3" />
                    {formatPhone(selectedConv?.contactPhone)}
                    <span className="w-1 h-1 rounded-full bg-slate-300 mx-1"></span>
                    <span className="capitalize">{selectedConv?.status}</span>
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
              </div>

              <div className="flex items-center gap-1.5">
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
                <Link href="/settings?tab=phone-numbers">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs font-medium gap-1.5"
                    title="Phone Numbers"
                    aria-label="Phone Numbers"
                    data-testid="button-phone-numbers"
                  >
                    <PhoneCall className="w-3.5 h-3.5" />
                    Phone Numbers
                  </Button>
                </Link>
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
                <form onSubmit={handleSend} className="flex items-end gap-2">
                  <div className="flex items-end gap-0.5">
                  {!selectedConv?.assignedUserId && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-[66px] px-2 text-xs font-medium gap-1.5 border-0 text-emerald-700 hover:bg-emerald-50 shrink-0 rounded-xl"
                      disabled={claimMutation.isPending}
                      onClick={() =>
                        claimMutation.mutate({ id: selectedId })
                      }
                      data-testid="button-claim"
                    >
                      {claimMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Hand className="w-4 h-4" />
                      )}
                      Claim
                    </Button>
                  )}
                  <button
                    type="button"
                    onClick={() => setIsWhisperMode((m) => !m)}
                    className={`h-[66px] w-[52px] rounded-xl flex items-center justify-center shrink-0 transition-colors border-0 ${
                      isWhisperMode
                        ? "bg-amber-100 text-amber-700 ring-2 ring-amber-400"
                        : "bg-transparent text-slate-400 hover:text-slate-700 hover:bg-slate-100"
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
                        className="h-[66px] w-[52px] rounded-xl flex items-center justify-center shrink-0 transition-colors border-0 bg-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                        title="Insert emoji"
                        data-testid="button-emoji"
                      >
                        <span className="text-[17px] leading-none">😊</span>
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
                    className="h-[66px] w-[52px] rounded-xl flex items-center justify-center shrink-0 transition-colors border-0 bg-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                    title="Attach photo or PDF"
                    data-testid="button-attach"
                  >
                    <Paperclip className="w-5 h-5" />
                  </button>
                  </div>
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
                    className={`rounded-xl h-[66px] w-[66px] shrink-0 ${
                      isWhisperMode ? "bg-amber-600 hover:bg-amber-700" : "bg-blue-600 hover:bg-blue-700"
                    }`}
                    disabled={!composeText.trim() || composerBusy}
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
    </div>
  );
}
