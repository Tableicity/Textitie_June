import { useState } from "react";
import { Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { useListTenants, useCreateTenant, getListTenantsQueryKey } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Plus, ShieldCheck, MessageSquare } from "lucide-react";

const formSchema = z.object({
  slug: z.string().min(2).max(64),
  name: z.string().min(1).max(128),
  region: z.enum(["DE", "EE", "US"]),
  tierCode: z.enum(["starter", "growth", "enterprise"]),
  sovereignToggle: z.boolean().default(false),
  phoneNumber: z.string().optional(),
  knowledgeBase: z.string().optional(),
});

export default function Tenants() {
  const { data: tenants, isLoading } = useListTenants();
  const createTenant = useCreateTenant();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      slug: "",
      name: "",
      region: "US",
      tierCode: "starter",
      sovereignToggle: false,
      phoneNumber: "",
      knowledgeBase: "",
    },
  });

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    createTenant.mutate(
      {
        data: {
          slug: values.slug,
          name: values.name,
          region: values.region,
          tierCode: values.tierCode,
          sovereignToggle: values.sovereignToggle,
          phoneNumber: values.phoneNumber?.trim() ? values.phoneNumber.trim() : null,
          knowledgeBase: values.knowledgeBase?.trim()
            ? values.knowledgeBase
            : null,
        },
      },
      {
        onSuccess: (data) => {
          queryClient.invalidateQueries({ queryKey: getListTenantsQueryKey() });
          setOpen(false);
          form.reset();
          const cwMsg = data?.chatwootInboxId
            ? `Chatwoot inbox #${data.chatwootInboxId} auto-provisioned.`
            : "Chatwoot provisioning pending.";
          toast({ title: "Tenant Created", description: `Successfully created ${values.name}. ${cwMsg}` });
        },
        onError: (err) => {
          toast({ title: "Error", description: err.message || "Failed to create tenant", variant: "destructive" });
        },
      }
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tenants</h1>
          <p className="text-muted-foreground mt-2">Manage SAMA platform tenants.</p>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2"><Plus size={16} /> New Tenant</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Tenant</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Acme Corp" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="slug"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Slug</FormLabel>
                      <FormControl>
                        <Input placeholder="acme-corp" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="region"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Region</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger><SelectValue placeholder="Select region" /></SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="US">US</SelectItem>
                            <SelectItem value="DE">DE</SelectItem>
                            <SelectItem value="EE">EE</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="tierCode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Tier</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger><SelectValue placeholder="Select tier" /></SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="starter">Starter</SelectItem>
                            <SelectItem value="growth">Growth</SelectItem>
                            <SelectItem value="enterprise">Enterprise</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="phoneNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tenant Number (E.164)</FormLabel>
                      <FormControl>
                        <Input placeholder="+15005550006" {...field} />
                      </FormControl>
                      <div className="text-xs text-muted-foreground">
                        Outbound From + inbound routing key.
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="rounded-lg border bg-muted/50 p-3 flex items-center gap-2">
                  <MessageSquare size={14} className="text-primary shrink-0" />
                  <span className="text-xs text-muted-foreground">
                    Chatwoot inbox will be auto-provisioned on the Tableicity sovereign node.
                  </span>
                </div>
                <FormField
                  control={form.control}
                  name="knowledgeBase"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Knowledge Base</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Paste FAQs, product info, escalation rules..."
                          className="min-h-[100px] font-mono text-xs"
                          {...field}
                        />
                      </FormControl>
                      <div className="text-xs text-muted-foreground">
                        Used by the AI Student for Whisper drafts on inbound messages.
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="sovereignToggle"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                      <div className="space-y-0.5">
                        <FormLabel>Sovereign Lock</FormLabel>
                        <div className="text-xs text-muted-foreground">Strict data residency enforcing.</div>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <div className="flex justify-end pt-4">
                  <Button type="submit" disabled={createTenant.isPending}>
                    {createTenant.isPending ? "Creating..." : "Create Tenant"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="border rounded-lg bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Region</TableHead>
              <TableHead>Tier</TableHead>
              <TableHead>Chatwoot</TableHead>
              <TableHead>Sovereign</TableHead>
              <TableHead className="text-right">Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8">Loading...</TableCell></TableRow>
            ) : tenants?.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No tenants found.</TableCell></TableRow>
            ) : (
              tenants?.map((t) => (
                <TableRow key={t.id} className="group cursor-pointer">
                  <TableCell className="font-medium">
                    <Link href={`/tenants/${t.id}`} className="block">{t.name}</Link>
                  </TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">
                    <Link href={`/tenants/${t.id}`} className="block">{t.slug}</Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/tenants/${t.id}`} className="block">
                      <Badge variant="outline">{t.region}</Badge>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/tenants/${t.id}`} className="block">
                      <Badge variant="secondary" className="capitalize">{t.tierCode}</Badge>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/tenants/${t.id}`} className="block">
                      {t.chatwootInboxId ? (
                        <Badge variant="outline" className="text-emerald-600 border-emerald-300 text-xs">
                          Inbox {t.chatwootInboxId}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">-</span>
                      )}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/tenants/${t.id}`} className="block">
                      {t.sovereignToggle ? <ShieldCheck className="text-emerald-500 h-4 w-4" /> : <span className="text-muted-foreground">-</span>}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">
                    <Link href={`/tenants/${t.id}`} className="block">
                      {new Date(t.createdAt).toLocaleDateString()}
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
