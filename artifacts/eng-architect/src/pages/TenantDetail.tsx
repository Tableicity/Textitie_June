import { useParams } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { useGetTenant, getGetTenantQueryKey, useInjectMessage, getListInjectionsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, Zap, Server, Shield } from "lucide-react";

const formSchema = z.object({
  to: z.string().min(3, "Phone number is required"),
  body: z.string().min(1, "Message body is required"),
});

export default function TenantDetail() {
  const params = useParams();
  const tenantId = params.id ? parseInt(params.id, 10) : 0;
  
  const { data: tenant, isLoading } = useGetTenant(tenantId, {
    query: {
      enabled: !!tenantId,
      queryKey: getGetTenantQueryKey(tenantId)
    }
  });

  const injectMessage = useInjectMessage();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      to: "",
      body: "",
    },
  });

  const onSubmit = (values: z.infer<typeof formSchema>) => {
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
          form.reset();
          toast({ title: "Injection Sent", description: `Message pushed to ${tenant.name} pipe successfully.` });
        },
        onError: (err) => {
          toast({ title: "Injection Failed", description: err.error || "An error occurred", variant: "destructive" });
        }
      }
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

      <Card className="border-primary/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-primary">
            <Zap size={20} /> Scoped Injection
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 max-w-2xl">
              <FormField
                control={form.control}
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
                control={form.control}
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
