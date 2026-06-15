import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListDepartments, useCreateDepartment } from "@workspace/api-client-react";
import { Building2, Plus, Loader2, PhoneCall } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionHeader } from "./components/SectionHeader";

export default function Departments() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: departments, isLoading, queryKey } = useListDepartments();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const createMutation = useCreateDepartment({
    mutation: {
      onSuccess: () => {
        if (queryKey) queryClient.invalidateQueries({ queryKey });
        setName("");
        setDescription("");
        toast({ title: "Department created", description: "Your new department is ready." });
      },
      onError: (err: any) => {
        toast({ title: "Create failed", description: err?.response?.data?.error ?? "Please try again.", variant: "destructive" });
      },
    },
  });

  const canCreate = name.trim().length > 0 && !createMutation.isPending;
  const handleCreate = () => {
    if (!canCreate) return;
    createMutation.mutate({ data: { name: name.trim(), description: description.trim() || undefined } });
  };

  return (
    <div>
      <SectionHeader
        title="Departments"
        subtitle="Organize agents into teams. Each department can own a phone number and routing strategy."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : !departments || departments.length === 0 ? (
              <div className="text-center py-12">
                <Building2 className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                <p className="text-slate-500 text-sm">No departments yet. Create your first one.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {departments.map((dept) => (
                  <div key={dept.id} className="px-6 py-4" data-testid={`department-row-${dept.id}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900">{dept.name}</p>
                        {dept.description && (
                          <p className="text-xs text-slate-400 mt-0.5">{dept.description}</p>
                        )}
                      </div>
                      {dept.phoneNumber && (
                        <span className="inline-flex items-center gap-1 text-xs text-slate-500 flex-shrink-0">
                          <PhoneCall className="w-3.5 h-3.5" />
                          {dept.phoneNumber}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Plus className="w-4 h-4 text-slate-500" />
              New department
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="dept-name" className="text-xs uppercase tracking-wide text-slate-500">Name</Label>
              <Input
                id="dept-name"
                placeholder="e.g. Support"
                value={name}
                onChange={(e) => setName(e.target.value)}
                data-testid="input-department-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dept-desc" className="text-xs uppercase tracking-wide text-slate-500">Description</Label>
              <Input
                id="dept-desc"
                placeholder="Optional"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                data-testid="input-department-description"
              />
            </div>
            <Button className="w-full" onClick={handleCreate} disabled={!canCreate} data-testid="button-create-department">
              {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Create department
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
