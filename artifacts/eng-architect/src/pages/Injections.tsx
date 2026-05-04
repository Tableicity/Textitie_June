import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { useListInjections, useInjectMessage, useListTenants, getListInjectionsQueryKey } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { useToast } from "@/hooks/use-toast";
import { Zap } from "lucide-react";

const formSchema = z.object({
  tenantId: z.string().optional(),
  to: z.string().min(3, "Phone number is required"),
  body: z.string().min(1, "Message body is required"),
});

export default function Injections() {
  const { data: injections, isLoading: injectionsLoading } = useListInjections({ limit: 200 });
  const { data: tenants } = useListTenants();
  const injectMessage = useInjectMessage();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      tenantId: "none",
      to: "",
      body: "",
    },
  });

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    injectMessage.mutate(
      {
        data: {
          to: values.to,
          body: values.body,
          tenantId: values.tenantId && values.tenantId !== "none" ? Number(values.tenantId) : null,
          conductorAuthorized: true,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListInjectionsQueryKey() });
          form.reset();
          toast({ title: "Injection Sent", description: "Message pushed to pipe successfully." });
        },
        onError: (err) => {
          toast({ title: "Injection Failed", description: err.message || "An error occurred", variant: "destructive" });
        }
      }
    );
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Injections</h1>
        <p className="text-muted-foreground mt-2">Global message injection log and composer.</p>
      </div>

      <Card className="border-primary/20">
        <CardContent className="pt-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="tenantId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tenant Scope (Optional)</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select a tenant" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">-- Global / No Tenant --</SelectItem>
                          {tenants?.map((t) => (
                            <SelectItem key={t.id} value={t.id.toString()}>
                              {t.name} ({t.slug})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
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
              </div>
              <FormField
                control={form.control}
                name="body"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Message Body</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Message content..." className="min-h-[80px]" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex justify-end pt-2">
                <Button type="submit" disabled={injectMessage.isPending} className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2">
                  <Zap size={16} /> {injectMessage.isPending ? "Injecting..." : "Fire Injection"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      <div className="border rounded-lg bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Created</TableHead>
              <TableHead>Tenant</TableHead>
              <TableHead>To</TableHead>
              <TableHead className="w-1/3">Body</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Response</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {injectionsLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8">Loading log...</TableCell></TableRow>
            ) : injections?.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">Pipe is quiet — fire your first injection</TableCell></TableRow>
            ) : (
              injections?.map((inj) => {
                const t = tenants?.find((t) => t.id === inj.tenantId);
                return (
                  <TableRow key={inj.id}>
                    <TableCell className="text-sm font-mono text-muted-foreground whitespace-nowrap">
                      {new Date(inj.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-medium text-sm">
                      {t ? t.name : <span className="text-muted-foreground italic">Global</span>}
                    </TableCell>
                    <TableCell className="font-mono text-sm">{inj.toNumber}</TableCell>
                    <TableCell className="text-sm truncate max-w-[200px]" title={inj.body}>{inj.body}</TableCell>
                    <TableCell><StatusBadge status={inj.status} /></TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground truncate max-w-[150px]">
                      {inj.responseSummary || "-"}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
