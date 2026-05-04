import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAutomations,
  useCreateAutomation,
  useUpdateAutomation,
  useDeleteAutomation,
  useListShortcuts,
  useCreateShortcut,
  useUpdateShortcut,
  useDeleteShortcut,
  useListOptOuts,
  useDeleteOptOut,
  getListAutomationsQueryKey,
  getListShortcutsQueryKey,
  getListOptOutsQueryKey,
} from "@workspace/api-client-react";
import {
  Zap,
  Plus,
  Pencil,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Clock,
  MessageSquareText,
  ShieldOff,
  HandMetal,
  Timer,
  FileX2,
  Loader2,
  Command,
  PhoneOff,
  X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Textarea } from "@/components/ui/textarea";
import { format } from "date-fns";

const RULE_TYPE_META: Record<string, { label: string; icon: React.ReactNode; color: string; description: string }> = {
  keyword_reply: { label: "Keyword Auto-Reply", icon: <MessageSquareText className="w-4 h-4" />, color: "bg-blue-100 text-blue-700", description: "Automatically reply when a message contains specific keywords" },
  follow_up_timer: { label: "Follow-up Timer", icon: <Timer className="w-4 h-4" />, color: "bg-amber-100 text-amber-700", description: "Send a follow-up after a period of inactivity" },
  auto_resolve: { label: "Auto-resolve", icon: <FileX2 className="w-4 h-4" />, color: "bg-purple-100 text-purple-700", description: "Automatically close conversations after inactivity" },
  welcome_message: { label: "Welcome Message", icon: <HandMetal className="w-4 h-4" />, color: "bg-emerald-100 text-emerald-700", description: "Greet new contacts with an automatic message" },
  auto_unsubscribe: { label: "TCPA Opt-out", icon: <ShieldOff className="w-4 h-4" />, color: "bg-red-100 text-red-700", description: "Handle STOP/END/UNSUBSCRIBE keywords for TCPA compliance" },
};

interface RuleForm {
  type: string;
  name: string;
  enabled: boolean;
  keywords: string;
  matchType: string;
  replyBody: string;
  inactiveHours: string;
  priority: string;
}

const emptyForm: RuleForm = {
  type: "keyword_reply",
  name: "",
  enabled: true,
  keywords: "",
  matchType: "contains",
  replyBody: "",
  inactiveHours: "24",
  priority: "0",
};

interface ShortcutForm {
  name: string;
  shortcutKey: string;
  body: string;
  category: string;
}

const emptyShortcutForm: ShortcutForm = {
  name: "",
  shortcutKey: "/",
  body: "",
  category: "",
};

export default function Automations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("rules");
  const [showRuleDialog, setShowRuleDialog] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null);
  const [ruleForm, setRuleForm] = useState<RuleForm>(emptyForm);
  const [showShortcutDialog, setShowShortcutDialog] = useState(false);
  const [editingShortcutId, setEditingShortcutId] = useState<number | null>(null);
  const [shortcutForm, setShortcutForm] = useState<ShortcutForm>(emptyShortcutForm);
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: "rule" | "shortcut" | "optout"; id: number } | null>(null);

  const { data: rules, isLoading: loadingRules } = useListAutomations({ query: { queryKey: getListAutomationsQueryKey() } });
  const { data: shortcuts, isLoading: loadingShortcuts } = useListShortcuts({ query: { queryKey: getListShortcutsQueryKey() } });
  const { data: optOuts, isLoading: loadingOptOuts } = useListOptOuts({ query: { queryKey: getListOptOutsQueryKey() } });

  const invalidateRules = () => queryClient.invalidateQueries({ queryKey: getListAutomationsQueryKey() });
  const invalidateShortcuts = () => queryClient.invalidateQueries({ queryKey: getListShortcutsQueryKey() });
  const invalidateOptOuts = () => queryClient.invalidateQueries({ queryKey: getListOptOutsQueryKey() });

  const createRule = useCreateAutomation({ mutation: { onSuccess: () => { invalidateRules(); setShowRuleDialog(false); toast({ title: "Automation created" }); } } });
  const updateRule = useUpdateAutomation({ mutation: { onSuccess: () => { invalidateRules(); setShowRuleDialog(false); toast({ title: "Automation updated" }); } } });
  const deleteRule = useDeleteAutomation({ mutation: { onSuccess: () => { invalidateRules(); setDeleteConfirm(null); toast({ title: "Automation deleted" }); } } });
  const toggleRule = useUpdateAutomation({ mutation: { onSuccess: invalidateRules } });

  const createShortcut = useCreateShortcut({ mutation: { onSuccess: () => { invalidateShortcuts(); setShowShortcutDialog(false); toast({ title: "Shortcut created" }); } } });
  const updateShortcut = useUpdateShortcut({ mutation: { onSuccess: () => { invalidateShortcuts(); setShowShortcutDialog(false); toast({ title: "Shortcut updated" }); } } });
  const deleteShortcut = useDeleteShortcut({ mutation: { onSuccess: () => { invalidateShortcuts(); setDeleteConfirm(null); toast({ title: "Shortcut deleted" }); } } });

  const deleteOptOut = useDeleteOptOut({ mutation: { onSuccess: () => { invalidateOptOuts(); setDeleteConfirm(null); toast({ title: "Opt-out removed" }); } } });

  const openNewRule = () => {
    setEditingRuleId(null);
    setRuleForm(emptyForm);
    setShowRuleDialog(true);
  };

  const openEditRule = (rule: NonNullable<typeof rules>[0]) => {
    const trigger = rule.triggerConfig as Record<string, unknown>;
    const action = rule.actionConfig as Record<string, unknown>;
    setEditingRuleId(rule.id);
    setRuleForm({
      type: rule.type,
      name: rule.name,
      enabled: rule.enabled,
      keywords: Array.isArray(trigger?.keywords) ? (trigger.keywords as string[]).join(", ") : "",
      matchType: (trigger?.matchType as string) || "contains",
      replyBody: (action?.replyBody as string) || "",
      inactiveHours: trigger?.inactiveHours ? String(trigger.inactiveHours) : "24",
      priority: String(rule.priority),
    });
    setShowRuleDialog(true);
  };

  const saveRule = () => {
    const triggerConfig: Record<string, unknown> = {};
    const actionConfig: Record<string, unknown> = {};

    if (ruleForm.type === "keyword_reply") {
      triggerConfig.keywords = ruleForm.keywords.split(",").map((k) => k.trim()).filter(Boolean);
      triggerConfig.matchType = ruleForm.matchType;
      actionConfig.replyBody = ruleForm.replyBody;
    } else if (ruleForm.type === "follow_up_timer" || ruleForm.type === "auto_resolve") {
      triggerConfig.inactiveHours = Number(ruleForm.inactiveHours) || 24;
      if (ruleForm.replyBody) actionConfig.replyBody = ruleForm.replyBody;
    } else if (ruleForm.type === "welcome_message") {
      actionConfig.replyBody = ruleForm.replyBody;
    }

    const payload = {
      type: ruleForm.type as "keyword_reply" | "follow_up_timer" | "auto_resolve" | "welcome_message" | "auto_unsubscribe",
      name: ruleForm.name,
      enabled: ruleForm.enabled,
      triggerConfig,
      actionConfig,
      priority: Number(ruleForm.priority) || 0,
    };

    if (editingRuleId) {
      updateRule.mutate({ id: editingRuleId, data: payload });
    } else {
      createRule.mutate({ data: payload });
    }
  };

  const openNewShortcut = () => {
    setEditingShortcutId(null);
    setShortcutForm(emptyShortcutForm);
    setShowShortcutDialog(true);
  };

  const openEditShortcut = (s: NonNullable<typeof shortcuts>[0]) => {
    setEditingShortcutId(s.id);
    setShortcutForm({ name: s.name, shortcutKey: s.shortcutKey, body: s.body, category: s.category || "" });
    setShowShortcutDialog(true);
  };

  const saveShortcut = () => {
    const payload = { name: shortcutForm.name, shortcutKey: shortcutForm.shortcutKey, body: shortcutForm.body, category: shortcutForm.category || undefined };
    if (editingShortcutId) {
      updateShortcut.mutate({ id: editingShortcutId, data: payload });
    } else {
      createShortcut.mutate({ data: payload });
    }
  };

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Zap className="w-6 h-6 text-blue-600" />
              Automations
            </h1>
            <p className="text-sm text-slate-500 mt-1">Manage auto-replies, timers, shortcuts, and compliance rules</p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="rules" className="gap-1.5">
              <Zap className="w-4 h-4" />
              Rules ({rules?.length ?? 0})
            </TabsTrigger>
            <TabsTrigger value="shortcuts" className="gap-1.5">
              <Command className="w-4 h-4" />
              Shortcuts ({shortcuts?.length ?? 0})
            </TabsTrigger>
            <TabsTrigger value="optouts" className="gap-1.5">
              <PhoneOff className="w-4 h-4" />
              Opt-outs ({optOuts?.length ?? 0})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="rules" className="space-y-4 mt-4">
            <div className="flex justify-end">
              <Button onClick={openNewRule} className="gap-1.5 bg-blue-600 hover:bg-blue-700">
                <Plus className="w-4 h-4" />
                New Rule
              </Button>
            </div>

            {loadingRules ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
              </div>
            ) : rules?.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-slate-500">
                  No automation rules yet. Create one to get started.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {rules?.map((rule) => {
                  const meta = RULE_TYPE_META[rule.type] || RULE_TYPE_META.keyword_reply;
                  const trigger = rule.triggerConfig as Record<string, unknown>;
                  const action = rule.actionConfig as Record<string, unknown>;
                  return (
                    <Card key={rule.id} className={`transition-opacity ${rule.enabled ? "" : "opacity-60"}`}>
                      <CardContent className="py-4 px-5">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex items-start gap-3 flex-1 min-w-0">
                            <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${meta.color}`}>
                              {meta.icon}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="font-semibold text-sm text-slate-900">{rule.name}</span>
                                <Badge variant={rule.enabled ? "default" : "secondary"} className="text-[10px] h-5">
                                  {rule.enabled ? "Active" : "Disabled"}
                                </Badge>
                                <Badge variant="outline" className="text-[10px] h-5">{meta.label}</Badge>
                              </div>
                              <p className="text-xs text-slate-500">{meta.description}</p>
                              {rule.type === "keyword_reply" && Array.isArray(trigger?.keywords) && (
                                <div className="flex flex-wrap gap-1 mt-1.5">
                                  {(trigger.keywords as string[]).map((kw: string) => (
                                    <Badge key={kw} variant="outline" className="text-[10px] h-5 font-mono">{kw}</Badge>
                                  ))}
                                </div>
                              )}
                              {(rule.type === "follow_up_timer" || rule.type === "auto_resolve") && typeof trigger?.inactiveHours !== "undefined" && (
                                <p className="text-xs text-slate-400 mt-1">
                                  <Clock className="w-3 h-3 inline mr-1" />
                                  After {String(trigger.inactiveHours)}h of inactivity
                                </p>
                              )}
                              {typeof action?.replyBody === "string" && action.replyBody.length > 0 && (
                                <p className="text-xs text-slate-400 mt-1 truncate max-w-md italic">
                                  "{action.replyBody.substring(0, 80)}{action.replyBody.length > 80 ? "..." : ""}"
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0"
                              onClick={() => toggleRule.mutate({ id: rule.id, data: { enabled: !rule.enabled } })}
                              title={rule.enabled ? "Disable" : "Enable"}
                            >
                              {rule.enabled ? <ToggleRight className="w-5 h-5 text-emerald-600" /> : <ToggleLeft className="w-5 h-5 text-slate-400" />}
                            </Button>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => openEditRule(rule)}>
                              <Pencil className="w-4 h-4 text-slate-400" />
                            </Button>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setDeleteConfirm({ type: "rule", id: rule.id })}>
                              <Trash2 className="w-4 h-4 text-red-400" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="shortcuts" className="space-y-4 mt-4">
            <div className="flex justify-between items-center">
              <p className="text-sm text-slate-500">Type <code className="bg-slate-100 px-1 py-0.5 rounded text-xs">/</code> in the message composer to use shortcuts</p>
              <Button onClick={openNewShortcut} className="gap-1.5 bg-blue-600 hover:bg-blue-700">
                <Plus className="w-4 h-4" />
                New Shortcut
              </Button>
            </div>

            {loadingShortcuts ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
              </div>
            ) : shortcuts?.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-slate-500">
                  No shortcuts yet. Create one to speed up your replies.
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {shortcuts?.map((s) => (
                  <Card key={s.id}>
                    <CardContent className="py-4 px-5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-semibold text-sm text-slate-900">{s.name}</span>
                            <Badge variant="outline" className="text-[10px] h-5 font-mono">{s.shortcutKey}</Badge>
                            {s.category && <Badge variant="secondary" className="text-[10px] h-5">{s.category}</Badge>}
                          </div>
                          <p className="text-xs text-slate-500 line-clamp-2">{s.body}</p>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => openEditShortcut(s)}>
                            <Pencil className="w-4 h-4 text-slate-400" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setDeleteConfirm({ type: "shortcut", id: s.id })}>
                            <Trash2 className="w-4 h-4 text-red-400" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="optouts" className="space-y-4 mt-4">
            {loadingOptOuts ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
              </div>
            ) : optOuts?.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-slate-500">
                  <PhoneOff className="w-8 h-8 mx-auto mb-3 opacity-30" />
                  <p>No opted-out contacts. When a contact sends STOP, END, or UNSUBSCRIBE, they appear here.</p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium">Opted-Out Contacts</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="divide-y divide-slate-100">
                    {optOuts?.map((o) => (
                      <div key={o.id} className="flex items-center justify-between py-3">
                        <div>
                          <span className="font-mono text-sm text-slate-900">{o.phoneNumber}</span>
                          {o.reason && <span className="text-xs text-slate-400 ml-3">{o.reason}</span>}
                          <span className="text-xs text-slate-400 ml-3">{format(new Date(o.optedOutAt), "MMM d, yyyy h:mm a")}</span>
                        </div>
                        <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700 text-xs" onClick={() => setDeleteConfirm({ type: "optout", id: o.id })}>
                          Re-subscribe
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={showRuleDialog} onOpenChange={setShowRuleDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingRuleId ? "Edit Automation Rule" : "New Automation Rule"}</DialogTitle>
            <DialogDescription>Configure when and how the automation triggers.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="mb-1.5 block">Rule Type</Label>
              <Select value={ruleForm.type} onValueChange={(v) => setRuleForm({ ...ruleForm, type: v })} disabled={!!editingRuleId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(RULE_TYPE_META).map(([key, meta]) => (
                    <SelectItem key={key} value={key}>
                      <span className="flex items-center gap-2">{meta.icon} {meta.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1.5 block">Name</Label>
              <Input value={ruleForm.name} onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })} placeholder="e.g. Business Hours Reply" />
            </div>
            {ruleForm.type === "keyword_reply" && (
              <>
                <div>
                  <Label className="mb-1.5 block">Keywords (comma-separated)</Label>
                  <Input value={ruleForm.keywords} onChange={(e) => setRuleForm({ ...ruleForm, keywords: e.target.value })} placeholder="hours, schedule, open" />
                </div>
                <div>
                  <Label className="mb-1.5 block">Match Type</Label>
                  <Select value={ruleForm.matchType} onValueChange={(v) => setRuleForm({ ...ruleForm, matchType: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="contains">Contains</SelectItem>
                      <SelectItem value="exact">Exact Match</SelectItem>
                      <SelectItem value="regex">Regex</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
            {(ruleForm.type === "follow_up_timer" || ruleForm.type === "auto_resolve") && (
              <div>
                <Label className="mb-1.5 block">Inactive Hours</Label>
                <Input type="number" min="1" value={ruleForm.inactiveHours} onChange={(e) => setRuleForm({ ...ruleForm, inactiveHours: e.target.value })} />
              </div>
            )}
            {ruleForm.type !== "auto_unsubscribe" && (
              <div>
                <Label className="mb-1.5 block">Auto-reply Message</Label>
                <Textarea value={ruleForm.replyBody} onChange={(e) => setRuleForm({ ...ruleForm, replyBody: e.target.value })} rows={3} placeholder="The automatic message to send..." />
              </div>
            )}
            <div>
              <Label className="mb-1.5 block">Priority (lower = runs first)</Label>
              <Input type="number" value={ruleForm.priority} onChange={(e) => setRuleForm({ ...ruleForm, priority: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRuleDialog(false)}>Cancel</Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700"
              disabled={!ruleForm.name || createRule.isPending || updateRule.isPending}
              onClick={saveRule}
            >
              {(createRule.isPending || updateRule.isPending) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editingRuleId ? "Save Changes" : "Create Rule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showShortcutDialog} onOpenChange={setShowShortcutDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingShortcutId ? "Edit Shortcut" : "New Shortcut"}</DialogTitle>
            <DialogDescription>Create a reusable message template. Type the shortcut key in the composer to insert it.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="mb-1.5 block">Name</Label>
              <Input value={shortcutForm.name} onChange={(e) => setShortcutForm({ ...shortcutForm, name: e.target.value })} placeholder="e.g. Greeting" />
            </div>
            <div>
              <Label className="mb-1.5 block">Shortcut Key</Label>
              <Input value={shortcutForm.shortcutKey} onChange={(e) => setShortcutForm({ ...shortcutForm, shortcutKey: e.target.value })} placeholder="/hello" />
              <p className="text-xs text-slate-400 mt-1">Must start with /</p>
            </div>
            <div>
              <Label className="mb-1.5 block">Message Body</Label>
              <Textarea value={shortcutForm.body} onChange={(e) => setShortcutForm({ ...shortcutForm, body: e.target.value })} rows={4} placeholder="The template message text..." />
            </div>
            <div>
              <Label className="mb-1.5 block">Category (optional)</Label>
              <Input value={shortcutForm.category} onChange={(e) => setShortcutForm({ ...shortcutForm, category: e.target.value })} placeholder="e.g. Support, Sales" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowShortcutDialog(false)}>Cancel</Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700"
              disabled={!shortcutForm.name || !shortcutForm.shortcutKey || !shortcutForm.body || createShortcut.isPending || updateShortcut.isPending}
              onClick={saveShortcut}
            >
              {(createShortcut.isPending || updateShortcut.isPending) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editingShortcutId ? "Save Changes" : "Create Shortcut"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Delete</DialogTitle>
            <DialogDescription>
              {deleteConfirm?.type === "optout" ? "This will re-subscribe the contact, allowing them to receive messages again." : "This action cannot be undone. Are you sure?"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={deleteRule.isPending || deleteShortcut.isPending || deleteOptOut.isPending}
              onClick={() => {
                if (!deleteConfirm) return;
                if (deleteConfirm.type === "rule") deleteRule.mutate({ id: deleteConfirm.id });
                else if (deleteConfirm.type === "shortcut") deleteShortcut.mutate({ id: deleteConfirm.id });
                else if (deleteConfirm.type === "optout") deleteOptOut.mutate({ id: deleteConfirm.id });
              }}
            >
              {(deleteRule.isPending || deleteShortcut.isPending || deleteOptOut.isPending) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {deleteConfirm?.type === "optout" ? "Re-subscribe" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
