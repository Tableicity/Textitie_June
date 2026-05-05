import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListDepartments,
  useCreateDepartment,
  useUpdateDepartment,
  useDeleteDepartment,
  useListPhoneNumbers,
  usePurchasePhoneNumber,
  useAssignPhoneNumber,
  useListAgents,
  useInviteAgent,
  useUpdateAgent,
  useDeleteAgent,
  useTenantMe,
  useListDispositions,
  useCreateDisposition,
  useUpdateDisposition,
  useArchiveDisposition,
  getListDepartmentsQueryKey,
  getListPhoneNumbersQueryKey,
  getListAgentsQueryKey,
  getTenantMeQueryKey,
  getListDispositionsQueryKey,
  type DepartmentItem,
  type AvailableNumberItem,
  type AgentItem,
  type Disposition,
} from "@workspace/api-client-react";
import { getTenantToken } from "@/lib/auth";
import {
  Settings as SettingsIcon,
  Plus,
  Phone,
  Users,
  Trash2,
  Edit2,
  Search,
  AlertCircle,
  Loader2,
  Building2,
  PhoneCall,
  UserPlus,
  Mail,
  CheckCircle2,
  Tag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AuditLogSection from "@/components/settings/AuditLogSection";
import ComplianceSection from "@/components/settings/ComplianceSection";
import IntegrationsSection from "@/components/settings/IntegrationsSection";
import SurveysSection from "@/components/settings/SurveysSection";
import { ScrollText, Shield, Plug, Star } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

export default function Settings() {
  return (
    <div className="h-full flex flex-col bg-slate-50 overflow-hidden">
      <div className="border-b border-slate-200 bg-white px-8 py-6 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center">
            <SettingsIcon className="w-5 h-5 text-slate-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Workspace Settings</h1>
            <p className="text-slate-500 text-sm mt-1">Manage departments, phone numbers, and team access.</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-8">
        <div className="max-w-6xl mx-auto">
          <Tabs defaultValue="departments" className="w-full">
            <TabsList className="mb-8">
              <TabsTrigger value="departments" className="flex items-center gap-2">
                <Building2 className="w-4 h-4" />
                Departments
              </TabsTrigger>
              <TabsTrigger value="phone-numbers" className="flex items-center gap-2">
                <PhoneCall className="w-4 h-4" />
                Phone Numbers
              </TabsTrigger>
              <TabsTrigger value="team" className="flex items-center gap-2">
                <Users className="w-4 h-4" />
                Team
              </TabsTrigger>
              <TabsTrigger value="dispositions" className="flex items-center gap-2" data-testid="tab-dispositions">
                <Tag className="w-4 h-4" />
                Dispositions
              </TabsTrigger>
              <TabsTrigger value="compliance" className="flex items-center gap-2" data-testid="tab-compliance">
                <Shield className="w-4 h-4" />
                Compliance
              </TabsTrigger>
              <TabsTrigger value="integrations" className="flex items-center gap-2" data-testid="tab-integrations">
                <Plug className="w-4 h-4" />
                Integrations
              </TabsTrigger>
              <TabsTrigger value="surveys" className="flex items-center gap-2" data-testid="tab-surveys">
                <Star className="w-4 h-4" />
                Surveys
              </TabsTrigger>
              <TabsTrigger value="audit-log" className="flex items-center gap-2" data-testid="tab-audit-log">
                <ScrollText className="w-4 h-4" />
                Audit Log
              </TabsTrigger>
            </TabsList>

            <TabsContent value="departments">
              <DepartmentsSection />
            </TabsContent>

            <TabsContent value="phone-numbers">
              <PhoneNumbersSection />
            </TabsContent>

            <TabsContent value="team">
              <TeamSection />
            </TabsContent>

            <TabsContent value="dispositions">
              <DispositionsSection />
            </TabsContent>

            <TabsContent value="compliance">
              <ComplianceSection />
            </TabsContent>

            <TabsContent value="integrations">
              <IntegrationsSection />
            </TabsContent>

            <TabsContent value="surveys">
              <SurveysSection />
            </TabsContent>

            <TabsContent value="audit-log">
              <AuditLogSection />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

function DepartmentsSection() {
  const queryClient = useQueryClient();
  const { data: departments, isLoading } = useListDepartments({
    query: { queryKey: getListDepartmentsQueryKey() },
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDesc, setCreateDesc] = useState("");

  const createMutation = useCreateDepartment({
    mutation: {
      onSuccess: () => {
        setCreateOpen(false);
        setCreateName("");
        setCreateDesc("");
        queryClient.invalidateQueries({ queryKey: getListDepartmentsQueryKey() });
      },
    },
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!createName.trim()) return;
    createMutation.mutate({ data: { name: createName, description: createDesc } });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Departments</h2>
          <p className="text-slate-500 text-sm">Create and manage communication lines for your organization.</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="bg-blue-600 hover:bg-blue-700">
              <Plus className="w-4 h-4 mr-2" />
              New Department
            </Button>
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={handleCreate}>
              <DialogHeader>
                <DialogTitle>Create Department</DialogTitle>
                <DialogDescription>Add a new department line for your workspace.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    placeholder="e.g. Customer Support"
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description (optional)</Label>
                  <Input
                    id="description"
                    placeholder="e.g. Handles all incoming support requests"
                    value={createDesc}
                    onChange={(e) => setCreateDesc(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" type="button" onClick={() => setCreateOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={!createName.trim() || createMutation.isPending}>
                  {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Create
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <Skeleton className="h-6 w-3/4 mb-4" />
                <Skeleton className="h-4 w-full mb-2" />
                <Skeleton className="h-4 w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : departments?.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-slate-200 border-dashed">
          <Building2 className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-slate-900 mb-1">No departments yet</h3>
          <p className="text-slate-500 text-sm mb-4">Create your first department to get started.</p>
          <Button variant="outline" onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Create Department
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {departments?.map((dept) => (
            <DepartmentCard key={dept.id} dept={dept} />
          ))}
        </div>
      )}
    </div>
  );
}

function DepartmentCard({ dept }: { dept: DepartmentItem }) {
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState(dept.name);
  const [editDesc, setEditDesc] = useState(dept.description || "");

  const updateMutation = useUpdateDepartment({
    mutation: {
      onSuccess: () => {
        setEditOpen(false);
        queryClient.invalidateQueries({ queryKey: getListDepartmentsQueryKey() });
      },
    },
  });

  const deleteMutation = useDeleteDepartment({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListDepartmentsQueryKey() });
      },
    },
  });

  const handleUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate({
      id: dept.id,
      data: { name: editName, description: editDesc },
    });
  };

  return (
    <Card className="flex flex-col hover:border-slate-300 transition-colors">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <CardTitle className="text-base font-semibold leading-tight">{dept.name}</CardTitle>
          <div className="flex gap-1">
            <Dialog open={editOpen} onOpenChange={setEditOpen}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-slate-600">
                  <Edit2 className="w-4 h-4" />
                </Button>
              </DialogTrigger>
              <DialogContent>
                <form onSubmit={handleUpdate}>
                  <DialogHeader>
                    <DialogTitle>Edit Department</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>Name</Label>
                      <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Description</Label>
                      <Input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" type="button" onClick={() => setEditOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={!editName.trim() || updateMutation.isPending}>
                      {updateMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      Save Changes
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>

            <Dialog>
              <DialogTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-red-600">
                  <Trash2 className="w-4 h-4" />
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Delete Department</DialogTitle>
                  <DialogDescription>
                    Are you sure you want to delete <strong>{dept.name}</strong>? This action cannot be undone.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline">Cancel</Button>
                  <Button
                    variant="destructive"
                    onClick={() => deleteMutation.mutate({ id: dept.id })}
                    disabled={deleteMutation.isPending}
                  >
                    {deleteMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
                    Delete
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
        <CardDescription className="line-clamp-2 text-xs">
          {dept.description || "No description provided."}
        </CardDescription>
      </CardHeader>
      <CardContent className="mt-auto pt-0 space-y-3">
        <div className="flex items-center gap-2 mt-4 text-sm font-medium">
          {dept.phoneNumber ? (
            <>
              <Phone className="w-4 h-4 text-blue-500" />
              <span className="text-slate-700">{dept.phoneNumber}</span>
            </>
          ) : (
            <Badge variant="secondary" className="font-normal text-slate-500 bg-slate-100">
              No number assigned
            </Badge>
          )}
        </div>
        <div className="space-y-2 pt-2 border-t border-slate-100">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-slate-500">Routing Strategy</Label>
            <Badge variant="outline" className="text-xs font-normal capitalize">
              {formatStrategy(dept.routingStrategy)}
            </Badge>
          </div>
          <Select
            value={dept.routingStrategy || "round_robin"}
            onValueChange={(value) =>
              updateMutation.mutate({
                id: dept.id,
                data: { routingStrategy: value },
              })
            }
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="round_robin">Round Robin</SelectItem>
              <SelectItem value="load_balanced">Load Balanced</SelectItem>
              <SelectItem value="last_assigned">Last Assigned</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}

function formatStrategy(s: string | undefined | null): string {
  if (!s) return "Round Robin";
  return s.replace(/_/g, " ");
}

function PhoneNumbersSection() {
  const queryClient = useQueryClient();
  const { data: phoneNumbers, isLoading: loadingNumbers } = useListPhoneNumbers({
    query: { queryKey: getListPhoneNumbersQueryKey() },
  });

  const { data: departments } = useListDepartments({
    query: { queryKey: getListDepartmentsQueryKey() },
  });

  const [country, setCountry] = useState("US");
  const [areaCode, setAreaCode] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<AvailableNumberItem[]>([]);
  const [reassignDeptId, setReassignDeptId] = useState<string>("");
  const [purchaseDeptId, setPurchaseDeptId] = useState<string>("");

  const searchNumbers = async () => {
    if (!areaCode.trim()) return;
    setIsSearching(true);
    setSearchError(null);
    setSearchResults([]);

    try {
      const token = getTenantToken();
      const res = await fetch(`/api/phone-numbers/available?country=${country}&areaCode=${areaCode}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 503) {
        setSearchError("Twilio integration is not configured yet. Please configure Twilio in the Conductor to search and purchase numbers.");
      } else if (!res.ok) {
        setSearchError("Failed to search for available numbers.");
      } else {
        const data = await res.json();
        setSearchResults(data);
      }
    } catch (e) {
      setSearchError("Network error occurred while searching.");
    } finally {
      setIsSearching(false);
    }
  };

  const assignMutation = useAssignPhoneNumber({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPhoneNumbersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListDepartmentsQueryKey() });
      },
    },
  });

  const purchaseMutation = usePurchasePhoneNumber({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPhoneNumbersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListDepartmentsQueryKey() });
        setSearchResults([]);
      },
    },
  });

  return (
    <div className="space-y-8">
      {/* Current Numbers */}
      <div>
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Assigned Numbers</h2>
        {loadingNumbers ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : phoneNumbers?.length === 0 ? (
          <div className="text-center py-8 bg-white rounded-xl border border-slate-200">
            <Phone className="w-8 h-8 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 text-sm">No phone numbers have been assigned to departments yet.</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-medium">
                <tr>
                  <th className="px-6 py-3">Phone Number</th>
                  <th className="px-6 py-3">Department</th>
                  <th className="px-6 py-3">Twilio SID</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {phoneNumbers?.map((pn, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-6 py-3 font-medium text-slate-900">{pn.phoneNumber}</td>
                    <td className="px-6 py-3">{pn.departmentName}</td>
                    <td className="px-6 py-3 text-slate-400 font-mono text-xs">{pn.twilioSid || "-"}</td>
                    <td className="px-6 py-3 text-right">
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="ghost" size="sm" className="text-blue-600 hover:text-blue-800">
                            Reassign
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Reassign Number</DialogTitle>
                            <DialogDescription>
                              Assign <strong>{pn.phoneNumber}</strong> to a different department.
                            </DialogDescription>
                          </DialogHeader>
                          <div className="py-4">
                            <Label className="mb-2 block">Department</Label>
                            <Select value={reassignDeptId} onValueChange={setReassignDeptId}>
                              <SelectTrigger>
                                <SelectValue placeholder="Select a department" />
                              </SelectTrigger>
                              <SelectContent>
                                {departments?.map(d => (
                                  <SelectItem key={d.id} value={d.id.toString()}>{d.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <DialogFooter>
                            <Button variant="outline">Cancel</Button>
                            <Button
                              className="bg-blue-600 hover:bg-blue-700"
                              disabled={assignMutation.isPending || !reassignDeptId}
                              onClick={() => {
                                if (!reassignDeptId) return;
                                assignMutation.mutate({
                                  data: {
                                    phoneNumber: pn.phoneNumber,
                                    twilioSid: pn.twilioSid || undefined,
                                    departmentId: parseInt(reassignDeptId),
                                  }
                                });
                                setReassignDeptId("");
                              }}
                            >
                              {assignMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                              Reassign
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Search & Purchase */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Get a New Number</CardTitle>
          <CardDescription>Search available numbers to purchase for your workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-4 max-w-xl">
            <div className="space-y-2 flex-1">
              <Label>Country Code</Label>
              <Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="US" />
            </div>
            <div className="space-y-2 flex-1">
              <Label>Area Code</Label>
              <Input value={areaCode} onChange={(e) => setAreaCode(e.target.value)} placeholder="e.g. 415" />
            </div>
            <Button onClick={searchNumbers} disabled={isSearching || !areaCode.trim()} className="bg-blue-600 hover:bg-blue-700">
              {isSearching ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
              Search
            </Button>
          </div>

          {searchError && (
            <Alert variant="destructive" className="mt-6">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Search Unavailable</AlertTitle>
              <AlertDescription>{searchError}</AlertDescription>
            </Alert>
          )}

          {searchResults.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-medium text-slate-900 mb-3">Available Numbers</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {searchResults.map((num) => (
                  <div key={num.phoneNumber} className="flex flex-col justify-between p-4 border border-slate-200 rounded-lg hover:border-blue-300 transition-colors bg-slate-50">
                    <div>
                      <div className="font-semibold text-slate-900">{num.friendlyName}</div>
                      <div className="text-xs text-slate-500 mt-1">
                        {num.locality && `${num.locality}, `}{num.region} {num.isoCountry}
                      </div>
                    </div>
                    
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button size="sm" className="w-full mt-4 bg-white hover:bg-slate-100 text-blue-600 border-blue-200" variant="outline">
                          Purchase
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Purchase Number</DialogTitle>
                          <DialogDescription>
                            Are you sure you want to purchase <strong>{num.friendlyName}</strong>?
                          </DialogDescription>
                        </DialogHeader>
                        
                        <div className="py-4">
                          <Label className="mb-2 block">Assign to Department (Optional)</Label>
                          <Select value={purchaseDeptId} onValueChange={setPurchaseDeptId}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select a department" />
                            </SelectTrigger>
                            <SelectContent>
                              {departments?.map(d => (
                                <SelectItem key={d.id} value={d.id.toString()}>{d.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        
                        <DialogFooter>
                          <Button variant="outline">Cancel</Button>
                          <Button 
                            className="bg-blue-600 hover:bg-blue-700"
                            onClick={() => {
                              const deptId = purchaseDeptId ? parseInt(purchaseDeptId) : undefined;
                              purchaseMutation.mutate({
                                data: { phoneNumber: num.phoneNumber, departmentId: deptId }
                              });
                              setPurchaseDeptId("");
                            }}
                            disabled={purchaseMutation.isPending}
                          >
                            {purchaseMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : "Confirm Purchase"}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>

                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TeamSection() {
  const queryClient = useQueryClient();
  const { data: agents, isLoading } = useListAgents({
    query: { queryKey: getListAgentsQueryKey() },
  });
  const { data: meData } = useTenantMe({
    query: { queryKey: getTenantMeQueryKey() },
  });
  const currentRole = meData?.user?.role || "agent";
  const isAdmin = currentRole === "admin";

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [invitePassword, setInvitePassword] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("agent");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);

  const inviteMutation = useInviteAgent({
    mutation: {
      onSuccess: (created) => {
        setInviteSuccess(`Invited ${created.name} (${created.email}).`);
        setInviteError(null);
        setInviteEmail("");
        setInviteName("");
        setInvitePassword("");
        setInviteRole("agent");
        queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
      },
      onError: (err: any) => {
        setInviteError(err?.message || "Failed to invite agent.");
        setInviteSuccess(null);
      },
    },
  });

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError(null);
    setInviteSuccess(null);
    if (!inviteEmail.trim() || !inviteName.trim() || !invitePassword.trim()) return;
    inviteMutation.mutate({
      data: {
        email: inviteEmail.trim(),
        name: inviteName.trim(),
        password: invitePassword,
        role: inviteRole,
      },
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Agents</h2>
          <p className="text-slate-500 text-sm">
            Manage agents, their roles, skills, and department memberships.
          </p>
        </div>

        <Dialog
          open={inviteOpen}
          onOpenChange={(open) => {
            setInviteOpen(open);
            if (!open) {
              setInviteError(null);
              setInviteSuccess(null);
            }
          }}
        >
          <DialogTrigger asChild>
            <Button className="bg-blue-600 hover:bg-blue-700">
              <UserPlus className="w-4 h-4 mr-2" />
              Invite Agent
            </Button>
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={handleInvite}>
              <DialogHeader>
                <DialogTitle>Invite Agent</DialogTitle>
                <DialogDescription>
                  Create a new tenant user. They will be able to log in with the credentials you set.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                {inviteError && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Invite failed</AlertTitle>
                    <AlertDescription>{inviteError}</AlertDescription>
                  </Alert>
                )}
                {inviteSuccess && (
                  <Alert>
                    <CheckCircle2 className="h-4 w-4" />
                    <AlertTitle>Success</AlertTitle>
                    <AlertDescription>{inviteSuccess}</AlertDescription>
                  </Alert>
                )}
                <div className="space-y-2">
                  <Label htmlFor="invite-email">Email</Label>
                  <Input
                    id="invite-email"
                    type="email"
                    placeholder="agent@company.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invite-name">Name</Label>
                  <Input
                    id="invite-name"
                    placeholder="Jane Doe"
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invite-password">Password</Label>
                  <Input
                    id="invite-password"
                    type="password"
                    placeholder="Minimum 8 characters"
                    value={invitePassword}
                    onChange={(e) => setInvitePassword(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Select value={inviteRole} onValueChange={setInviteRole}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="agent">Agent</SelectItem>
                      <SelectItem value="supervisor">Supervisor</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" type="button" onClick={() => setInviteOpen(false)}>
                  Close
                </Button>
                <Button
                  type="submit"
                  disabled={
                    inviteMutation.isPending ||
                    !inviteEmail.trim() ||
                    !inviteName.trim() ||
                    !invitePassword.trim()
                  }
                >
                  {inviteMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Send Invite
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="p-6 space-y-3">
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-2/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : agents?.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-slate-200 border-dashed">
          <Users className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-slate-900 mb-1">No agents yet</h3>
          <p className="text-slate-500 text-sm mb-4">
            Invite your first teammate to get started.
          </p>
          <Button variant="outline" onClick={() => setInviteOpen(true)}>
            <UserPlus className="w-4 h-4 mr-2" />
            Invite Agent
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {agents?.map((agent) => (
            <AgentCard key={agent.id} agent={agent} isAdmin={isAdmin} />
          ))}
        </div>
      )}
    </div>
  );
}

function roleBadgeClasses(role: string): string {
  switch (role) {
    case "admin":
      return "bg-purple-100 text-purple-700 border-purple-200";
    case "supervisor":
      return "bg-blue-100 text-blue-700 border-blue-200";
    default:
      return "bg-slate-100 text-slate-700 border-slate-200";
  }
}

function statusDotColor(status: string): string {
  switch (status) {
    case "online":
      return "bg-green-500";
    case "away":
      return "bg-yellow-500";
    default:
      return "bg-slate-400";
  }
}

function AgentCard({ agent, isAdmin }: { agent: AgentItem; isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [name, setName] = useState(agent.name);
  const [role, setRole] = useState(agent.role);
  const [skills, setSkills] = useState((agent.skills || []).join(", "));
  const [languages, setLanguages] = useState((agent.languages || []).join(", "));
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    if (editOpen) {
      setName(agent.name);
      setRole(agent.role);
      setSkills((agent.skills || []).join(", "));
      setLanguages((agent.languages || []).join(", "));
      setEditError(null);
    }
  }, [editOpen, agent]);

  const updateMutation = useUpdateAgent({
    mutation: {
      onSuccess: () => {
        setEditOpen(false);
        queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
      },
      onError: (err: any) => {
        setEditError(err?.message || "Failed to update agent.");
      },
    },
  });

  const deleteMutation = useDeleteAgent({
    mutation: {
      onSuccess: () => {
        setDeleteOpen(false);
        queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
      },
    },
  });

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setEditError(null);
    const skillsArr = skills
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const languagesArr = languages
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    updateMutation.mutate({
      id: agent.id,
      data: {
        name: name.trim(),
        ...(isAdmin ? { role } : {}),
        skills: skillsArr,
        languages: languagesArr,
      },
    });
  };

  return (
    <Card className="flex flex-col hover:border-slate-300 transition-colors">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="relative flex-shrink-0 mt-0.5">
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-sm uppercase">
                {agent.name.substring(0, 2)}
              </div>
              <span
                className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${statusDotColor(
                  agent.status,
                )}`}
                title={agent.status}
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle className="text-base font-semibold leading-tight truncate">
                  {agent.name}
                </CardTitle>
                <Badge
                  variant="outline"
                  className={`text-[10px] uppercase font-medium ${roleBadgeClasses(agent.role)}`}
                >
                  {agent.role}
                </Badge>
              </div>
              <div className="flex items-center gap-1 text-xs text-slate-500 mt-0.5 truncate">
                <Mail className="w-3 h-3 flex-shrink-0" />
                <span className="truncate">{agent.email}</span>
              </div>
            </div>
          </div>
          <div className="flex gap-1 flex-shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-slate-400 hover:text-slate-600"
              onClick={() => setEditOpen(true)}
            >
              <Edit2 className="w-4 h-4" />
            </Button>
            {isAdmin && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-slate-400 hover:text-red-600"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 mt-auto">
        {agent.skills && agent.skills.length > 0 && (
          <div>
            <div className="text-[11px] uppercase font-medium text-slate-500 mb-1.5">
              Skills
            </div>
            <div className="flex flex-wrap gap-1">
              {agent.skills.map((s) => (
                <Badge key={s} variant="secondary" className="text-xs font-normal">
                  {s}
                </Badge>
              ))}
            </div>
          </div>
        )}
        {agent.languages && agent.languages.length > 0 && (
          <div>
            <div className="text-[11px] uppercase font-medium text-slate-500 mb-1.5">
              Languages
            </div>
            <div className="flex flex-wrap gap-1">
              {agent.languages.map((l) => (
                <Badge key={l} variant="secondary" className="text-xs font-normal">
                  {l}
                </Badge>
              ))}
            </div>
          </div>
        )}
        <div>
          <div className="text-[11px] uppercase font-medium text-slate-500 mb-1.5">
            Departments
          </div>
          {agent.departments && agent.departments.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {agent.departments.map((d) => (
                <Badge key={d.id} variant="outline" className="text-xs font-normal">
                  <Building2 className="w-3 h-3 mr-1" />
                  {d.name}
                </Badge>
              ))}
            </div>
          ) : (
            <div className="text-xs text-slate-400">No department assignments.</div>
          )}
        </div>
      </CardContent>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <form onSubmit={handleSave}>
            <DialogHeader>
              <DialogTitle>Edit Agent</DialogTitle>
              <DialogDescription>
                Update profile, skills, and languages for {agent.name}.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {editError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Update failed</AlertTitle>
                  <AlertDescription>{editError}</AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={role} onValueChange={setRole} disabled={!isAdmin}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="agent">Agent</SelectItem>
                    <SelectItem value="supervisor">Supervisor</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
                {!isAdmin && (
                  <p className="text-xs text-slate-500">
                    Only admins can change agent roles.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Skills</Label>
                <Input
                  placeholder="e.g. billing, technical, sales"
                  value={skills}
                  onChange={(e) => setSkills(e.target.value)}
                />
                <p className="text-xs text-slate-500">Comma-separated list of skills.</p>
              </div>
              <div className="space-y-2">
                <Label>Languages</Label>
                <Input
                  placeholder="e.g. en, es, fr"
                  value={languages}
                  onChange={(e) => setLanguages(e.target.value)}
                />
                <p className="text-xs text-slate-500">Comma-separated list of languages.</p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={updateMutation.isPending || !name.trim()}>
                {updateMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Agent</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{agent.name}</strong>? This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate({ id: agent.id })}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4 mr-2" />
              )}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

const DEFAULT_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#64748b"];

function DispositionsSection() {
  const queryClient = useQueryClient();
  const { data: dispositions, isLoading } = useListDispositions({
    query: { queryKey: getListDispositionsQueryKey() },
  });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Disposition | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftColor, setDraftColor] = useState(DEFAULT_COLORS[0]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListDispositionsQueryKey() });
  };

  const createMutation = useCreateDisposition({
    mutation: {
      onSuccess: () => {
        invalidate();
        setCreating(false);
        setDraftLabel("");
        setDraftColor(DEFAULT_COLORS[0]);
      },
    },
  });

  const updateMutation = useUpdateDisposition({
    mutation: {
      onSuccess: () => {
        invalidate();
        setEditing(null);
      },
    },
  });

  const archiveMutation = useArchiveDisposition({ mutation: { onSuccess: invalidate } });

  const startEdit = (d: Disposition) => {
    setEditing(d);
    setDraftLabel(d.label);
    setDraftColor(d.color || DEFAULT_COLORS[0]);
  };

  const active = dispositions?.filter((d) => !d.archived) ?? [];
  const archived = dispositions?.filter((d) => d.archived) ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Tag className="w-5 h-5" />
            Dispositions
          </CardTitle>
          <CardDescription>
            Resolution categories agents pick when closing a conversation.
          </CardDescription>
        </div>
        <Button
          className="bg-blue-600 hover:bg-blue-700"
          onClick={() => {
            setDraftLabel("");
            setDraftColor(DEFAULT_COLORS[0]);
            setCreating(true);
          }}
          data-testid="button-new-disposition"
        >
          <Plus className="w-4 h-4 mr-2" /> New disposition
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : active.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-sm">
            No dispositions yet. Add categories like "Resolved", "Spam", or "Sales lead" to track outcomes.
          </div>
        ) : (
          <div className="space-y-2">
            {active.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between p-3 border border-slate-200 rounded-lg bg-white"
                data-testid={`disposition-row-${d.id}`}
              >
                <div className="flex items-center gap-3">
                  <span
                    className="w-4 h-4 rounded-full border border-slate-200"
                    style={{ backgroundColor: d.color }}
                  />
                  <span className="font-medium text-slate-900">{d.label}</span>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => startEdit(d)}>
                    <Edit2 className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-600 hover:bg-red-50"
                    onClick={() => archiveMutation.mutate({ id: d.id })}
                    disabled={archiveMutation.isPending}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        {archived.length > 0 && (
          <div className="mt-6 pt-6 border-t border-slate-200">
            <Label className="text-xs uppercase tracking-wider text-slate-400 mb-2 block">
              Archived
            </Label>
            <div className="space-y-1">
              {archived.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between px-3 py-2 text-xs text-slate-400"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="w-3 h-3 rounded-full opacity-50"
                      style={{ backgroundColor: d.color }}
                    />
                    <span className="line-through">{d.label}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() =>
                      updateMutation.mutate({ id: d.id, data: { archived: false } })
                    }
                  >
                    Restore
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>

      <Dialog
        open={creating || !!editing}
        onOpenChange={(o) => {
          if (!o) {
            setCreating(false);
            setEditing(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit disposition" : "New disposition"}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!draftLabel.trim()) return;
              if (editing) {
                updateMutation.mutate({
                  id: editing.id,
                  data: { label: draftLabel.trim(), color: draftColor },
                });
              } else {
                createMutation.mutate({
                  data: { label: draftLabel.trim(), color: draftColor },
                });
              }
            }}
            className="space-y-4 py-2"
          >
            <div>
              <Label className="mb-1.5 block">Label</Label>
              <Input
                value={draftLabel}
                onChange={(e) => setDraftLabel(e.target.value)}
                placeholder="Resolved, Spam, Sales lead..."
                required
                maxLength={80}
                data-testid="input-disposition-label"
              />
            </div>
            <div>
              <Label className="mb-1.5 block">Color</Label>
              <div className="flex gap-2 flex-wrap">
                {DEFAULT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setDraftColor(c)}
                    className={`w-8 h-8 rounded-full border-2 transition ${
                      draftColor === c ? "border-slate-900 scale-110" : "border-slate-200"
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setCreating(false);
                  setEditing(null);
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-blue-600 hover:bg-blue-700"
                disabled={createMutation.isPending || updateMutation.isPending || !draftLabel.trim()}
                data-testid="button-save-disposition"
              >
                {(createMutation.isPending || updateMutation.isPending) && (
                  <Loader2 className="w-3 h-3 animate-spin mr-2" />
                )}
                {editing ? "Save" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
