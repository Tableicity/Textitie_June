import { useState, useMemo, useEffect } from "react";
import { useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListContacts,
  useListContactTags,
  useCreateContact,
  useUpdateContact,
  useDeleteContact,
  useGetContact,
  getListContactsQueryKey,
  getListContactTagsQueryKey,
  getGetContactQueryKey,
  type Contact,
} from "@workspace/api-client-react";
import { format } from "date-fns";
import {
  Users,
  Plus,
  Search,
  Trash2,
  Edit2,
  Phone,
  Mail,
  MessageSquare,
  Tag,
  Loader2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ContactDraft = {
  phone: string;
  name: string;
  email: string;
  location: string;
  notes: string;
  tagsCsv: string;
};

const blankDraft: ContactDraft = { phone: "", name: "", email: "", location: "", notes: "", tagsCsv: "" };

function csvToTags(s: string): string[] | null {
  const arr = s
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return arr.length ? arr : null;
}

export default function Contacts() {
  const queryClient = useQueryClient();
  const searchString = useSearch();
  const [search, setSearch] = useState("");

  // Prefill the search box from the ?q= URL param (e.g. "View in address book"
  // jump from the inbox contact card).
  useEffect(() => {
    const q = new URLSearchParams(searchString).get("q");
    if (q) setSearch(q);
  }, [searchString]);
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<ContactDraft>(blankDraft);

  const listParams = useMemo(
    () => ({
      ...(search ? { q: search } : {}),
      ...(tagFilter !== "all" ? { tag: tagFilter } : {}),
    }),
    [search, tagFilter],
  );

  const { data: contacts, isLoading } = useListContacts(listParams, {
    query: {
      queryKey: getListContactsQueryKey(listParams),
    },
  });

  const { data: allTags } = useListContactTags({
    query: { queryKey: getListContactTagsQueryKey() },
  });

  const { data: detail } = useGetContact(selectedId as number, {
    query: {
      enabled: !!selectedId,
      queryKey: getGetContactQueryKey(selectedId as number),
    },
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: getListContactsQueryKey(listParams) });
    queryClient.invalidateQueries({ queryKey: getListContactTagsQueryKey() });
    if (selectedId) {
      queryClient.invalidateQueries({ queryKey: getGetContactQueryKey(selectedId) });
    }
    // Conversation list/detail responses include contactLocation via leftJoin,
    // so a contact edit needs to bust those caches too.
    queryClient.invalidateQueries({
      predicate: (q) => {
        const k = q.queryKey?.[0];
        return typeof k === "string" && k.startsWith("/api/conversations");
      },
    });
  };

  const createMutation = useCreateContact({
    mutation: {
      onSuccess: () => {
        invalidateAll();
        setCreating(false);
        setDraft(blankDraft);
      },
    },
  });

  const updateMutation = useUpdateContact({
    mutation: {
      onSuccess: () => {
        invalidateAll();
        setEditing(null);
      },
    },
  });

  const deleteMutation = useDeleteContact({
    mutation: {
      onSuccess: () => {
        invalidateAll();
        setSelectedId(null);
      },
    },
  });

  const startEdit = (c: Contact) => {
    setEditing(c);
    setDraft({
      phone: c.phone,
      name: c.name ?? "",
      email: c.email ?? "",
      location: c.location ?? "",
      notes: c.notes ?? "",
      tagsCsv: (c.tags ?? []).join(", "),
    });
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.phone.trim()) return;
    createMutation.mutate({
      data: {
        phone: draft.phone.trim(),
        name: draft.name.trim() || null,
        email: draft.email.trim() || null,
        location: draft.location.trim() || null,
        notes: draft.notes.trim() || null,
        tags: csvToTags(draft.tagsCsv),
      },
    });
  };

  const handleUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    updateMutation.mutate({
      id: editing.id,
      data: {
        name: draft.name.trim() || null,
        email: draft.email.trim() || null,
        location: draft.location.trim() || null,
        notes: draft.notes.trim() || null,
        tags: csvToTags(draft.tagsCsv),
      },
    });
  };

  return (
    <div className="h-full flex flex-col bg-slate-50 overflow-hidden">
      <div className="border-b border-slate-200 bg-white px-8 py-6 flex-shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center">
            <Users className="w-5 h-5 text-slate-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Contacts</h1>
            <p className="text-slate-500 text-sm mt-1">
              People you've messaged with — manage names, tags, and notes.
            </p>
          </div>
        </div>
        <Button
          className="bg-blue-600 hover:bg-blue-700"
          onClick={() => {
            setDraft(blankDraft);
            setCreating(true);
          }}
          data-testid="button-new-contact"
        >
          <Plus className="w-4 h-4 mr-2" /> New Contact
        </Button>
      </div>

      <div className="flex-1 flex divide-x divide-slate-200 overflow-hidden">
        {/* List */}
        <div className="w-[420px] flex flex-col bg-white flex-shrink-0">
          <div className="p-4 border-b border-slate-200 space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, phone, or email..."
                className="pl-9 bg-slate-50"
                data-testid="input-contact-search"
              />
            </div>
            <Select value={tagFilter} onValueChange={setTagFilter}>
              <SelectTrigger className="h-8 text-xs bg-slate-50">
                <div className="flex items-center gap-1.5">
                  <Tag className="w-3 h-3 text-slate-400" />
                  <SelectValue placeholder="All tags" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All tags</SelectItem>
                {allTags?.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ScrollArea className="flex-1">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : contacts?.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-sm">
                No contacts yet. Click "New Contact" to add one.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {contacts?.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className={`w-full text-left p-4 hover:bg-blue-50/50 transition-colors ${
                      selectedId === c.id ? "bg-blue-50 border-l-4 border-blue-500" : "border-l-4 border-transparent"
                    }`}
                    data-testid={`contact-row-${c.id}`}
                  >
                    <div className="font-semibold text-sm text-slate-900">
                      {c.name || c.phone}
                    </div>
                    <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                      <Phone className="w-3 h-3" /> {c.phone}
                    </div>
                    {c.tags && c.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {c.tags.slice(0, 4).map((t) => (
                          <Badge key={t} variant="outline" className="text-[10px] h-4 px-1.5">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Detail */}
        <div className="flex-1 overflow-auto p-8">
          {!selectedId || !detail ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400">
              <Users className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-sm">Select a contact to view details</p>
            </div>
          ) : (
            <div className="max-w-2xl">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">
                    {detail.name || detail.phone}
                  </h2>
                  <div className="flex items-center gap-3 mt-2 text-sm text-slate-500">
                    <span className="flex items-center gap-1">
                      <Phone className="w-3.5 h-3.5" />
                      {detail.phone}
                    </span>
                    {detail.email && (
                      <span className="flex items-center gap-1">
                        <Mail className="w-3.5 h-3.5" />
                        {detail.email}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => startEdit(detail)}>
                    <Edit2 className="w-3.5 h-3.5 mr-1.5" /> Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-red-600 hover:bg-red-50 border-red-200"
                    onClick={() => {
                      if (confirm(`Delete ${detail.name || detail.phone}?`)) {
                        deleteMutation.mutate({ id: detail.id });
                      }
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              {detail.tags && detail.tags.length > 0 && (
                <div className="mb-6">
                  <Label className="text-xs uppercase tracking-wider text-slate-400 mb-2 block">Tags</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {detail.tags.map((t) => (
                      <Badge key={t} variant="secondary">
                        {t}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {detail.location && (
                <div className="mb-6">
                  <Label className="text-xs uppercase tracking-wider text-slate-400 mb-2 block">Location</Label>
                  <p className="text-sm text-slate-700">{detail.location}</p>
                </div>
              )}

              {detail.notes && (
                <div className="mb-6">
                  <Label className="text-xs uppercase tracking-wider text-slate-400 mb-2 block">Notes</Label>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap bg-slate-50 rounded-lg p-3 border border-slate-200">
                    {detail.notes}
                  </p>
                </div>
              )}

              <div>
                <Label className="text-xs uppercase tracking-wider text-slate-400 mb-2 block">
                  Conversation history
                </Label>
                {detail.conversations.length === 0 ? (
                  <p className="text-sm text-slate-400 italic">No conversations yet.</p>
                ) : (
                  <div className="space-y-2">
                    {detail.conversations.map((c) => (
                      <div
                        key={c.id}
                        className="flex items-center justify-between p-3 border border-slate-200 rounded-lg bg-white"
                      >
                        <div className="flex items-center gap-3">
                          <MessageSquare className="w-4 h-4 text-slate-400" />
                          <div>
                            <div className="text-sm font-medium text-slate-900">
                              Conversation #{c.id}
                            </div>
                            <div className="text-xs text-slate-500">
                              {c.lastMessageAt
                                ? `Last activity ${format(new Date(c.lastMessageAt), "MMM d, h:mm a")}`
                                : `Started ${format(new Date(c.createdAt), "MMM d, h:mm a")}`}
                            </div>
                          </div>
                        </div>
                        <Badge variant={c.status === "open" ? "default" : "outline"}>
                          {c.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Create dialog */}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New contact</DialogTitle>
            <DialogDescription>Add someone to your contacts.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4 py-2">
            <div>
              <Label className="mb-1.5 block">Phone *</Label>
              <Input
                value={draft.phone}
                onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                placeholder="+15551234567"
                required
                data-testid="input-new-contact-phone"
              />
            </div>
            <div>
              <Label className="mb-1.5 block">Name</Label>
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Jane Doe"
              />
            </div>
            <div>
              <Label className="mb-1.5 block">Email</Label>
              <Input
                type="email"
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                placeholder="jane@example.com"
              />
            </div>
            <div>
              <Label className="mb-1.5 block">Location</Label>
              <Input
                value={draft.location}
                onChange={(e) => setDraft({ ...draft, location: e.target.value })}
                placeholder="Santa Clarita, California, US"
                data-testid="input-new-contact-location"
              />
            </div>
            <div>
              <Label className="mb-1.5 block">Tags (comma separated)</Label>
              <Input
                value={draft.tagsCsv}
                onChange={(e) => setDraft({ ...draft, tagsCsv: e.target.value })}
                placeholder="vip, lead"
              />
            </div>
            <div>
              <Label className="mb-1.5 block">Notes</Label>
              <Textarea
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                rows={3}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-blue-600 hover:bg-blue-700"
                disabled={createMutation.isPending || !draft.phone.trim()}
                data-testid="button-save-new-contact"
              >
                {createMutation.isPending && <Loader2 className="w-3 h-3 animate-spin mr-2" />}
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit contact</DialogTitle>
            <DialogDescription>Phone numbers cannot be changed.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUpdate} className="space-y-4 py-2">
            <div>
              <Label className="mb-1.5 block text-slate-400">Phone</Label>
              <Input value={draft.phone} disabled />
            </div>
            <div>
              <Label className="mb-1.5 block">Name</Label>
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>
            <div>
              <Label className="mb-1.5 block">Email</Label>
              <Input
                type="email"
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
              />
            </div>
            <div>
              <Label className="mb-1.5 block">Location</Label>
              <Input
                value={draft.location}
                onChange={(e) => setDraft({ ...draft, location: e.target.value })}
                placeholder="Santa Clarita, California, US"
                data-testid="input-edit-contact-location"
              />
            </div>
            <div>
              <Label className="mb-1.5 block">Tags (comma separated)</Label>
              <Input
                value={draft.tagsCsv}
                onChange={(e) => setDraft({ ...draft, tagsCsv: e.target.value })}
              />
            </div>
            <div>
              <Label className="mb-1.5 block">Notes</Label>
              <Textarea
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                rows={3}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-blue-600 hover:bg-blue-700"
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending && <Loader2 className="w-3 h-3 animate-spin mr-2" />}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
