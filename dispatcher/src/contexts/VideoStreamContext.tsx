import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { getSocket } from '@/lib/socket';

interface VideoStreamContextValue {
  activeStream: MediaStream | null;
  activeIncidentId: string | null;
  activeIncidentTitle: string | null;
  setActiveStream: (stream: MediaStream | null, incidentId: string | null, incidentTitle?: string) => void;
  stopStream: () => void;
}

const VideoStreamContext = createContext<VideoStreamContextValue | null>(null);

export function useVideoStream() {
  const ctx = useContext(VideoStreamContext);
  if (!ctx) throw new Error('useVideoStream must be used within VideoStreamProvider');
  return ctx;
}

export function VideoStreamProvider({ children }: { children: ReactNode }) {
  const [activeStream, setActiveStreamState] = useState<MediaStream | null>(null);
  const [activeIncidentId, setActiveIncidentId] = useState<string | null>(null);
  const [activeIncidentTitle, setActiveIncidentTitle] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const incidentIdRef = useRef<string | null>(null);

  const setActiveStream = useCallback((stream: MediaStream | null, incidentId: string | null, incidentTitle?: string) => {
    const prev = streamRef.current;
    if (prev && !stream) {
      prev.getTracks().forEach((t) => t.stop());
    }
    streamRef.current = stream;
    incidentIdRef.current = incidentId;
    setActiveStreamState(stream);
    setActiveIncidentId(incidentId);
    setActiveIncidentTitle(incidentTitle ?? null);
  }, []);

  const stopStream = useCallback(() => {
    const s = streamRef.current;
    const id = incidentIdRef.current;
    if (s) {
      s.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      incidentIdRef.current = null;
      setActiveStreamState(null);
      setActiveIncidentId(null);
      setActiveIncidentTitle(null);
      if (id) getSocket().emit('video:end', { incidentId: id });
    }
  }, []);

  const value: VideoStreamContextValue = {
    activeStream,
    activeIncidentId,
    activeIncidentTitle,
    setActiveStream,
    stopStream,
  };

  return (
    <VideoStreamContext.Provider value={value}>
      {children}
    </VideoStreamContext.Provider>
  );
}
