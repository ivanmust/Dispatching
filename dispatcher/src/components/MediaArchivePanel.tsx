import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ScrollArea } from '@/components/ui/scroll-area';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001';

export function MediaArchivePanel() {
  const { data: attachments = [], isLoading } = useQuery({
    queryKey: ['media-attachments'],
    queryFn: () => api.getMediaAttachments(),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (attachments.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        No media attachments yet. Images and videos shared in incident chat will appear here.
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-4">
        {attachments.map((a) => {
          const url = a.attachmentUrl.startsWith('http') ? a.attachmentUrl : `${API_BASE}${a.attachmentUrl}`;
          const isVideo = a.attachmentType === 'video';
          return (
            <div key={a.messageId} className="rounded-lg border overflow-hidden bg-card">
              <div className="p-2 text-xs text-muted-foreground flex items-center gap-2">
                <span className="font-medium text-foreground">{a.incidentTitle}</span>
                <span>·</span>
                {formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}
              </div>
              <a href={url} target="_blank" rel="noopener noreferrer" className="block">
                {isVideo ? (
                  <video src={url} controls className="w-full max-h-48 object-contain bg-muted" />
                ) : (
                  <img src={url} alt="" className="w-full max-h-48 object-contain bg-muted" />
                )}
              </a>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
