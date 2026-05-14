import { ShieldCheck } from "lucide-react";
import { DashboardPanel } from "@/components/DashboardPanel";

export default function AdminPortalPage() {
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-4 border-b shrink-0">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-muted-foreground" />
          Overview
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Executive dashboard view.
        </p>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <DashboardPanel />
      </div>
    </div>
  );
}

