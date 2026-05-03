import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { useInjectMessage, useListTenants, getListInjectionsQueryKey } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Zap } from "lucide-react";

const formSchema = z.object({
  tenantId: z.string().optional(),
  to: z.string().min(3, "Phone number is required"),
  body: z.string().min(1, "Message body is required"),
});

type FormValues = z.infer<typeof formSchema>;

export function InjectComposerDialog({ trigger, defaultTenantId }: { trigger?: React.ReactNode, defaultTenantId?: string }) {
  const [open, setOpen] = useState(false);
  const { data: tenants } = useListTenants();
  const injectMessage = useInjectMessage();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      tenantId: defaultTenantId || "none",
      to: "",
      body: "",
    },
  });

  const onSubmit = (values: FormValues) => {
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
          // also invalidate stats if we had the key, assuming we fetch it again
          queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
          setOpen(false);
          form.reset();
          toast({ title: "Injection Sent", description: "Message pushed to pipe successfully." });
        },
        onError: (err) => {
          toast({ title: "Injection Failed", description: err.error || "An error occurred", variant: "destructive" });
        }
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || <Button><Zap className="w-4 h-4 mr-2" /> Inject</Button>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Inject Message</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="tenantId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Send as Tenant</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a tenant" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="none">-- Global (default From) --</SelectItem>
                      {tenants?.map((t) => (
                        <SelectItem key={t.id} value={t.id.toString()}>
                          {t.name} ({t.slug}){t.phoneNumber ? ` — ${t.phoneNumber}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="text-xs text-muted-foreground">
                    Drives the From number, plus the Chatwoot Whisper if the tenant has an inbox wired.
                  </div>
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
            <FormField
              control={form.control}
              name="body"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Message Body</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Message content..." className="min-h-[100px]" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end pt-4">
              <Button type="submit" disabled={injectMessage.isPending} className="bg-primary text-primary-foreground hover:bg-primary/90">
                {injectMessage.isPending ? "Injecting..." : "Fire Injection"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
