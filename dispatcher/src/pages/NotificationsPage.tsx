import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Check } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { api, type NotificationItem } from '@/lib/api';
import { cn } from '@/lib/utils';

export default function NotificationsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.getNotifications({ limit: 100 }),
  });

  const markAllRead = useMutation({
    mutationFn: () => api.markAllNotificationsRead(),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['notifications'] });
      await qc.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    },
  });

  const markOneRead = useMutation({
    mutationFn: (id: string) => api.markNotificationRead(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['notifications'] });
      await qc.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    },
  });

  useEffect(() => {
    // Viewing the page counts as viewing notifications.
    markAllRead.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOpen = (n: NotificationItem) => {
    if (!n.isRead) markOneRead.mutate(n.id);
    const incidentId = (n.metadata?.incidentId as string | undefined) ?? undefined;
    if (incidentId) {
      navigate('/dispatcher', { state: { selectIncidentId: incidentId } });
      return;
    }
    const conversationId = (n.metadata?.conversationId as string | undefined) ?? undefined;
    if (conversationId) {
      navigate('/dispatcher/chats', { state: { conversationId } });
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-4 border-b shrink-0">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <Bell className="h-5 w-5 text-muted-foreground" />
          Alerts
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">System notifications</p>
      </div>
      <div className="flex-1 overflow-auto p-4 space-y-6">
        <section className="w-full max-w-6xl space-y-3">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">System notifications</h2>
          </div>
          {notifications.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              No notifications yet.
            </p>
          ) : (
            <div className="space-y-2">
              {notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleOpen(n)}
                  className={cn(
                    'w-full text-left rounded-lg border p-4 hover:bg-muted/50 transition-colors',
                    !n.isRead && 'border-primary/30 bg-primary/5'
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-medium">{n.title}</h3>
                      <p className="text-sm text-muted-foreground mt-0.5">{n.body}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                      </p>
                    </div>
                    <span
                      className={cn(
                        'shrink-0 px-2 py-0.5 rounded text-xs font-medium',
                        !n.isRead
                          ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                          : 'bg-muted text-muted-foreground'
                      )}
                    >
                      {!n.isRead ? 'NEW' : <Check className="h-3.5 w-3.5" />}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
