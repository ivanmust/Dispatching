import { useNavigate } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Incident } from '@/types/incident';
import { incidentCategoryDisplayLabel } from '@/types/incident';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatDistanceToNow } from 'date-fns';
import { History, Loader2, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';

const PAGE_SIZE = 30;

export default function IncidentHistoryPage() {
  const navigate = useNavigate();
  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteQuery<Incident[]>({
    queryKey: ['incidents', 'history', 'CLOSED'],
    queryFn: ({ pageParam }) =>
      api.getIncidents({
        status: 'CLOSED',
        limit: PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === PAGE_SIZE ? allPages.length * PAGE_SIZE : undefined,
    refetchInterval: 30000,
  });

  const completedIncidents = data?.pages.flat() ?? [];

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-4 border-b shrink-0">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <History className="h-5 w-5 text-muted-foreground" />
          Incident History
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Completed incidents only
        </p>
      </div>
      <ScrollArea className="flex-1 p-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-12 text-center">Loading…</p>
        ) : completedIncidents.length === 0 ? (
          <p className="text-sm text-muted-foreground py-12 text-center">
            No completed incidents yet.
          </p>
        ) : (
          <div className="space-y-2 w-full max-w-6xl pb-4">
            {completedIncidents.map((inc) => (
              <button
                key={inc.id}
                type="button"
                onClick={() => navigate('/dispatcher', { state: { selectIncidentId: inc.id } })}
                className="w-full text-left rounded-lg border bg-card px-3 py-2 hover:bg-muted/60 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold line-clamp-1">{inc.title}</p>
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                      {inc.description}
                    </p>
                  </div>
                  <div className="text-right shrink-0 text-[11px] text-muted-foreground">
                    <div>{incidentCategoryDisplayLabel(inc.category)}</div>
                    <div className="mt-0.5">
                      Completed {formatDistanceToNow(new Date(inc.updatedAt), { addSuffix: true })}
                    </div>
                  </div>
                </div>
              </button>
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
