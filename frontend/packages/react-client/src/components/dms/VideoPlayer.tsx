/**
 * VideoPlayer.tsx — custom ref-controlled HTML5 video player.
 *
 * Why not <video controls>?
 * ─────────────────────────
 * • WebKit's native control bar dispatches pause through its own UI loop,
 *   adding 1–3 frames of latency before the decoder freezes.
 * • Calling videoRef.current.pause() from a React synthetic event handler
 *   is synchronous: the decoder stops on the same JS tick, keeping A/V locked.
 * • Replacing the `key` prop on <video> (the old retry trick) destroys the
 *   MediaElement and forces the decoder to restart from scratch, which is
 *   exactly what desynchronises audio. We use videoRef.current.load() instead.
 */

import React, { useEffect, useRef, useState, useCallback } from "react";
import { useLingui } from "@lingui/react";
import { Icon } from "../Icon";


function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}


interface Props {
  src: string;
  className?: string;
}

const VideoPlayer: React.FC<Props> = ({ src, className = "" }) => {
  const videoRef     = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guard: never call setState after unmount (stops WebKit from throwing
  // "Attempted to assign to readonly property" on the media element).
  const mountedRef   = useRef(true);
  const { _ } = useLingui();

  const [playing,     setPlaying]     = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration,    setDuration]    = useState(0);
  const [buffered,    setBuffered]    = useState(0);   // 0–1
  const [volume,      setVolume]      = useState(1);
  const [muted,       setMuted]       = useState(false);
  const [stalled,     setStalled]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // No cleanup return here — having BOTH effect cleanups call v.src=""  +
  // v.load() in rapid succession causes WebKit to mark its properties as
  // readonly on the second call (even if the first is inside try/catch).
  // All teardown is handled exclusively by the mount-tracking effect below.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (mountedRef.current) {
      setPlaying(false); setCurrentTime(0); setDuration(0);
      setBuffered(0); setError(null); setStalled(false);
    }
    try {
      // Pause before touching src — WebKit marks src read-only while the
      // decoder is mid-teardown if you skip this step.
      v.pause();
      v.src = src;
      v.load();
    } catch {
      // WebKit may throw if the element is already in teardown — safe to ignore.
    }
  }, [src]);

  // This is the SINGLE place that tears down the media element.
  // Using removeAttribute("src") instead of v.src="" avoids WebKit's internal
  // re-validation path that can mark additional properties as readonly.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (hideTimer.current) clearTimeout(hideTimer.current);
      const v = videoRef.current;
      if (v) {
        try {
          v.pause();
          v.removeAttribute("src");
          v.load();
        } catch {
          // Ignore all WebKit readonly/teardown errors.
        }
      }
    };
  }, []);

  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (!mountedRef.current) return;
    setShowControls(true);
    hideTimer.current = setTimeout(() => {
      if (mountedRef.current) setShowControls(false);
    }, 3000);
  }, []);

  useEffect(() => {
    scheduleHide();
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [scheduleHide]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    // Synchronous DOM call — bypasses WebKit's native control latency
    if (v.paused) { v.play().catch(() => {}); }
    else          { v.pause(); }
    scheduleHide();
  }, [scheduleHide]);

  const seek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current;
    if (!v || !duration || !mountedRef.current) return;
    try {
      const t = (parseInt(e.target.value, 10) / 10000) * duration;
      v.currentTime = t;
      setCurrentTime(t);
    } catch { /* WebKit readonly — ignore */ }
  }, [duration]);

  const changeVolume = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current;
    if (!v || !mountedRef.current) return;
    try {
      const vol = parseInt(e.target.value, 10) / 100;
      v.volume = vol;
      v.muted  = vol === 0;
      setVolume(vol);
      setMuted(vol === 0);
    } catch { /* WebKit readonly — ignore */ }
  }, []);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v || !mountedRef.current) return;
    try {
      v.muted = !v.muted;
      setMuted(v.muted);
    } catch { /* WebKit readonly — ignore */ }
  }, []);

  const toggleFullscreen = useCallback(() => {
    const c = containerRef.current;
    if (!c) return;
    if (!document.fullscreenElement) {
      c.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const onTimeUpdate = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    if (!mountedRef.current) return;
    const v = e.currentTarget;
    setCurrentTime(v.currentTime);
    if (v.buffered.length > 0 && v.duration > 0) {
      setBuffered(v.buffered.end(v.buffered.length - 1) / v.duration);
    }
  }, []);

  const onError = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    if (!mountedRef.current) return;
    const code = (e.currentTarget.error?.code ?? 0);
    const msgs: Record<number, string> = {
      1: _("Playback aborted"), 2: _("Network error"),
      3: _("Decode error"),     4: _("Format not supported"),
    };
    setError(msgs[code] ?? _("Playback failed"));
    setPlaying(false); setStalled(false);
  }, [_]);

  const retry = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setError(null); setStalled(true);
    v.load();
    v.play().catch(() => {});
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!mountedRef.current) return;
      if (!containerRef.current?.contains(document.activeElement) &&
          document.activeElement !== document.body) return;
      const v = videoRef.current;
      if (e.code === "Space")      { e.preventDefault(); togglePlay(); }
      // Guard currentTime writes — WebKit throws if the element is torn down
      if (e.code === "ArrowRight" && v && isFinite(v.duration))
        { try { v.currentTime = Math.min(v.currentTime + 5, v.duration); } catch { /* ignore */ } }
      if (e.code === "ArrowLeft"  && v && isFinite(v.duration))
        { try { v.currentTime = Math.max(v.currentTime - 5, 0); } catch { /* ignore */ } }
      if (e.code === "KeyF")  { toggleFullscreen(); }
      if (e.code === "KeyM")  { toggleMute(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, toggleFullscreen, toggleMute]);

  const progress = duration > 0 ? (currentTime / duration) * 10000 : 0;

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className={`relative bg-black rounded-lg overflow-hidden outline-none group ${className}`}
      style={{ cursor: showControls ? "default" : "none" }}
      onMouseMove={scheduleHide}
      onMouseEnter={scheduleHide}
    >
      {/* NEVER keyed: src is swapped via DOM ref to avoid decoder/A-V desyncs. */}
      <video
        ref={videoRef}
        preload="auto"
        playsInline
        className="w-full h-full object-contain"
        style={{ display: "block" }}
        onPlay={()   => { if (mountedRef.current) { setPlaying(true);  setStalled(false); } }}
        onPause={()  => { if (mountedRef.current) setPlaying(false); }}
        onWaiting={()  => { if (mountedRef.current) setStalled(true);  }}
        onPlaying={()  => { if (mountedRef.current) setStalled(false); }}
        onDurationChange={(e) => { if (mountedRef.current) setDuration(e.currentTarget.duration || 0); }}
        onTimeUpdate={onTimeUpdate}
        onVolumeChange={(e) => {
          if (!mountedRef.current) return;
          setVolume(e.currentTarget.volume);
          setMuted(e.currentTarget.muted);
        }}
        onError={onError}
        onClick={togglePlay}
      />

      {stalled && !error && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="w-12 h-12 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 text-white p-6">
          <Icon name="warning" size="lg" className="opacity-50" />
          <p className="text-sm font-bold">{error}</p>
          <p className="text-[10px] opacity-60">{_("The format may not be supported by the system WebView.")}</p>
          <button
            onClick={retry}
            className="mt-1 text-[10px] font-bold uppercase tracking-widest px-4 py-2 rounded bg-white/10 hover:bg-white/20 transition-colors"
          >
            {_("Retry")}
          </button>
        </div>
      )}

      {!error && !playing && !stalled && (
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{ opacity: showControls ? 1 : 0, transition: "opacity 0.2s" }}
        >
          <div className="w-16 h-16 rounded-full bg-black/60 flex items-center justify-center">
            <svg className="w-7 h-7 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M5 3l14 9-14 9V3z"/>
            </svg>
          </div>
        </div>
      )}

      {!error && (
        <div
          className="absolute bottom-0 left-0 right-0 flex flex-col gap-1.5 px-3 pt-6 pb-2.5"
          style={{
            background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 100%)",
            opacity: showControls ? 1 : 0,
            transition: "opacity 0.25s",
            pointerEvents: showControls ? "auto" : "none",
          }}
        >
          <div className="relative h-5 flex items-center group/seek">
            <div className="w-full h-1 rounded-full bg-white/20 overflow-hidden relative">
              <div
                className="absolute inset-y-0 left-0 bg-white/35 rounded-full pointer-events-none"
                style={{ width: `${buffered * 100}%` }}
              />
              <div
                className="absolute inset-y-0 left-0 bg-white rounded-full pointer-events-none"
                style={{ width: `${Math.min((currentTime / Math.max(duration, 0.001)) * 100, 100)}%` }}
              />
            </div>
            {/* Transparent range overlay for seek interaction */}
            <input
              type="range" min="0" max="10000" step="1"
              value={Math.round(progress)}
              onChange={seek}
              className="absolute inset-0 w-full opacity-0 cursor-pointer"
              aria-label={_("Seek")}
            />
          </div>

          <div className="flex items-center gap-2 text-white select-none">
            <button
              onClick={togglePlay}
              className="p-1 hover:opacity-80 shrink-0"
              aria-label={playing ? _("Pause") : _("Play")}
            >
              {playing ? (
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16" rx="1"/>
                  <rect x="14" y="4" width="4" height="16" rx="1"/>
                </svg>
              ) : (
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M5 3l14 9-14 9V3z"/>
                </svg>
              )}
            </button>

            <button onClick={toggleMute} className="p-1 hover:opacity-80 shrink-0" aria-label={_("Toggle mute")}>
              {muted || volume === 0 ? (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M11 5L6 9H2v6h4l5 4V5z"/>
                  <line x1="23" y1="9" x2="17" y2="15"/>
                  <line x1="17" y1="9" x2="23" y2="15"/>
                </svg>
              ) : volume < 0.5 ? (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M11 5L6 9H2v6h4l5 4V5z"/>
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
                </svg>
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M11 5L6 9H2v6h4l5 4V5z"/>
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
                </svg>
              )}
            </button>
            <input
              type="range" min="0" max="100" step="1"
              value={muted ? 0 : Math.round(volume * 100)}
              onChange={changeVolume}
              className="w-14 h-1 accent-white cursor-pointer shrink-0"
              aria-label={_("Volume")}
            />

            <span className="text-[10px] font-mono ml-1 tabular-nums whitespace-nowrap">
              {fmtTime(currentTime)}
              <span className="opacity-40"> / {fmtTime(duration)}</span>
            </span>

            <button
              onClick={toggleFullscreen}
              className="ml-auto p-1 hover:opacity-80 shrink-0"
              aria-label={_("Fullscreen")}
            >
              {isFullscreen ? (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
                </svg>
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
                </svg>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default VideoPlayer;
