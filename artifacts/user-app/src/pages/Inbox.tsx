import {
  useListConversations,
  useGetConversation,
  useListMessages,
  useSendMessage,
  useListDepartments,
  useListAgents,
  useClaimConversation,
  useTransferConversation,
  useUnassignConversation,
  useListConversationEvents,
  getListMessagesQueryKey,
  getListConversationsQueryKey,
  getGetConversationQueryKey,
  getListConversationEventsQueryKey,
} from "@workspace/api-client-react";
import { useState, useRef, useEffect, useMemo } from "react";
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
  UserX,
  History,
  Loader2,
  Circle,
} from "lucide-react";
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

export default function Inbox() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [composeText, setComposeText] = useState("");
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferTarget, setTransferTarget] = useState<string>("");
  const [transferNote, setTransferNote] = useState("");
  const [showEvents, setShowEvents] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: departments } = useListDepartments();
  const { data: agents } = useListAgents();

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

  const filterParams =
    deptFilter === "all" ? undefined : { departmentId: Number(deptFilter) };

  const { data: conversations, isLoading: loadingConversations } =
    useListConversations(filterParams, {
      query: {
        queryKey: getListConversationsQueryKey(filterParams),
        refetchInterval: 10000,
      },
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
        refetchInterval: 5000,
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

  const claimMutation = useClaimConversation({
    mutation: { onSuccess: invalidateConv },
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

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!composeText.trim() || !selectedId) return;

    sendMessage.mutate({
      id: selectedId,
      data: { body: composeText },
    });
  };

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
              placeholder="Search conversations..."
              className="pl-9 bg-slate-50 border-slate-200 focus-visible:ring-blue-500"
            />
          </div>
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
            <div className="divide-y divide-slate-100">
              {conversations?.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => setSelectedId(conv.id)}
                  className={`w-full text-left p-4 hover:bg-blue-50/50 transition-colors ${
                    selectedId === conv.id
                      ? "bg-blue-50 border-l-4 border-blue-500"
                      : "border-l-4 border-transparent"
                  }`}
                >
                  <div className="flex justify-between items-start mb-1">
                    <span className="font-semibold text-sm text-slate-900 truncate pr-2">
                      {conv.contactName || conv.contactPhone}
                    </span>
                    {conv.lastMessageAt && (
                      <span className="text-xs text-slate-400 flex-shrink-0 whitespace-nowrap">
                        {format(
                          new Date(conv.lastMessageAt),
                          "MMM d, h:mm a",
                        )}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span className="truncate pr-4">{conv.contactPhone}</span>
                    {conv.status === "open" ? (
                      <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                    ) : (
                      <CheckCircle2 className="w-3 h-3 text-slate-400" />
                    )}
                  </div>
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
                    {!conv.assignedUserId && conv.status === "open" && (
                      <Badge
                        variant="outline"
                        className="text-[9px] h-4 px-1.5 border-amber-300 text-amber-600 bg-amber-50"
                      >
                        Unassigned
                      </Badge>
                    )}
                  </div>
                </button>
              ))}
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
                      selectedConv?.contactName || selectedConv?.contactPhone
                    )}
                  </h2>
                  <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                    <Phone className="w-3 h-3" />
                    {selectedConv?.contactPhone}
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
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                {!selectedConv?.assignedUserId && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs font-medium gap-1.5 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                    disabled={claimMutation.isPending}
                    onClick={() =>
                      claimMutation.mutate({ id: selectedId })
                    }
                  >
                    {claimMutation.isPending ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Hand className="w-3 h-3" />
                    )}
                    Claim
                  </Button>
                )}

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
                        {format(new Date(evt.createdAt), "h:mm a")}
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
                    const isOutbound = msg.direction === "outbound";
                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col ${isOutbound ? "items-end" : "items-start"}`}
                      >
                        <div className="flex items-end gap-2 max-w-[75%]">
                          <div
                            className={`px-4 py-2.5 text-sm ${
                              isOutbound
                                ? "bg-blue-600 text-white rounded-2xl rounded-br-sm"
                                : "bg-white border border-slate-200 text-slate-900 rounded-2xl rounded-bl-sm shadow-sm"
                            }`}
                          >
                            {msg.body}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 mt-1.5 px-1">
                          <span className="text-[10px] font-medium text-slate-400">
                            {format(new Date(msg.createdAt), "h:mm a")}
                          </span>
                          {isOutbound && msg.senderName && (
                            <>
                              <span className="w-0.5 h-0.5 rounded-full bg-slate-300"></span>
                              <span className="text-[10px] text-slate-400">
                                {msg.senderName}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </ScrollArea>

            {/* Compose Area */}
            <div className="p-4 border-t border-slate-200 bg-white">
              <form onSubmit={handleSend} className="flex items-end gap-2">
                <div className="flex-1 relative">
                  <Input
                    value={composeText}
                    onChange={(e) => setComposeText(e.target.value)}
                    placeholder="Type a message..."
                    className="pr-12 py-3 bg-slate-50 border-slate-200 focus-visible:ring-blue-500 rounded-xl"
                  />
                </div>
                <Button
                  type="submit"
                  size="icon"
                  className="rounded-xl h-11 w-11 bg-blue-600 hover:bg-blue-700 shrink-0"
                  disabled={!composeText.trim() || sendMessage.isPending}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </form>
              <div className="flex justify-between items-center mt-2 px-1">
                <span className="text-[10px] text-slate-400 font-medium">
                  Press Enter to send
                </span>
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
          </div>
        )}
      </div>
    </div>
  );
}
