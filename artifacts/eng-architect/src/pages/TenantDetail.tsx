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
import { ShieldCheck, Zap, Server, Shield, BookOpen, Phone, MessageSquare, Upload, Users, Receipt, GraduationCap } from "lucide-react";

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
    </div>
  );
}
