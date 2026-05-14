import { FileText } from 'lucide-react';
import { AuditLogPanel } from '@/components/AuditLogPanel';

export default function AuditLogPage() {
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-4 border-b shrink-0">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <FileText className="h-5 w-5 text-muted-foreground" />
          Audit Log
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          History of incidents, status changes, and edits for reporting and compliance.
        </p>
      </div>
      <div className="flex-1 overflow-hidden min-h-0 p-4">
        <div className="h-full w-full max-w-xl">
          <AuditLogPanel />
        </div>
      </div>
    </div>
  );
}
