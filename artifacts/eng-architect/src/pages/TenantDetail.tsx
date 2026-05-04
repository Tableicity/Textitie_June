import { useEffect, useState, useRef } from "react";
import { useParams } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetTenant,
  getGetTenantQueryKey,
  useInjectMessage,
  useUpdateTenant,
  getListInjectionsQueryKey,
} from "@workspace/api-client-react";
import { getStoredAuthHeader } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, Zap, Server, Shield, BookOpen, Phone, MessageSquare, Upload } from "lucide-react";

const injectSchema = z.object({
  to: z.string().min(3, "Phone number is required"),
  body: z.string().min(1, "Message body is required"),
});

const kbSchema = z.object({
  knowledgeBase: z.string(),
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const injectForm = useForm<z.infer<typeof injectSchema>>({
    resolver: zodResolver(injectSchema),
    defaultValues: { to: "", body: "" },
  });

  const kbForm = useForm<z.infer<typeof kbSchema>>({
    resolver: zodResolver(kbSchema),
    defaultValues: { knowledgeBase: "" },
  });

  const [kbDirty, setKbDirty] = useState(false);
  useEffect(() => {
    if (tenant) {
      kbForm.reset({ knowledgeBase: tenant.knowledgeBase ?? "" });
      setKbDirty(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant?.id, tenant?.knowledgeBase]);

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
          toast({ title: "Injection Failed", description: err.error || "An error occurred", variant: "destructive" });
        },
      },
    );
  };

  const onSaveKb = (values: z.infer<typeof kbSchema>) => {
    if (!tenant) return;
    updateTenant.mutate(
      { id: tenant.id, data: { knowledgeBase: values.knowledgeBase || null } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetTenantQueryKey(tenant.id) });
          setKbDirty(false);
          toast({ title: "Knowledge Base Saved", description: `${tenant.name} AI Student updated.` });
        },
        onError: (err) => {
          toast({ title: "Save Failed", description: err.error || "An error occurred", variant: "destructive" });
        },
      },
    );
  };

  const onFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !tenant) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const authHeader = getStoredAuthHeader();
      const headers: Record<string, string> = {};
      if (authHeader) headers["Authorization"] = authHeader;
      const resp = await fetch(`${base}/api/tenants/${tenant.id}/knowledge-upload`, {
        method: "POST",
        body: formData,
        headers,
      });
      const data = await resp.json();
      if (resp.ok) {
        queryClient.invalidateQueries({ queryKey: getGetTenantQueryKey(tenant.id) });
        toast({
          title: "File Uploaded",
          description: `Extracted ${data.extractedChars.toLocaleString()} chars from ${data.fileName}. Total KB: ${data.totalKbChars.toLocaleString()} chars.`,
        });
      } else {
        toast({ title: "Upload Failed", description: data.error || "Unknown error", variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Upload Failed", description: err instanceof Error ? err.message : "Network error", variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
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
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Tenant Number</span>
              <span className="font-mono">{tenant.phoneNumber ?? <em className="text-muted-foreground">unset</em>}</span>
            </div>
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
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <BookOpen size={20} /> Knowledge Base
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                The AI Student reads this before drafting a Whisper for every inbound message.
              </p>
            </div>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.txt,.md,.csv"
                onChange={onFileUpload}
                className="hidden"
              />
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                <Upload size={14} />
                {uploading ? "Uploading..." : "Upload File"}
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Supports PDF, TXT, MD, CSV (max 5MB). Content is extracted and appended to the knowledge base.
          </p>
        </CardHeader>
        <CardContent>
          <Form {...kbForm}>
            <form onSubmit={kbForm.handleSubmit(onSaveKb)} className="space-y-4">
              <FormField
                control={kbForm.control}
                name="knowledgeBase"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Textarea
                        placeholder="Q: What are your hours?  A: 9am-6pm CET, Mon-Fri.&#10;Q: Refund policy?  A: 30 days, no questions asked.&#10;ESCALATE if: customer mentions 'lawyer' or 'fraud'."
                        className="min-h-[260px] font-mono text-xs"
                        {...field}
                        onChange={(e) => {
                          field.onChange(e);
                          setKbDirty(true);
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex justify-between items-center pt-2">
                <span className="text-xs text-muted-foreground">
                  {kbDirty ? "Unsaved changes" : "Up to date"}
                  {" · "}
                  {(kbForm.getValues("knowledgeBase") || "").length.toLocaleString()} chars
                </span>
                <Button
                  type="submit"
                  disabled={updateTenant.isPending || !kbDirty}
                >
                  {updateTenant.isPending ? "Saving..." : "Save Knowledge Base"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
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
