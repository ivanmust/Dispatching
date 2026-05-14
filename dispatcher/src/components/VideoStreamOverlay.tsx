import { useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { VideoOff } from 'lucide-react';
import { useVideoStream } from '@/contexts/VideoStreamContext';

/**
 * Floating video overlay for dispatcher - shows responder's live feed
 * visible anywhere in the app without staying on the Video tab.
 */
export function VideoStreamOverlay() {
  const { activeStream, activeIncidentTitle, stopStream } = useVideoStream();
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (activeStream && videoRef.current) {
      videoRef.current.srcObject = activeStream;
    }
  }, [activeStream]);

  if (!activeStream) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-[90] w-64 rounded-lg border-2 border-primary bg-background shadow-xl overflow-hidden"
      role="region"
      aria-label="Live stream from responder"
    >
      <div className="aspect-video bg-muted relative">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover"
        />
        <span className="absolute bottom-1 left-1 text-[10px] bg-black/70 text-white px-1.5 py-0.5 rounded">
          {activeIncidentTitle ? `Live — ${activeIncidentTitle}` : 'Live — responder camera'}
        </span>
      </div>
      <Button
        size="sm"
        variant="destructive"
        className="w-full rounded-none gap-1"
        onClick={stopStream}
      >
        <VideoOff className="h-4 w-4" /> End Call
      </Button>
    </div>
  );
}
