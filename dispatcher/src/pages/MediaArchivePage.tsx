import { ImageIcon } from 'lucide-react';
import { MediaArchivePanel } from '@/components/MediaArchivePanel';

export default function MediaArchivePage() {
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-4 border-b shrink-0">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <ImageIcon className="h-5 w-5 text-muted-foreground" />
          Media Archive
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Images and videos shared in incident chat
        </p>
      </div>
      <div className="flex-1 overflow-hidden">
        <MediaArchivePanel />
      </div>
    </div>
  );
}
