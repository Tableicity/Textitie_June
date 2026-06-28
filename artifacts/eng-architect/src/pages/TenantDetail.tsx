import { useEffect, useState, useRef } from "react";
import { useParams, Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetTenant,
  getGetTenantQueryKey,
  useInjectMessage,
  useUpdateTenant,
  useGetOwnedNumbers,
  useGetTenantUsers,
  getGetTenantUsersQueryKey,
  getListInjectionsQueryKey,
  useGetTenantDepartments,
  getGetTenantDepartmentsQueryKey,
  useAssignTenantDepartmentNumber,
  useCreateTenantDepartment,
  useGetTenantUnassignedConversations,
  getGetTenantUnassignedConversationsQueryKey,
  useAssignTenantConversationDepartment,
} from "@workspace/api-client-react";
import { getStoredAuthHeader } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, Zap, Server, Shield, BookOpen, Phone, MessageSquare, Upload, Users, Receipt, GraduationCap, Building2 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import MigrationsPanel from "@/components/MigrationsPanel";
import BrandSafetyPanel from "@/components/BrandSafetyPanel";

const injectSchema = z.object({
  to: z.string().min(3, "Phone number is required"),
  body: z.string().min(1, "Message body is required"),
});

const phoneSchema = z.object({
  phoneNumber: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{6,14}$|^$/, "Must be E.164 format (e.g. +19094904265) or empty"),
});

export default function TenantDetail() {
  const params = useParams();
  const tenantId = params.id ? parseInt(params.id, 10) : 0;

  const { data: tenant, isLoading } = useGetTenant(tenantId, {
    query: {
      enabled: !!tenantId,
      queryKey: getGetTenantQueryKey(tenantId),
    },
  });

  const injectMessage = useInjectMessage();
  const updateTenant = useUpdateTenant();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: ownedData } = useGetOwnedNumbers();
  const ownedConfigured = ownedData?.configured ?? false;
  const ownedNumbers = ownedData?.numbers ?? [];
  const [selectedNumber, setSelectedNumber] = useState<string>("__none__");

  const { data: tenantUsersData, isLoading: usersLoading } = useGetTenantUsers(tenantId, {
    query: { enabled: !!tenantId, queryKey: getGetTenantUsersQueryKey(tenantId) },
  });
  const tenantUsers = tenantUsersData?.users ?? [];

  const { data: departmentsData, isLoading: deptsLoading } =
    useGetTenantDepartments(tenantId, {
      query: {
        enabled: !!tenantId,
        queryKey: getGetTenantDepartmentsQueryKey(tenantId),
      },
    });
  const departments = departmentsData?.departments ?? [];
  const assignDeptNumber = useAssignTenantDepartmentNumber();

  const createDept = useCreateTenantDepartment();
  const [newDeptName, setNewDeptName] = useState("");

  // Conversations that still have no department — the operator can move each into
  // one without losing any history.
  const { data: unassignedData, isLoading: unassignedLoading } =
    useGetTenantUnassignedConversations(tenantId, {
      query: {
        enabled: !!tenantId,
        queryKey: getGetTenantUnassignedConversationsQueryKey(tenantId),
      },
    });
  const unassignedConversations = unassignedData?.conversations ?? [];
  const assignConvDept = useAssignTenantConversationDepartment();
  const [convDeptSelections, setConvDeptSelections] = useState<
    Record<number, string>
  >({});

  // Per-department number picker, keyed by department id. Select mode (Twilio
  // connected) uses "__none__" to mean unassign; manual mode uses an empty
  // string. Reset from the server rows whenever they (re)load so a save's
  // invalidation snaps every row back to its persisted value.
  const [deptSelections, setDeptSelections] = useState<Record<number, string>>(
    {},
  );
  useEffect(() => {
    if (!departmentsData) return;
    const next: Record<number, string> = {};
    for (const d of departmentsData.departments) {
      next[d.id] = d.phoneNumber ?? (ownedConfigured ? "__none__" : "");
    }
    setDeptSelections(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departmentsData, ownedConfigured]);

  const injectForm = useForm<z.infer<typeof injectSchema>>({
    resolver: zodResolver(injectSchema),
    defaultValues: { to: "", body: "" },
  });

  const phoneForm = useForm<z.infer<typeof phoneSchema>>({
    resolver: zodResolver(phoneSchema),
    defaultValues: { phoneNumber: "" },
  });

  const [phoneDirty, setPhoneDirty] = useState(false);
  useEffect(() => {
    if (tenant) {
      phoneForm.reset({ phoneNumber: tenant.phoneNumber ?? "" });
      setPhoneDirty(false);
      setSelectedNumber(tenant.phoneNumber ?? "__none__");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant?.id, tenant?.phoneNumber]);

  const [brandScopeText, setBrandScopeText] = useState("");
  const [brandScopeDirty, setBrandScopeDirty] = useState(false);
  useEffect(() => {
    if (tenant) {
      setBrandScopeText(tenant.brandScope ?? "");
      setBrandScopeDirty(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant?.id, tenant?.brandScope]);

  const [fallbackPhraseText, setFallbackPhraseText] = useState("");
  const [fallbackPhraseDirty, setFallbackPhraseDirty] = useState(false);
  useEffect(() => {
    if (tenant) {
      setFallbackPhraseText(tenant.fallbackPhrase ?? "");
      setFallbackPhraseDirty(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant?.id, tenant?.fallbackPhrase]);

  const [holdingPhraseText, setHoldingPhraseText] = useState("");
  const [holdingPhraseDirty, setHoldingPhraseDirty] = useState(false);
  useEffect(() => {
    if (tenant) {
      setHoldingPhraseText(tenant.autopilotHoldingPhrase ?? "");
      setHoldingPhraseDirty(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant?.id, tenant?.autopilotHoldingPhrase]);

  const onSavePhone = (values: z.infer<typeof phoneSchema>) => {
    if (!tenant) return;
    const next = values.phoneNumber.trim() || null;
    updateTenant.mutate(
      { id: tenant.id, data: { phoneNumber: next } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetTenantQueryKey(tenant.id) });
          setPhoneDirty(false);
          toast({
            title: "Tenant Number Saved",
            description: next
              ? `Inbound texts to ${next} now route to ${tenant.name}.`
              : `${tenant.name} no longer has an assigned number.`,
          });
        },
        onError: (err) => {
          toast({ title: "Save Failed", description: err.message || "An error occurred", variant: "destructive" });
        },
      },
    );
  };

  const currentNum = tenant?.phoneNumber ?? null;
  const currentIsOwned =
    !currentNum || ownedNumbers.some((n) => n.phoneNumber === currentNum);

  const onSaveSelectedNumber = () => {
    if (!tenant) return;
    const next = selectedNumber === "__none__" ? null : selectedNumber;
    updateTenant.mutate(
      { id: tenant.id, data: { phoneNumber: next } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetTenantQueryKey(tenant.id) });
          toast({
            title: "Tenant Number Saved",
            description: next
              ? `${tenant.name} now sends and receives on ${next}.`
              : `${tenant.name} unassigned — outbound falls back to the platform default number.`,
          });
        },
        onError: (err) => {
          toast({ title: "Save Failed", description: err.message || "An error occurred", variant: "destructive" });
        },
      },
    );
  };

  const onSaveDeptNumber = (departmentId: number) => {
    if (!tenant) return;
    const raw = deptSelections[departmentId] ?? "";
    const next = raw === "__none__" || raw.trim() === "" ? null : raw.trim();
    if (next && !/^\+[1-9]\d{6,14}$/.test(next)) {
      toast({
        title: "Invalid Number",
        description: "Must be E.164 format, e.g. +19094904265.",
        variant: "destructive",
      });
      return;
    }
    assignDeptNumber.mutate(
      { id: tenant.id, departmentId, data: { phoneNumber: next } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getGetTenantDepartmentsQueryKey(tenant.id),
          });
          // A primary→department reclaim nulls the tenant's primary, so refresh
          // the tenant too and the Telephony card reflects the move.
          queryClient.invalidateQueries({
            queryKey: getGetTenantQueryKey(tenant.id),
          });
          toast({
            title: "Department Number Saved",
            description: next
              ? `Department now receives on ${next}.`
              : "Department number unassigned.",
          });
        },
        onError: (err) => {
          toast({ title: "Save Failed", description: err.message || "An error occurred", variant: "destructive" });
        },
      },
    );
  };

  const onCreateDepartment = () => {
    if (!tenant) return;
    const name = newDeptName.trim();
    if (!name) {
      toast({
        title: "Name Required",
        description: "Enter a department name.",
        variant: "destructive",
      });
      return;
    }
    createDept.mutate(
      { id: tenant.id, data: { name } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getGetTenantDepartmentsQueryKey(tenant.id),
          });
          setNewDeptName("");
          toast({
            title: "Department Created",
            description: `"${name}" is ready for number assignment and conversations.`,
          });
        },
        onError: (err) => {
          toast({ title: "Create Failed", description: err.message || "An error occurred", variant: "destructive" });
        },
      },
    );
  };

  const onAssignConvDept = (conversationId: number) => {
    if (!tenant) return;
    const raw = convDeptSelections[conversationId];
    if (!raw || raw === "__none__") {
      toast({
        title: "Pick a Department",
        description: "Choose a department to move this conversation into.",
        variant: "destructive",
      });
      return;
    }
    const departmentId = parseInt(raw, 10);
    assignConvDept.mutate(
      { id: tenant.id, conversationId, data: { departmentId } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getGetTenantUnassignedConversationsQueryKey(tenant.id),
          });
          const deptName =
            departments.find((d) => d.id === departmentId)?.name ??
            "the department";
          toast({
            title: "Conversation Moved",
            description: `Moved into ${deptName}. All history preserved.`,
          });
        },
        onError: (err) => {
          toast({ title: "Move Failed", description: err.message || "An error occurred", variant: "destructive" });
        },
      },
    );
  };

  const onToggleSurcharge = (enabled: boolean) => {
    if (!tenant) return;
    updateTenant.mutate(
      { id: tenant.id, data: { unregisteredSurchargeEnabled: enabled } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetTenantQueryKey(tenant.id) });
          toast({
            title: enabled ? "Surcharge Enabled" : "Surcharge Waived",
            description: enabled
              ? `${tenant.name} will be charged the $10/mo unregistered surcharge on each unregistered local number.`
              : `The unregistered surcharge is waived for ${tenant.name}. The $15/mo carrier fee per local number still applies.`,
          });
        },
        onError: (err) => {
          toast({ title: "Update Failed", description: err.message || "An error occurred", variant: "destructive" });
        },
      },
    );
  };

  const onSaveBrandScope = () => {
    if (!tenant) return;
    const next = brandScopeText.trim() || null;
    updateTenant.mutate(
      { id: tenant.id, data: { brandScope: next } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetTenantQueryKey(tenant.id) });
          setBrandScopeDirty(false);
          toast({
            title: "Brand Scope Saved",
            description: next
              ? "The inbound triage router will use this to decide if a text is in-scope."
              : "Brand scope cleared — the triage router falls open to the existing draft path.",
          });
        },
        onError: (err) => {
          toast({ title: "Save Failed", description: err.message || "An error occurred", variant: "destructive" });
        },
      },
    );
  };

  const onSaveFallbackPhrase = () => {
    if (!tenant) return;
    const next = fallbackPhraseText.trim() || null;
    updateTenant.mutate(
      { id: tenant.id, data: { fallbackPhrase: next } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetTenantQueryKey(tenant.id) });
          setFallbackPhraseDirty(false);
          toast({
            title: "Fallback Phrase Saved",
            description: next
              ? "Co-Pilot will draft this verbatim when an inbound is tenant-specific but ungrounded."
              : "Fallback phrase cleared — Co-Pilot falls back to the existing Student draft path.",
          });
        },
        onError: (err) => {
          toast({ title: "Save Failed", description: err.message || "An error occurred", variant: "destructive" });
        },
      },
    );
  };

  const onSaveHoldingPhrase = () => {
    if (!tenant) return;
    const next = holdingPhraseText.trim() || null;
    updateTenant.mutate(
      { id: tenant.id, data: { autopilotHoldingPhrase: next } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetTenantQueryKey(tenant.id) });
          setHoldingPhraseDirty(false);
          toast({
            title: "Holding Phrase Saved",
            description: next
              ? "Auto-Pilot will text this verbatim as an acknowledgment when it hands a message back to a human."
              : "Holding phrase cleared — Auto-Pilot handbacks use a built-in default acknowledgment.",
          });
        },
        onError: (err) => {
          toast({ title: "Save Failed", description: err.message || "An error occurred", variant: "destructive" });
        },
      },
    );
  };

  const onInject = (values: z.infer<typeof injectSchema>) => {
    if (!tenant) return;
    injectMessage.mutate(
      {
        data: {
          to: values.to,
          body: values.body,
          tenantId: tenant.id,
          conductorAuthorized: true,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListInjectionsQueryKey() });
          injectForm.reset();
          toast({ title: "Injection Sent", description: `Message pushed to ${tenant.name} pipe successfully.` });
        },
        onError: (err) => {
          toast({ title: "Injection Failed", description: err.message || "An error occurred", variant: "destructive" });
        },
      },
    );
  };

  if (isLoading) {
    return <div className="p-8 text-center text-muted-foreground">Loading tenant details...</div>;
  }

  if (!tenant) {
    return <div className="p-8 text-center text-muted-foreground">Tenant not found.</div>;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{tenant.name}</h1>
        <p className="text-muted-foreground mt-2 font-mono text-sm">{tenant.slug}.sama.io</p>
      </div>

      <Tabs defaultValue="migrations" className="space-y-6">
        <TabsList>
          <TabsTrigger value="migrations">Migrations</TabsTrigger>
          <TabsTrigger value="brand-safety">Brand Safety</TabsTrigger>
          <TabsTrigger value="overview">Overview</TabsTrigger>
        </TabsList>

        <TabsContent value="migrations">
          <MigrationsPanel tenantId={tenant.id} tenantName={tenant.name} />
        </TabsContent>

        <TabsContent value="brand-safety">
          <BrandSafetyPanel tenantId={tenant.id} tenantName={tenant.name} />
        </TabsContent>

        <TabsContent value="overview" className="space-y-8">

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Server size={16} /> Data Residency
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Region</span>
              <Badge variant="outline" className="font-mono">{tenant.region}</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Zap size={16} /> Service Tier
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Plan</span>
              <Badge variant="secondary" className="capitalize">{tenant.tierCode}</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Shield size={16} /> Compliance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Sovereign Lock</span>
              {tenant.sovereignToggle ? (
                <div className="flex items-center text-emerald-500 text-sm font-medium gap-1">
                  <ShieldCheck size={16} /> Enforced
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">Inactive</span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Phone size={16} /> Telephony
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Current</span>
              <span className="font-mono">{tenant.phoneNumber ?? <em className="text-muted-foreground">unset</em>}</span>
            </div>
            {ownedConfigured && currentNum && !currentIsOwned && (
              <p className="text-xs text-amber-600">
                This number is not owned by the connected Twilio account — outbound
                will fail (Twilio 21660). Pick an owned number below.
              </p>
            )}
            {ownedConfigured ? (
              <div className="space-y-2">
                <span className="text-xs text-muted-foreground">
                  Assign a number owned by the Twilio account
                </span>
                <Select value={selectedNumber} onValueChange={setSelectedNumber}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a number" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Unassign — use platform default</SelectItem>
                    {currentNum && !currentIsOwned && (
                      <SelectItem value={currentNum}>{currentNum} (current — not owned)</SelectItem>
                    )}
                    {ownedNumbers.map((n) => (
                      <SelectItem key={n.phoneNumber} value={n.phoneNumber}>
                        {n.phoneNumber}
                        {n.friendlyName && n.friendlyName !== n.phoneNumber ? ` · ${n.friendlyName}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  size="sm"
                  className="w-full"
                  disabled={updateTenant.isPending || selectedNumber === (tenant.phoneNumber ?? "__none__")}
                  onClick={onSaveSelectedNumber}
                >
                  {updateTenant.isPending ? "Saving..." : "Save Tenant Number"}
                </Button>
              </div>
            ) : (
              <Form {...phoneForm}>
                <form
                  onSubmit={phoneForm.handleSubmit(onSavePhone)}
                  onChange={() => setPhoneDirty(true)}
                  className="space-y-2"
                >
                  <FormField
                    control={phoneForm.control}
                    name="phoneNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-muted-foreground">
                          Twilio number (E.164, e.g. +19094904265)
                        </FormLabel>
                        <FormControl>
                          <Input placeholder="+1XXXXXXXXXX" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button
                    type="submit"
                    size="sm"
                    disabled={updateTenant.isPending || !phoneDirty}
                    className="w-full"
                  >
                    {updateTenant.isPending ? "Saving..." : "Save Tenant Number"}
                  </Button>
                </form>
              </Form>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <MessageSquare size={16} /> Chatwoot Bridge
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Account ID</span>
              <span className="font-mono">{tenant.chatwootAccountId ?? <em className="text-muted-foreground">unset</em>}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Inbox ID</span>
              <span className="font-mono">{tenant.chatwootInboxId ?? <em className="text-muted-foreground">unset</em>}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Building2 size={16} /> Departments
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Assign an owned number to a department for inbound routing, mirroring
            the tenant workspace. A number is either the account primary or one
            department's number — assigning the current primary here moves it off
            primary in the same step.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border p-3 space-y-2">
            <p className="text-sm font-medium">Create a department</p>
            <div className="flex gap-2">
              <Input
                placeholder="Department name (e.g. Customer Service)"
                value={newDeptName}
                onChange={(e) => setNewDeptName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onCreateDepartment();
                  }
                }}
              />
              <Button
                type="button"
                size="sm"
                disabled={createDept.isPending || !newDeptName.trim()}
                onClick={onCreateDepartment}
              >
                {createDept.isPending ? "Creating..." : "Create"}
              </Button>
            </div>
          </div>
          {deptsLoading ? (
            <p className="text-sm text-muted-foreground">Loading departments…</p>
          ) : departments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No departments yet. Create one above, then assign it a number or
              move conversations into it.
            </p>
          ) : (
            departments.map((d) => {
              const sel =
                deptSelections[d.id] ?? (ownedConfigured ? "__none__" : "");
              const saved = d.phoneNumber ?? (ownedConfigured ? "__none__" : "");
              const deptCurrentOwned =
                !d.phoneNumber ||
                ownedNumbers.some((n) => n.phoneNumber === d.phoneNumber);
              const selectsPrimary =
                !!tenant.phoneNumber && sel === tenant.phoneNumber;
              const isRowPending =
                assignDeptNumber.isPending &&
                assignDeptNumber.variables?.departmentId === d.id;
              return (
                <div key={d.id} className="rounded-md border p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{d.name}</p>
                      {d.description && (
                        <p className="text-xs text-muted-foreground">
                          {d.description}
                        </p>
                      )}
                    </div>
                    <span className="font-mono text-sm whitespace-nowrap">
                      {d.phoneNumber ?? (
                        <em className="text-muted-foreground">unset</em>
                      )}
                    </span>
                  </div>
                  {ownedConfigured && d.phoneNumber && !deptCurrentOwned && (
                    <p className="text-xs text-amber-600">
                      This number is not owned by the connected Twilio account —
                      inbound/outbound may fail. Pick an owned number below.
                    </p>
                  )}
                  {ownedConfigured ? (
                    <Select
                      value={sel}
                      onValueChange={(v) =>
                        setDeptSelections((prev) => ({ ...prev, [d.id]: v }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a number" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">
                          Unassign — no department number
                        </SelectItem>
                        {d.phoneNumber && !deptCurrentOwned && (
                          <SelectItem value={d.phoneNumber}>
                            {d.phoneNumber} (current — not owned)
                          </SelectItem>
                        )}
                        {ownedNumbers.map((n) => (
                          <SelectItem key={n.phoneNumber} value={n.phoneNumber}>
                            {n.phoneNumber}
                            {n.friendlyName && n.friendlyName !== n.phoneNumber
                              ? ` · ${n.friendlyName}`
                              : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      placeholder="+1XXXXXXXXXX (leave empty to unassign)"
                      value={sel}
                      onChange={(e) =>
                        setDeptSelections((prev) => ({
                          ...prev,
                          [d.id]: e.target.value,
                        }))
                      }
                    />
                  )}
                  {selectsPrimary && (
                    <p className="text-xs text-amber-600">
                      This is the account's primary number — saving will move it
                      off primary and onto this department.
                    </p>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    className="w-full"
                    disabled={isRowPending || sel === saved}
                    onClick={() => onSaveDeptNumber(d.id)}
                  >
                    {isRowPending ? "Saving..." : "Save Department Number"}
                  </Button>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <MessageSquare size={16} /> Unassigned Conversations
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Conversations with no department yet. Move one into a department to
            organize it — all message history is preserved.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {unassignedLoading ? (
            <p className="text-sm text-muted-foreground">
              Loading conversations…
            </p>
          ) : unassignedConversations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No unassigned conversations — every conversation belongs to a
              department.
            </p>
          ) : departments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {unassignedConversations.length} unassigned conversation
              {unassignedConversations.length === 1 ? "" : "s"}. Create a
              department above first, then you can move them in.
            </p>
          ) : (
            unassignedConversations.map((c) => {
              const sel = convDeptSelections[c.id] ?? "__none__";
              const isRowPending =
                assignConvDept.isPending &&
                assignConvDept.variables?.conversationId === c.id;
              return (
                <div key={c.id} className="rounded-md border p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">
                        {c.contactName || c.contactPhone}
                      </p>
                      <p className="text-xs text-muted-foreground font-mono">
                        {c.contactPhone}
                      </p>
                    </div>
                    <Badge variant="outline" className="whitespace-nowrap">
                      {c.status}
                    </Badge>
                  </div>
                  <Select
                    value={sel}
                    onValueChange={(v) =>
                      setConvDeptSelections((prev) => ({ ...prev, [c.id]: v }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a department" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">
                        Select a department…
                      </SelectItem>
                      {departments.map((d) => (
                        <SelectItem key={d.id} value={String(d.id)}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    size="sm"
                    className="w-full"
                    disabled={isRowPending || sel === "__none__"}
                    onClick={() => onAssignConvDept(c.id)}
                  >
                    {isRowPending ? "Moving..." : "Move into Department"}
                  </Button>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Receipt size={16} /> Carrier Billing
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Per-number recurring fees billed on top of the plan. Each local number incurs a
            $15.00/mo carrier fee. Unregistered local numbers also incur a $10.00/mo surcharge —
            you can waive that surcharge for this tenant below. Toll-free numbers are exempt from both.
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Unregistered carrier surcharge</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {tenant.unregisteredSurchargeEnabled
                  ? "Applied ($10.00/mo per unregistered local number)."
                  : "Waived for this tenant — the $15.00/mo carrier fee still applies."}
              </p>
            </div>
            <Switch
              checked={tenant.unregisteredSurchargeEnabled}
              disabled={updateTenant.isPending}
              onCheckedChange={onToggleSurcharge}
              aria-label="Toggle unregistered carrier surcharge"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <MessageSquare size={16} /> Brand Scope (AI triage)
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            A short blurb describing what {tenant.name} is and what the AI may
            answer. The inbound triage router (Co-Pilot) uses this to sort each
            text into in-scope vs off-topic before drafting. Leave empty to
            disable triage — the AI falls back to the Classroom/Professor draft
            path.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={brandScopeText}
            onChange={(e) => {
              setBrandScopeText(e.target.value);
              setBrandScopeDirty(true);
            }}
            rows={3}
            maxLength={1000}
            placeholder={'e.g. "B2B HVAC parts supplier; answer product, ordering, and support questions only."'}
          />
          <div className="flex justify-end">
            <Button
              onClick={onSaveBrandScope}
              disabled={updateTenant.isPending || !brandScopeDirty}
            >
              {updateTenant.isPending ? "Saving..." : "Save Brand Scope"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <MessageSquare size={16} /> Fallback Phrase (Co-Pilot)
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            A safe holding reply for {tenant.name} when a customer asks something
            tenant-specific the AI can't ground in the Classroom or knowledge
            base. In Co-Pilot, the pipeline drafts this verbatim into the composer
            instead of guessing at brand-specific pricing, policy, or account
            details — a human edits, sends, and escalates. Leave empty to keep the
            existing Student/Professor draft path.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={fallbackPhraseText}
            onChange={(e) => {
              setFallbackPhraseText(e.target.value);
              setFallbackPhraseDirty(true);
            }}
            rows={3}
            maxLength={1000}
            placeholder={'e.g. "Great question — let me pull up the exact details for your account and get right back to you."'}
          />
          <div className="flex justify-end">
            <Button
              onClick={onSaveFallbackPhrase}
              disabled={updateTenant.isPending || !fallbackPhraseDirty}
            >
              {updateTenant.isPending ? "Saving..." : "Save Fallback Phrase"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <MessageSquare size={16} /> Holding Phrase (Auto-Pilot)
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            A short acknowledgment Auto-Pilot texts {tenant.name}'s customers
            verbatim when it can't safely auto-answer and hands the message back
            to a human (the gate refused, or the AI draft failed). It is an
            acknowledgment, NOT an answer — the conversation stays Blue so a human
            still owns the real reply, and the customer is texted at most once per
            wait. Leave empty to use a built-in default acknowledgment.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={holdingPhraseText}
            onChange={(e) => {
              setHoldingPhraseText(e.target.value);
              setHoldingPhraseDirty(true);
            }}
            rows={3}
            maxLength={1000}
            placeholder={'e.g. "Thanks for reaching out! A team member will get back to you shortly."'}
          />
          <div className="flex justify-end">
            <Button
              onClick={onSaveHoldingPhrase}
              disabled={updateTenant.isPending || !holdingPhraseDirty}
            >
              {updateTenant.isPending ? "Saving..." : "Save Holding Phrase"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Users size={16} /> Users / Logins
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            The people who can sign into this tenant's agent inbox. The owner is the account holder; agents are invited team members.
          </p>
        </CardHeader>
        <CardContent>
          {usersLoading ? (
            <p className="text-sm text-muted-foreground">Loading users…</p>
          ) : tenantUsers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No login users yet for this tenant.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Name</th>
                    <th className="py-2 pr-4 font-medium">Email (login)</th>
                    <th className="py-2 pr-4 font-medium">Role</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 font-medium">Phone</th>
                  </tr>
                </thead>
                <tbody>
                  {tenantUsers.map((u) => (
                    <tr key={u.id} className="border-b last:border-0">
                      <td className="py-2 pr-4">{u.name}</td>
                      <td className="py-2 pr-4 font-mono">{u.email}</td>
                      <td className="py-2 pr-4">
                        <Badge variant={u.role === "owner" ? "default" : "secondary"}>{u.role}</Badge>
                      </td>
                      <td className="py-2 pr-4">
                        <span className="capitalize text-muted-foreground">{u.status}</span>
                      </td>
                      <td className="py-2 font-mono text-muted-foreground">
                        {u.phone ?? <em className="not-italic text-muted-foreground/60">—</em>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-primary/30 bg-primary/[0.03]">
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2 text-primary">
                <GraduationCap size={20} /> Professor &amp; Knowledge
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Chat with {tenant.name}'s Professor to curate a Library, then push
                absorbed knowledge to the Classroom that Students use to draft replies.
              </p>
            </div>
            <Link href={`/tenants/${tenant.id}/professor`}>
              <Button className="gap-2 shrink-0">
                <GraduationCap size={16} /> Open Professor
              </Button>
            </Link>
          </div>
          <p className="text-xs text-muted-foreground">
            Your existing knowledge base was migrated into the Library as a “legacy”
            document — nothing was lost.
          </p>
        </CardHeader>
      </Card>

      <Card className="border-primary/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-primary">
            <Zap size={20} /> Scoped Injection
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...injectForm}>
            <form onSubmit={injectForm.handleSubmit(onInject)} className="space-y-4 max-w-2xl">
              <FormField
                control={injectForm.control}
                name="to"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>To Number</FormLabel>
                    <FormControl>
                      <Input placeholder="+1234567890" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={injectForm.control}
                name="body"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Message Body</FormLabel>
                    <FormControl>
                      <Textarea placeholder={`Message from ${tenant.name}...`} className="min-h-[100px]" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="pt-2">
                <Button type="submit" disabled={injectMessage.isPending} className="bg-primary text-primary-foreground hover:bg-primary/90">
                  {injectMessage.isPending ? "Injecting..." : "Fire Injection"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
