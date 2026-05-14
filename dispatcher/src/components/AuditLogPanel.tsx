import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api, type AuditLogEntry } from '@/lib/api';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDistanceToNow } from 'date-fns';
import { Loader2, History, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';

const ACTIONS = [
  'ALL',
  'incident:created',
  'incident:assigned',
  'incident:reassigned',
  'incident:accepted',
  'incident:rejected',
  'incident:rejected_by_responder',
  'incident:completed_by_responder',
  'incident:status_updated',
  'incident:updated',
  'chat:message_sent',
  'user:created',
  'user:updated',
  'user:activated',
  'user:deactivated',
  'user:password_reset',
  'admin:settings_updated',
  'admin:force_logout_all',
  'admin:permissions_updated',
] as const;

const PAGE_SIZE = 50;

export function AuditLogPanel() {
  const [actionFilter, setActionFilter] = useState<string>('ALL');
  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteQuery({
    queryKey: ['audit', actionFilter],
    queryFn: ({ pageParam }) =>
      api.getAuditLogs({
        action: actionFilter === 'ALL' ? undefined : actionFilter,
        limit: PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === PAGE_SIZE ? allPages.length * PAGE_SIZE : undefined,
  });
  const logs = data?.pages.flat() ?? [];

  return (
    <div className="flex flex-col h-full w-full max-w-[420px] bg-card border rounded-lg">
      <div className="p-3 border-b flex items-center gap-2">
        <History className="h-4 w-4 text-muted-foreground" />
        <span className="font-semibold text-sm">Audit Log</span>
      </div>
      <div className="p-2 border-b">
        <Select value={actionFilter} onValueChange={setActionFilter}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Filter by action" />
          </SelectTrigger>
          <SelectContent>
            {ACTIONS.map((a) => (
              <SelectItem key={a} value={a}>
                {a === 'ALL' ? 'All actions' : a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <ScrollArea className="flex-1 p-2">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : logs.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No audit entries yet</p>
        ) : (
          <div className="space-y-2 pb-2">
            {logs.map((entry) => (
              <AuditLogRow key={entry.id} entry={entry} />
            ))}
            {hasNextPage && (
              <Button
                variant="outline"
                size="sm"
                className="w-full mt-2"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? <Loader2 className="h-4 w-4 animate-spin" /> : <><ChevronDown className="h-4 w-4 mr-1" /> Load more</>}
              </Button>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

function AuditLogRow({ entry }: { entry: AuditLogEntry }) {
  const detail = entry.details
    ? Object.entries(entry.details)
        .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
        .join(' · ')
    : '';

  return (
    <div className="rounded-md border px-2.5 py-2 text-xs bg-muted/30">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono font-medium text-primary">{entry.action}</span>
        <span className="text-muted-foreground shrink-0">
          {formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}
        </span>
      </div>
      {entry.userName && (
        <div className="text-muted-foreground mt-0.5">
          by {entry.userName}
          {entry.entityType && entry.entityId && (
            <> · {entry.entityType} {entry.entityId.slice(0, 8)}…</>
          )}
        </div>
      )}
      {detail && <div className="text-muted-foreground mt-0.5 truncate">{detail}</div>}
    </div>
  );
}
