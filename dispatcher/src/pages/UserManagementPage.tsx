import { Users } from 'lucide-react';
import { UserManagementPanel } from '@/components/UserManagementPanel';

export default function UserManagementPage() {
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-4 border-b shrink-0">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <Users className="h-5 w-5 text-muted-foreground" />
          User Management
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Manage dispatchers and responders
        </p>
      </div>
      <div className="flex-1 overflow-auto p-4">
        <UserManagementPanel />
      </div>
    </div>
  );
}
