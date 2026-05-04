import { useListConversations, useGetConversation, useListMessages, useSendMessage, getListMessagesQueryKey, getListConversationsQueryKey, getGetConversationQueryKey } from "@workspace/api-client-react";
import { useState, useRef, useEffect } from "react";
import { format } from "date-fns";
import { Search, Send, Clock, User, Phone, CheckCircle2, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryClient } from "@tanstack/react-query";

export default function Inbox() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [composeText, setComposeText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: conversations, isLoading: loadingConversations } = useListConversations({
    query: {
      queryKey: getListConversationsQueryKey(),
      refetchInterval: 10000,
    }
  });

  const { data: selectedConv, isLoading: loadingConv } = useGetConversation(
    selectedId as number,
    { query: { enabled: !!selectedId, queryKey: getGetConversationQueryKey(selectedId as number) } }
  );

  const { data: messages, isLoading: loadingMessages } = useListMessages(
    selectedId as number,
    { 
      query: { 
        enabled: !!selectedId, 
        queryKey: getListMessagesQueryKey(selectedId as number),
        refetchInterval: 5000 
      } 
    }
  );

  const sendMessage = useSendMessage({
    mutation: {
      onSuccess: () => {
        setComposeText("");
        if (selectedId) {
          queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(selectedId) });
          queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
        }
      }
    }
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
      data: { body: composeText }
    });
  };

  return (
    <div className="flex h-full bg-white divide-x divide-slate-200">
      {/* Left Panel: Conversation List */}
      <div className="w-80 flex flex-col bg-slate-50 flex-shrink-0">
        <div className="p-4 border-b border-slate-200 bg-white">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input 
              placeholder="Search conversations..." 
              className="pl-9 bg-slate-50 border-slate-200 focus-visible:ring-blue-500"
            />
          </div>
        </div>
        
        <ScrollArea className="flex-1">
          {loadingConversations ? (
            <div className="p-4 space-y-4">
              {[1, 2, 3].map(i => (
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
                    selectedId === conv.id ? 'bg-blue-50 border-l-4 border-blue-500' : 'border-l-4 border-transparent'
                  }`}
                >
                  <div className="flex justify-between items-start mb-1">
                    <span className="font-semibold text-sm text-slate-900 truncate pr-2">
                      {conv.contactName || conv.contactPhone}
                    </span>
                    {conv.lastMessageAt && (
                      <span className="text-xs text-slate-400 flex-shrink-0 whitespace-nowrap">
                        {format(new Date(conv.lastMessageAt), "MMM d, h:mm a")}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span className="truncate pr-4">{conv.contactPhone}</span>
                    {conv.status === 'open' ? (
                      <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                    ) : (
                      <CheckCircle2 className="w-3 h-3 text-slate-400" />
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
            <div className="h-16 border-b border-slate-200 px-6 flex items-center justify-between flex-shrink-0 bg-white z-10">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                  <User className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="font-semibold text-slate-900 leading-tight">
                    {loadingConv ? <Skeleton className="h-5 w-32" /> : (selectedConv?.contactName || selectedConv?.contactPhone)}
                  </h2>
                  <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                    <Phone className="w-3 h-3" />
                    {selectedConv?.contactPhone}
                    <span className="w-1 h-1 rounded-full bg-slate-300 mx-1"></span>
                    <span className="capitalize">{selectedConv?.status}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="h-8 text-xs font-medium">
                  {selectedConv?.status === 'open' ? 'Close' : 'Reopen'}
                </Button>
              </div>
            </div>

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
                  {messages?.map((msg, i) => {
                    const isOutbound = msg.direction === 'outbound';
                    return (
                      <div key={msg.id} className={`flex flex-col ${isOutbound ? 'items-end' : 'items-start'}`}>
                        <div className="flex items-end gap-2 max-w-[75%]">
                          <div 
                            className={`px-4 py-2.5 text-sm ${
                              isOutbound 
                                ? 'bg-blue-600 text-white rounded-2xl rounded-br-sm' 
                                : 'bg-white border border-slate-200 text-slate-900 rounded-2xl rounded-bl-sm shadow-sm'
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
                              <span className="text-[10px] text-slate-400">{msg.senderName}</span>
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
                <span className="text-[10px] text-slate-400 font-medium">Press Enter to send</span>
              </div>
            </div>
          </>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 bg-slate-50/30">
            <div className="w-16 h-16 rounded-full bg-white shadow-sm border border-slate-100 flex items-center justify-center mb-4">
              <MessageSquare className="w-6 h-6 text-slate-300" />
            </div>
            <p className="text-sm font-medium text-slate-500">Select a conversation to start messaging</p>
          </div>
        )}
      </div>
    </div>
  );
}