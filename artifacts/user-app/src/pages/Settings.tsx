import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListDepartments,
  useCreateDepartment,
  useUpdateDepartment,
  useDeleteDepartment,
  useListDepartmentMembers,
  useAddDepartmentMember,
  useRemoveDepartmentMember,
  useListPhoneNumbers,
  usePurchasePhoneNumber,
  useAssignPhoneNumber,
  getListDepartmentsQueryKey,
  getListDepartmentMembersQueryKey,
  getListPhoneNumbersQueryKey,
  type DepartmentItem,
  type AvailableNumberItem,
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
  CheckCircle2,
  PhoneCall,
  UserPlus,
  UserMinus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
      <CardContent className="mt-auto pt-0">
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
      </CardContent>
    </Card>
  );
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
  const { data: departments, isLoading: loadingDepts } = useListDepartments({
    query: { queryKey: getListDepartmentsQueryKey() },
  });

  const [selectedDeptId, setSelectedDeptId] = useState<string>("");

  const { data: members, isLoading: loadingMembers } = useListDepartmentMembers(
    selectedDeptId ? parseInt(selectedDeptId) : 0,
    { query: { enabled: !!selectedDeptId, queryKey: getListDepartmentMembersQueryKey(parseInt(selectedDeptId)) } }
  );

  const [addUserId, setAddUserId] = useState("");
  const addMutation = useAddDepartmentMember({
    mutation: {
      onSuccess: () => {
        setAddUserId("");
        if (selectedDeptId) {
          queryClient.invalidateQueries({ queryKey: getListDepartmentMembersQueryKey(parseInt(selectedDeptId)) });
        }
      }
    }
  });

  const removeMutation = useRemoveDepartmentMember({
    mutation: {
      onSuccess: () => {
        if (selectedDeptId) {
          queryClient.invalidateQueries({ queryKey: getListDepartmentMembersQueryKey(parseInt(selectedDeptId)) });
        }
      }
    }
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Department Members</h2>
          <p className="text-slate-500 text-sm">Manage which agents have access to specific department lines.</p>
        </div>
        
        <div className="w-full sm:w-64">
          <Select value={selectedDeptId} onValueChange={setSelectedDeptId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={loadingDepts ? "Loading..." : "Select a department"} />
            </SelectTrigger>
            <SelectContent>
              {departments?.map((d) => (
                <SelectItem key={d.id} value={d.id.toString()}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {selectedDeptId ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <CardTitle className="text-base">Assigned Agents</CardTitle>
              <CardDescription>Agents assigned to this department can view and reply to its messages.</CardDescription>
            </div>
            
            <Dialog>
              <DialogTrigger asChild>
                <Button size="sm" className="bg-blue-600 hover:bg-blue-700">
                  <UserPlus className="w-4 h-4 mr-2" />
                  Add Member
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Member to Department</DialogTitle>
                  <DialogDescription>
                    Enter the User ID of the agent you want to assign to this department.
                  </DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-4">
                  <div className="space-y-2">
                    <Label>Tenant User ID</Label>
                    <Input 
                      type="number" 
                      placeholder="e.g. 1" 
                      value={addUserId} 
                      onChange={(e) => setAddUserId(e.target.value)} 
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline">Cancel</Button>
                  <Button 
                    onClick={() => addMutation.mutate({ 
                      id: parseInt(selectedDeptId), 
                      data: { tenantUserId: parseInt(addUserId) } 
                    })}
                    disabled={!addUserId || addMutation.isPending}
                  >
                    {addMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Add Member
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent className="p-0">
            {loadingMembers ? (
              <div className="p-6 space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : members?.length === 0 ? (
              <div className="p-12 text-center text-slate-500 text-sm">
                <Users className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                No agents assigned to this department yet.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {members?.map(member => (
                  <div key={member.id} className="flex items-center justify-between p-4 hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-sm uppercase">
                        {member.name.substring(0, 2)}
                      </div>
                      <div>
                        <div className="font-medium text-slate-900">{member.name}</div>
                        <div className="text-xs text-slate-500">{member.email} • {member.role}</div>
                      </div>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="text-red-500 hover:text-red-700 hover:bg-red-50"
                      onClick={() => removeMutation.mutate({ id: parseInt(selectedDeptId), userId: member.tenantUserId })}
                      disabled={removeMutation.isPending}
                    >
                      <UserMinus className="w-4 h-4 mr-2" />
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="p-12 text-center border border-slate-200 border-dashed rounded-xl bg-white">
          <Building2 className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h3 className="text-base font-medium text-slate-900 mb-1">Select a Department</h3>
          <p className="text-sm text-slate-500">Choose a department from the dropdown above to view and manage its members.</p>
        </div>
      )}
    </div>
  );
}
