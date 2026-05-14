import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';

type UserRow = {
  id: string;
  username: string;
  name: string;
  role: string;
  callsign?: string | null;
  unit?: string | null;
  phone?: string | null;
  isActive: boolean;
};

type EditState = {
  id?: string;
  username: string;
  name: string;
  role: string;
  callsign: string;
  unit: string;
  phone: string;
  isActive: boolean;
  password: string;
};

const RESPONDER_UNITS = [
  { value: 'EMS', label: 'EMS' },
  { value: 'TRAFFIC_POLICE', label: 'Traffic Police' },
  { value: 'CRIME_POLICE', label: 'Crime Police' },
] as const;

const emptyEdit: EditState = {
  id: undefined,
  username: '',
  name: '',
  role: 'dispatcher',
  callsign: '',
  unit: '',
  phone: '',
  isActive: true,
  password: '',
};

export function UserManagementPanel() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [editOpen, setEditOpen] = useState(false);
  const [editState, setEditState] = useState<EditState>(emptyEdit);

  const { data: users = [], isLoading } = useQuery<UserRow[]>({
    queryKey: ['users', { search, roleFilter, statusFilter }],
    queryFn: () =>
      api.getUsers({
        q: search || undefined,
        role: roleFilter === 'all' ? undefined : roleFilter,
        status: statusFilter === 'all' ? undefined : statusFilter,
      }),
    staleTime: 5000,
  });

  const createOrUpdate = useMutation({
    mutationFn: async (payload: EditState) => {
      if (payload.id) {
        const { id, username: _u, ...rest } = payload;
        return api.updateUser(id, {
          name: rest.name,
          role: rest.role,
          callsign: rest.callsign || undefined,
          unit: rest.unit || undefined,
          phone: rest.phone || undefined,
          isActive: rest.isActive,
          password: rest.password || undefined,
        });
      }
      return api.createUser({
        username: payload.username,
        name: payload.name,
        role: payload.role,
        callsign: payload.callsign || undefined,
        unit: payload.unit || undefined,
        phone: payload.phone || undefined,
        isActive: payload.isActive,
        password: payload.password || undefined,
      });
    },
    onSuccess: (result: { temporaryPassword?: string } | void) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setEditOpen(false);
      setEditState(emptyEdit);
      if (result?.temporaryPassword) {
        toast({
          title: 'User created',
          description: `Temporary password: ${result.temporaryPassword}`,
        });
      } else {
        toast({ title: 'User saved', description: 'User details were updated.' });
      }
    },
    onError: (err: unknown) => {
      toast({ title: 'User save failed', description: String(err), variant: 'destructive' });
    },
  });

  const resetPassword = useMutation({
    mutationFn: async (user: UserRow) => {
      const newPassword = window.prompt(`Enter new password for ${user.username}`);
      if (!newPassword) return;
      await api.resetUserPassword(user.id, newPassword);
      return newPassword;
    },
    onSuccess: (pwd, user) => {
      if (!pwd || !user) return;
      toast({
        title: 'Password reset',
        description: `Password for ${user.username} updated.`,
      });
    },
    onError: (err: unknown) => {
      toast({ title: 'Password reset failed', description: String(err), variant: 'destructive' });
    },
  });

  const toggleActive = useMutation({
    mutationFn: async (user: UserRow) => {
      if (user.isActive) {
        await api.deactivateUser(user.id);
      } else {
        await api.activateUser(user.id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err: unknown) => {
      toast({ title: 'Status change failed', description: String(err), variant: 'destructive' });
    },
  });

  const openCreate = () => {
    setEditState(emptyEdit);
    setEditOpen(true);
  };

  const openEdit = (u: UserRow) => {
    setEditState({
      id: u.id,
      username: u.username,
      name: u.name,
      role: u.role,
      callsign: u.callsign || '',
      unit: u.unit || '',
      phone: u.phone || '',
      isActive: u.isActive,
      password: '',
    });
    setEditOpen(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editState.username || !editState.name) {
      toast({ title: 'Missing fields', description: 'Username and name are required.', variant: 'destructive' });
      return;
    }
    if (editState.role === 'responder' && !RESPONDER_UNITS.some((u) => u.value === editState.unit)) {
      toast({ title: 'Missing unit', description: 'Responders must select a department (EMS, Traffic Police, or Crime Police).', variant: 'destructive' });
      return;
    }
    createOrUpdate.mutate(editState);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 flex-1">
          <Input
            placeholder="Search name, username, phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-xs max-w-xs"
          />
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue placeholder="Role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              <SelectItem value="dispatcher">Dispatcher</SelectItem>
              <SelectItem value="responder">Responder</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(v: 'all' | 'active' | 'inactive') => setStatusFilter(v)}>
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" className="h-8 text-xs" onClick={openCreate}>
          New user
        </Button>
      </div>

      <div className="border rounded-md overflow-hidden flex-1">
        <div className="grid grid-cols-[1.5fr,1fr,1fr,1fr,auto] gap-2 px-3 py-2 border-b bg-muted/50 text-xs font-semibold">
          <span>Name</span>
          <span>Username</span>
          <span>Role</span>
          <span>Status</span>
          <span className="text-right pr-1">Actions</span>
        </div>
        <div className="max-h-[420px] overflow-auto text-xs">
          {isLoading ? (
            <div className="py-4 text-center text-muted-foreground">Loading users…</div>
          ) : users.length === 0 ? (
            <div className="py-4 text-center text-muted-foreground">No users match filters.</div>
          ) : (
            users.map((u) => (
              <div
                key={u.id}
                className="grid grid-cols-[1.5fr,1fr,1fr,1fr,auto] gap-2 px-3 py-1.5 border-b last:border-b-0 items-center"
              >
                <div className="flex flex-col">
                  <span className="font-medium truncate">{u.name}</span>
                  {u.phone && <span className="text-[11px] text-muted-foreground truncate">{u.phone}</span>}
                </div>
                <span className="truncate">{u.username}</span>
                <span className="capitalize">{u.role}</span>
                <div className="flex items-center gap-1">
                  <Badge variant={u.isActive ? 'default' : 'secondary'} className="text-[10px]">
                    {u.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
                <div className="flex justify-end gap-1">
                  <Button
                    size="xs"
                    variant="outline"
                    className="h-6 px-2"
                    onClick={() => openEdit(u)}
                  >
                    Edit
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    className="h-6 px-2"
                    onClick={() => toggleActive.mutate(u)}
                  >
                    {u.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    className="h-6 px-2"
                    onClick={() => resetPassword.mutate(u)}
                  >
                    Reset PW
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen} modal={false}>
        <DialogContent
          className="sm:max-w-md"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="text-sm">
              {editState.id ? 'Edit user' : 'Create user'}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-3">
            {!editState.id && (
              <div className="space-y-1.5">
                <Label htmlFor="username" className="text-xs">
                  Username (email)
                </Label>
                <Input
                  id="username"
                  value={editState.username}
                  onChange={(e) => setEditState((s) => ({ ...s, username: e.target.value }))}
                  className="h-8 text-xs"
                  required
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="name" className="text-xs">
                Full name
              </Label>
              <Input
                id="name"
                value={editState.name}
                onChange={(e) => setEditState((s) => ({ ...s, name: e.target.value }))}
                className="h-8 text-xs"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Role</Label>
                <Select
                  value={editState.role}
                  onValueChange={(v) =>
                    setEditState((s) => ({
                      ...s,
                      role: v,
                      unit: v === 'responder' && !RESPONDER_UNITS.some((u) => u.value === s.unit) ? 'EMS' : s.unit,
                    }))
                  }
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dispatcher">Dispatcher</SelectItem>
                    <SelectItem value="responder">Responder</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Status</Label>
                <Select
                  value={editState.isActive ? 'active' : 'inactive'}
                  onValueChange={(v) =>
                    setEditState((s) => ({ ...s, isActive: v === 'active' }))
                  }
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Callsign</Label>
                <Input
                  value={editState.callsign}
                  onChange={(e) => setEditState((s) => ({ ...s, callsign: e.target.value }))}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{editState.role === 'responder' ? 'Department / Unit' : 'Unit'}</Label>
                {editState.role === 'responder' ? (
                  <Select
                    value={editState.unit}
                    onValueChange={(v) => setEditState((s) => ({ ...s, unit: v }))}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Select department" />
                    </SelectTrigger>
                    <SelectContent>
                      {RESPONDER_UNITS.map((u) => (
                        <SelectItem key={u.value} value={u.value}>
                          {u.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={editState.unit}
                    onChange={(e) => setEditState((s) => ({ ...s, unit: e.target.value }))}
                    className="h-8 text-xs"
                  />
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Phone</Label>
              <Input
                value={editState.phone}
                onChange={(e) => setEditState((s) => ({ ...s, phone: e.target.value }))}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">
                {editState.id ? 'Set new password (optional)' : 'Initial password (optional)'}
              </Label>
              <Input
                type="password"
                value={editState.password}
                onChange={(e) => setEditState((s) => ({ ...s, password: e.target.value }))}
                className="h-8 text-xs"
                placeholder={editState.id ? 'Leave blank to keep current password' : 'Leave blank for auto-generated'}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setEditOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                className="h-8 text-xs"
                disabled={createOrUpdate.isLoading}
              >
                {createOrUpdate.isLoading ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

