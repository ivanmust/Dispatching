import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useChatMessages, useSendMessage } from '@/hooks/useIncidents';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, ImagePlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { toast } from '@/hooks/use-toast';
import type { ChatMessage } from '@/types/incident';
import { api } from '@/lib/api';

const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024; // 2MB

interface ChatPanelProps {
  incidentId: string;
  readOnly?: boolean;
}

export function ChatPanel({ incidentId, readOnly = false }: ChatPanelProps) {
  const { data: messages, isLoading } = useChatMessages(incidentId);
  const sendMutation = useSendMessage();
  const [text, setText] = useState('');
  const [pendingAttachment, setPendingAttachment] = useState<{ url: string; type: 'image' | 'video' } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const uniqueMessages = useMemo(() => {
    if (!messages?.length) return [];
    const byId = new Map(messages.map((m) => [m.id, m]));
    return Array.from(byId.values()).sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }, [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [uniqueMessages]);

  const handleSend = useCallback(() => {
    const hasText = text.trim().length > 0;
    const hasAttachment = !!pendingAttachment;
    if (!hasText && !hasAttachment) return;
    sendMutation.mutate({
      incidentId,
      text: text.trim(),
      attachmentUrl: pendingAttachment?.url,
      attachmentType: pendingAttachment?.type,
    });
    setText('');
    setPendingAttachment(null);
  }, [text, pendingAttachment, incidentId, sendMutation]);

  const [uploading, setUploading] = useState(false);
  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = '';
      if (file.size > MAX_ATTACHMENT_BYTES) {
        toast({ title: 'File too large', description: 'Max 2MB for attachments.', variant: 'destructive' });
        return;
      }
      const isImage = file.type.startsWith('image/');
      const isVideo = file.type.startsWith('video/');
      if (!isImage && !isVideo) {
        toast({ title: 'Invalid file', description: 'Only images and videos are supported.', variant: 'destructive' });
        return;
      }
      setUploading(true);
      try {
        const { url } = await api.uploadFile(file);
        setPendingAttachment({ url, type: isImage ? 'image' : 'video' });
      } catch {
        toast({ title: 'Upload failed', variant: 'destructive' });
      } finally {
        setUploading(false);
      }
    },
    []
  );

  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1 p-3">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !uniqueMessages.length ? (
          <p className="text-center text-sm text-muted-foreground py-8">No messages yet</p>
        ) : (
          <div className="space-y-3">
            {uniqueMessages.map((msg: ChatMessage) => (
              <div
                key={msg.id}
                className={cn('flex flex-col max-w-[85%]', msg.sender === 'dispatcher' ? 'ml-auto items-end' : 'items-start')}
              >
                <span className="text-[10px] text-muted-foreground mb-0.5 px-1">{msg.senderName}</span>
                <div
                  className={cn(
                    'rounded-xl px-3 py-2 text-sm space-y-1',
                    msg.sender === 'dispatcher'
                      ? 'bg-primary text-primary-foreground rounded-br-sm'
                      : 'bg-muted text-foreground rounded-bl-sm'
                  )}
                >
                  {msg.text && <p>{msg.text}</p>}
                  {msg.attachmentUrl && msg.attachmentType === 'image' && (
                    <a href={msg.attachmentUrl} target="_blank" rel="noopener noreferrer" className="block">
                      <img src={msg.attachmentUrl} alt="Attachment" className="max-w-full max-h-48 rounded object-contain" />
                    </a>
                  )}
                  {msg.attachmentUrl && msg.attachmentType === 'video' && (
                    <video src={msg.attachmentUrl} controls className="max-w-full max-h-48 rounded" />
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground mt-0.5 px-1">
                  {formatDistanceToNow(new Date(msg.timestamp), { addSuffix: true })}
                </span>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </ScrollArea>
      {!readOnly && (
      <div className="p-4 border-t flex flex-col gap-3">
        {pendingAttachment && (
          <div className="flex items-center gap-2 text-xs">
            {pendingAttachment.type === 'image' ? (
              <img src={pendingAttachment.url} alt="Preview" className="h-12 w-12 object-cover rounded" />
            ) : (
              <span className="text-muted-foreground">Video attached</span>
            )}
            <button type="button" className="text-destructive underline" onClick={() => setPendingAttachment(null)}>Remove</button>
          </div>
        )}
        <div className="flex gap-2.5">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            className="hidden"
            onChange={handleFileChange}
          />
          <Button size="icon" variant="outline" className="h-11 w-11 shrink-0" disabled={uploading} onClick={() => fileInputRef.current?.click()} title="Attach image or video">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
          </Button>
          <Input
            placeholder="Type a message..."
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
            className="h-11 text-sm flex-1"
          />
          <Button className="h-11 shrink-0 px-4 text-sm" onClick={handleSend} disabled={!text.trim() && !pendingAttachment}>
            Send
          </Button>
        </div>
      </div>
      )}
    </div>
  );
}
