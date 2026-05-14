import { useRef, useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Video, VideoOff, Volume2, VolumeX, PhoneOff } from 'lucide-react';
import { getSocket } from '@/lib/socket';
import { useVideoStream } from '@/contexts/VideoStreamContext';
import { api } from '@/lib/api';
import { Room, RoomEvent, RemoteTrack, RemoteParticipant, RemoteTrackPublication } from 'livekit-client';

interface VideoPanelProps {
  incidentId: string;
  incidentTitle?: string;
  readOnly?: boolean;
}

export function VideoPanel({ incidentId, incidentTitle = 'Incident', readOnly = false }: VideoPanelProps) {
  const { setActiveStream, stopStream: contextStopStream } = useVideoStream();
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const roomRef = useRef<Room | null>(null);
  /** True after video:request until session fully ended (so navigation triggers video:end for responder). */
  const sessionActiveRef = useRef(false);

  const [streamRequested, setStreamRequested] = useState(false);
  const [responderAccepted, setResponderAccepted] = useState(false);
  const [hasStream, setHasStream] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestStream = useCallback(() => {
    sessionActiveRef.current = true;
    setStreamRequested(true);
    setResponderAccepted(false);
    setHasStream(false);
    setError(null);
    getSocket().emit('video:request', { incidentId, incidentTitle });
  }, [incidentId, incidentTitle]);

  const stopStream = useCallback(() => {
    sessionActiveRef.current = false;
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
      remoteAudioRef.current = null;
    }
    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
    }
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    setHasStream(false);
    setResponderAccepted(false);
    setStreamRequested(false);
    setMuted(false);
    contextStopStream();
    getSocket().emit('video:end', { incidentId });
  }, [incidentId, contextStopStream]);

  const toggleMute = useCallback(() => {
    const audioEl = remoteAudioRef.current;
    if (audioEl) {
      audioEl.muted = !muted;
      setMuted(!muted);
    }
  }, [muted]);

  useEffect(() => {
    const socket = getSocket();

    const onAccepted = (data: { incidentId: string }) => {
      if (data.incidentId !== incidentId) return;
      setResponderAccepted(true);
      // Connect to LiveKit room for this incident and subscribe to responder's video
      (async () => {
        try {
          const { token, url } = await api.getLivekitToken(incidentId);

          if (roomRef.current) {
            roomRef.current.disconnect();
            roomRef.current = null;
          }

          const room = new Room({
            adaptiveStream: true,
            dynacast: true,
          });
          roomRef.current = room;

          room.on(
            RoomEvent.TrackSubscribed,
            (track: RemoteTrack, _publication: RemoteTrackPublication, _participant: RemoteParticipant) => {
              if (track.kind === 'video' && remoteVideoRef.current) {
                track.attach(remoteVideoRef.current as HTMLVideoElement);
                const mediaStream = new MediaStream();
                const mediaTrack = (track as RemoteTrack & { mediaStreamTrack?: MediaStreamTrack }).mediaStreamTrack;
                if (mediaTrack) {
                  mediaStream.addTrack(mediaTrack);
                  setActiveStream(mediaStream, incidentId, incidentTitle);
                }
                setHasStream(true);
              } else if (track.kind === 'audio') {
                const audioEl = document.createElement('audio');
                audioEl.autoplay = true;
                track.attach(audioEl as HTMLMediaElement);
                remoteAudioRef.current = audioEl;
              }
            }
          );

          room.on(RoomEvent.TrackUnsubscribed, () => {
            if (remoteAudioRef.current) {
              remoteAudioRef.current.srcObject = null;
              remoteAudioRef.current = null;
            }
            if (remoteVideoRef.current) {
              remoteVideoRef.current.srcObject = null;
            }
            setHasStream(false);
            setActiveStream(null, null, undefined);
          });

          await room.connect(url, token);
        } catch (err) {
          console.error('Failed to connect to LiveKit room', err);
          sessionActiveRef.current = false;
          setError('Unable to start video stream.');
          getSocket().emit('video:end', { incidentId });
        }
      })();
    };

    const onRejected = (data: { incidentId: string }) => {
      if (data.incidentId !== incidentId) return;
      sessionActiveRef.current = false;
      setStreamRequested(false);
      setResponderAccepted(false);
      setError(null);
    };

    const onEnded = (data: { incidentId: string }) => {
      if (data.incidentId !== incidentId) return;
      sessionActiveRef.current = false;
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = null;
        remoteAudioRef.current = null;
      }
      if (roomRef.current) {
        roomRef.current.disconnect();
        roomRef.current = null;
      }
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
      setHasStream(false);
      setResponderAccepted(false);
      setStreamRequested(false);
      setError(null);
      setMuted(false);
      contextStopStream();
    };

    const onError = (data: { incidentId: string; code: string; message: string }) => {
      if (data.incidentId !== incidentId) return;
      sessionActiveRef.current = false;
      setStreamRequested(false);
      setResponderAccepted(false);
      setHasStream(false);
      setError(data.message);
    };

    socket.on('video:accepted', onAccepted);
    socket.on('video:rejected', onRejected);
    socket.on('video:ended', onEnded);
    socket.on('video:error', onError);
    // WebRTC signaling events are no longer used now that video flows through LiveKit

    return () => {
      socket.off('video:accepted', onAccepted);
      socket.off('video:rejected', onRejected);
      socket.off('video:ended', onEnded);
      socket.off('video:error', onError);

      // Leaving the incident / tab: end session for both sides (responder still has LiveKit + camera).
      if (sessionActiveRef.current) {
        sessionActiveRef.current = false;
        getSocket().emit('video:end', { incidentId });
        setActiveStream(null, null, undefined);
      }

      const audioEl = remoteAudioRef.current;
      if (audioEl) {
        audioEl.srcObject = null;
        remoteAudioRef.current = null;
      }
      if (roomRef.current) {
        roomRef.current.disconnect();
        roomRef.current = null;
      }
      const videoEl = remoteVideoRef.current;
      if (videoEl) videoEl.srcObject = null;
    };
  }, [incidentId, incidentTitle, setActiveStream, contextStopStream]);

  return (
    <div className="flex flex-col h-full p-3 gap-3">
      <div className="grid grid-cols-1 gap-2 flex-1">
        <div className="relative bg-muted rounded-lg overflow-hidden flex items-center justify-center min-h-[200px] aspect-video">
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full object-cover"
          />
          {!hasStream && (
            <div className="absolute inset-0 flex items-center justify-center bg-muted">
              <p className="text-sm text-muted-foreground">
                {readOnly
                  ? 'Supervisor view — cannot request stream.'
                  : error
                    ? error
                    : streamRequested
                      ? responderAccepted
                        ? 'Connecting stream...'
                        : 'Waiting for responder to accept...'
                      : 'No active stream. Send a live stream request.'}
              </p>
            </div>
          )}
          {hasStream && (
            <span className="absolute bottom-1 left-2 text-[10px] bg-black/60 text-white px-1.5 py-0.5 rounded">
              Live stream — responder&apos;s camera
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center justify-center gap-2">
        {!readOnly && !hasStream && !streamRequested && (
          <Button onClick={requestStream} size="sm" className="gap-1">
            <Video className="h-4 w-4" /> Request Live Stream
          </Button>
        )}
        {!readOnly && streamRequested && !hasStream && (
          <Button disabled size="sm" variant="outline" className="gap-1">
            <Video className="h-4 w-4 animate-pulse" /> Waiting for responder...
          </Button>
        )}
        {!readOnly && hasStream && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={muted ? 'destructive' : 'outline'}
              className="gap-1"
              onClick={toggleMute}
              title={muted ? 'Unmute audio' : 'Mute audio'}
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              {muted ? 'Unmute' : 'Mute'}
            </Button>
            <Button size="sm" variant="destructive" className="gap-1" onClick={stopStream} title="End call">
              <PhoneOff className="h-4 w-4" /> End Call
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
