"use client";

import React, { useState, useRef, useEffect } from 'react';
import { cn } from "@/lib/utils";
import {
  Play, Pause, Volume1, Volume2, VolumeX, SkipBack, SkipForward,
  Settings, Download, HelpCircle, Repeat, Shuffle, List, RotateCw, RotateCcw
} from 'lucide-react';

interface AudioProps {
  title?: string;
  src: string;
  autoPlay?: boolean;
  className?: string;
  onError?: () => void;
  onLoad?: () => void;
  onClose?: () => void;
  onDownload?: () => void;
  onNext?: () => void;
  onPrev?: () => void;
}

export const Audio = ({
  title,
  src,
  autoPlay = false,
  className,
  onError,
  onLoad,
  onClose,
  onDownload,
  onNext,
  onPrev,
}: AudioProps) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);

  const [playMode, setPlayMode] = useState<'sequential' | 'repeat' | 'shuffle'>('sequential');

  const keyboardShortcutsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Format time in MM:SS format
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play().catch(console.error);
      }
    }
  };

  const toggleMute = () => {
    if (audioRef.current) {
      const newMutedState = !isMuted;
      audioRef.current.muted = newMutedState;
      setIsMuted(newMutedState);
    }
  };

  const handleVolumeChange = (newVolume: number) => {
    const clampedVolume = Math.max(0, Math.min(1, newVolume));
    setVolume(clampedVolume);
    if (audioRef.current) {
      audioRef.current.volume = clampedVolume;
      setIsMuted(clampedVolume === 0);
    }
  };

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (progressRef.current && duration > 0) {
      const rect = progressRef.current.getBoundingClientRect();
      const pos = (e.clientX - rect.left) / rect.width;
      const newTime = pos * duration;
      if (audioRef.current) {
        audioRef.current.currentTime = newTime;
      }
    }
  };

  const skip = (seconds: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = Math.max(0, Math.min(duration, currentTime + seconds));
    }
  };

  const changePlaybackRate = (rate: number) => {
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
      setPlaybackRate(rate);
    }
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onLoadedMetadata = () => {
      setDuration(audio.duration);
      if (onLoad) onLoad();
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onVolumeChange = () => {
      setVolume(audio.volume);
      setIsMuted(audio.muted);
    };
    const onEnded = () => {
      setIsPlaying(false);
      if (playMode === 'repeat') {
        audio.currentTime = 0;
        audio.play().catch(console.error);
      } else if (onNext) {
        onNext();
      }
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('volumechange', onVolumeChange);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('volumechange', onVolumeChange);
      audio.removeEventListener('ended', onEnded);
    };
  }, [onLoad, playMode, onNext]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowRight':
          e.preventDefault();
          skip(10);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          skip(-10);
          break;
        case 'ArrowUp':
          e.preventDefault();
          handleVolumeChange(volume + 0.1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          handleVolumeChange(volume - 0.1);
          break;
        case 'm':
          e.preventDefault();
          toggleMute();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [volume]);

  const togglePlayMode = () => {
    const modes: Array<'sequential' | 'repeat' | 'shuffle'> = ['sequential', 'repeat', 'shuffle'];
    const currentIndex = modes.indexOf(playMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    setPlayMode(modes[nextIndex]);
  };

  const getPlayModeInfo = () => {
    switch (playMode) {
      case 'sequential':
        return { icon: <List size={20} />, tooltip: 'Sequential Play' };
      case 'repeat':
        return { icon: <Repeat size={20} />, tooltip: 'Repeat' };
      case 'shuffle':
        return { icon: <Shuffle size={20} />, tooltip: 'Shuffle' };
    }
  };

  const playModeInfo = getPlayModeInfo();

  return (
    <div className={cn(
      "w-full max-w-3xl",
      "bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900",
      "rounded-2xl shadow-2xl p-8",
      "text-white backdrop-blur-sm",
      "border border-gray-700/50",
      className
    )}>
      <audio
        ref={audioRef}
        src={src}
        autoPlay={autoPlay}
        onError={onError}
        className="hidden"
      />

      {/* Title */}
      {title && (
        <div className="mb-6 text-center">
          <h2 className="text-xl font-semibold text-white/90 truncate hover:text-white transition-colors">{title}</h2>
        </div>
      )}

      {/* Progress bar */}
      <div
        ref={progressRef}
        onClick={handleProgressClick}
        className="relative h-2 bg-gray-700/50 rounded-full cursor-pointer mb-4 group hover:h-3 transition-all"
      >
        <div
          className="absolute h-full bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 rounded-full"
          style={{ width: `${(currentTime / duration) * 100}%` }}
        />
        <div 
          className="absolute h-4 w-4 bg-white rounded-full opacity-0 group-hover:opacity-100 transition-all duration-200 -top-1 shadow-lg shadow-black/20"
          style={{ left: `${(currentTime / duration) * 100}%`, transform: 'translateX(-50%)' }}
        />
      </div>

      {/* Time display */}
      <div className="flex justify-between text-sm font-medium text-gray-400/80 mb-6">
        <span className="hover:text-gray-300 transition-colors">{formatTime(currentTime)}</span>
        <span className="hover:text-gray-300 transition-colors">{formatTime(duration)}</span>
      </div>

      {/* Controls - Three Rows Layout */}
      <div className="flex flex-col gap-6 items-center justify-center w-full">
        {/* First row: Track and playback controls */}
        <div className="flex items-center justify-center gap-6 w-full">
          {/* Previous track */}
          {onPrev && (
            <button
              onClick={onPrev}
              className="hover:text-blue-400 transition-all p-2 rounded-full hover:scale-110"
              title="Previous"
            >
              <SkipBack size={22} />
            </button>
          )}

          {/* Rewind 5s */}
          <button
            onClick={() => skip(-5)}
            className="hover:text-blue-400 transition-all p-2 rounded-full hover:scale-110 relative"
            title="Rewind 5 seconds"
          >
            <RotateCcw size={30} className="opacity-90" />
            <span className="absolute inset-0 flex items-center justify-center text-sm font-medium">5</span>
          </button>

          {/* Play/Pause button */}
          <button
            onClick={togglePlay}
            className="bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 p-4 rounded-full 
                     hover:opacity-90 transition-all hover:scale-105 hover:shadow-xl hover:shadow-purple-500/20"
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <Pause size={28} /> : <Play size={28} />}
          </button>

          {/* Fast-forward 30s */}
          <button
            onClick={() => skip(30)}
            className="hover:text-blue-400 transition-all p-2 rounded-full hover:scale-110 relative"
            title="Fast-forward 30 seconds"
          >
            <RotateCw size={30} className="opacity-90" />
            <span className="absolute inset-0 flex items-center justify-center text-sm font-medium">30</span>
          </button>

          {/* Next track */}
          {onNext && (
            <button
              onClick={onNext}
              className="hover:text-blue-400 transition-all p-2 rounded-full hover:scale-110"
              title="Next"
            >
              <SkipForward size={22} />
            </button>
          )}
        </div>

        {/* Second row: Volume control */}
        <div className="flex items-center justify-center gap-3 w-full">
          {/* Volume control styled like the screenshot */}
          <div className="flex-1 flex items-center gap-3 bg-gray-800/50 p-2 rounded-full max-w-md">
            {/* Mute/Unmute button */}
            <button
              onClick={toggleMute}
              className="hover:text-blue-400 transition-all p-2 rounded-full hover:scale-110 shrink-0"
              title={isMuted ? "Unmute" : "Mute"}
            >
              {isMuted ? <VolumeX size={20} /> : <Volume1 size={20} />}
            </button>
            {/* Volume slider */}
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={isMuted ? 0 : volume}
              onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
              className="flex-1 h-1.5 bg-gray-600/50 rounded-lg accent-blue-500 outline-none transition-all hover:accent-blue-400"
              style={{ appearance: 'none' }}
              title="Volume"
            />
            {/* Max volume icon */}
            <div className="p-2 shrink-0">
              <Volume2 size={20} className={cn("transition-opacity", isMuted ? 'opacity-30' : 'opacity-70')} />
            </div>
          </div>
        </div>

        {/* Third row: Other function buttons */}
        <div className="flex items-center justify-center gap-3 w-full">
          {/* Play mode button */}
          <button
            onClick={togglePlayMode}
            className={cn(
              "hover:scale-110 transition-all p-2 rounded-full relative group",
              playMode === 'repeat' ? "text-blue-400" : 
              playMode === 'shuffle' ? "text-purple-400" : "text-gray-400/80"
            )}
            title={playModeInfo.tooltip}
          >
            {playModeInfo.icon}
            {/* Tooltip */}
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-gray-800 
                          text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity 
                          pointer-events-none whitespace-nowrap shadow-lg border border-gray-700/50">
              {playModeInfo.tooltip}
            </div>
          </button>

          {/* Playback Speed Controls */}
          <div className="flex items-center gap-1">
            {[0.5, 0.75, 1.0, 1.25, 2.0].map(rate => (
              <button
                key={rate}
                onClick={() => changePlaybackRate(rate)}
                className={cn(
                  "px-2 py-0.5 rounded-full text-xs font-medium transition-all hover:scale-105",
                  playbackRate === rate 
                    ? "bg-blue-500/20 text-blue-400 ring-1 ring-blue-400/30" 
                    : "text-gray-400/80 hover:text-blue-400"
                )}
              >
                {rate}x
              </button>
            ))}
          </div>

          {/* Download button */}
          {onDownload && (
            <button
              onClick={onDownload}
              className="hover:text-blue-400 transition-all p-2 rounded-full hover:scale-110"
              title="Download"
            >
              <Download size={20} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default Audio; 