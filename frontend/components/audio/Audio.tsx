"use client";

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { cn } from "@/lib/utils";
import {
  Play, Pause, Volume2, VolumeX, SkipBack, SkipForward,
  Settings, Download, HelpCircle, Repeat, Shuffle
} from 'lucide-react';

interface AudioProps {
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
  // Core audio refs
  const audioRef = useRef<HTMLAudioElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  // Core audio state
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);

  // UI state
  const [showSettings, setShowSettings] = useState(false);
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);
  const [isRepeat, setIsRepeat] = useState(false);
  const [isShuffle, setIsShuffle] = useState(false);

  // Refs for settings menu and keyboard shortcuts
  const settingsRef = useRef<HTMLDivElement>(null);
  const keyboardShortcutsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Format time in MM:SS format
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Audio control functions
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
      setShowSettings(false);
    }
  };

  // Event listeners
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
      if (isRepeat) {
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
  }, [onLoad, isRepeat, onNext]);

  // Keyboard shortcuts
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

  // Show keyboard shortcuts
  const showKeyboardShortcutsHelp = () => {
    setShowKeyboardShortcuts(true);
    if (keyboardShortcutsTimeoutRef.current) {
      clearTimeout(keyboardShortcutsTimeoutRef.current);
    }
    keyboardShortcutsTimeoutRef.current = setTimeout(() => {
      setShowKeyboardShortcuts(false);
    }, 3000);
  };

  return (
    <div className={cn(
      "w-full max-w-3xl",
      "bg-gradient-to-br from-gray-900 to-gray-800",
      "rounded-xl shadow-xl p-6",
      "text-white",
      className
    )}>
      <audio
        ref={audioRef}
        src={src}
        autoPlay={autoPlay}
        onError={onError}
        className="hidden"
      />

      {/* Progress bar */}
      <div
        ref={progressRef}
        onClick={handleProgressClick}
        className="relative h-2 bg-gray-600 rounded-full cursor-pointer mb-4 group"
      >
        <div
          className="absolute h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full"
          style={{ width: `${(currentTime / duration) * 100}%` }}
        />
        <div className="absolute h-3 w-3 bg-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity -top-0.5"
          style={{ left: `${(currentTime / duration) * 100}%`, transform: 'translateX(-50%)' }}
        />
      </div>

      {/* Time display */}
      <div className="flex justify-between text-sm text-gray-400 mb-4">
        <span>{formatTime(currentTime)}</span>
        <span>{formatTime(duration)}</span>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {/* Shuffle button */}
          <button
            onClick={() => setIsShuffle(!isShuffle)}
            className={cn(
              "hover:text-gray-300 transition-colors p-2 rounded-full",
              isShuffle ? "text-blue-500" : "text-gray-400"
            )}
          >
            <Shuffle size={20} />
          </button>

          {/* Previous track */}
          {onPrev && (
            <button
              onClick={onPrev}
              className="hover:text-gray-300 transition-colors p-2 rounded-full"
            >
              <SkipBack size={20} />
            </button>
          )}

          {/* Play/Pause button */}
          <button
            onClick={togglePlay}
            className="bg-gradient-to-r from-blue-500 to-purple-500 p-3 rounded-full hover:opacity-90 transition-opacity"
          >
            {isPlaying ? <Pause size={24} /> : <Play size={24} />}
          </button>

          {/* Next track */}
          {onNext && (
            <button
              onClick={onNext}
              className="hover:text-gray-300 transition-colors p-2 rounded-full"
            >
              <SkipForward size={20} />
            </button>
          )}

          {/* Repeat button */}
          <button
            onClick={() => setIsRepeat(!isRepeat)}
            className={cn(
              "hover:text-gray-300 transition-colors p-2 rounded-full",
              isRepeat ? "text-blue-500" : "text-gray-400"
            )}
          >
            <Repeat size={20} />
          </button>
        </div>

        {/* Volume and settings controls */}
        <div className="flex items-center gap-3">
          {/* Volume control */}
          <div className="flex items-center group">
            <button
              onClick={toggleMute}
              className="hover:text-gray-300 transition-colors p-2 rounded-full"
            >
              {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
            </button>
            <div className="w-0 overflow-hidden transition-all duration-200 group-hover:w-20">
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={isMuted ? 0 : volume}
                onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                className="w-20 accent-blue-500"
              />
            </div>
          </div>

          {/* Help button */}
          <button
            onClick={showKeyboardShortcutsHelp}
            className="hover:text-gray-300 transition-colors p-2 rounded-full"
          >
            <HelpCircle size={20} />
          </button>

          {/* Settings */}
          <div className="relative" ref={settingsRef}>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="hover:text-gray-300 transition-colors p-2 rounded-full"
            >
              <Settings size={20} />
            </button>

            {showSettings && (
              <div className="absolute bottom-full right-0 mb-2 bg-gray-800 border border-gray-700 min-w-[150px] p-2 rounded-lg shadow-xl">
                <div className="text-sm mb-2 font-medium px-2">Playback Speed</div>
                <div className="flex flex-col gap-1">
                  {[0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0].map(rate => (
                    <button
                      key={rate}
                      onClick={() => changePlaybackRate(rate)}
                      className={cn(
                        "text-left px-4 py-2 rounded hover:bg-gray-700 transition-colors",
                        playbackRate === rate ? "bg-gray-700 text-blue-500" : ""
                      )}
                    >
                      {rate}x
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Download button */}
          {onDownload && (
            <button
              onClick={onDownload}
              className="hover:text-gray-300 transition-colors p-2 rounded-full"
            >
              <Download size={20} />
            </button>
          )}
        </div>
      </div>

      {/* Keyboard shortcuts info */}
      {showKeyboardShortcuts && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-gray-800 border border-gray-700 text-xs p-4 rounded-lg shadow-xl">
          <div className="text-center font-medium text-sm mb-2">Keyboard Shortcuts</div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2">
            <div className="flex items-center">
              <span className="bg-gray-700 px-2 py-1 rounded mr-2">Space</span>
              <span>Play/Pause</span>
            </div>
            <div className="flex items-center">
              <span className="bg-gray-700 px-2 py-1 rounded mr-2">←→</span>
              <span>Skip 10s</span>
            </div>
            <div className="flex items-center">
              <span className="bg-gray-700 px-2 py-1 rounded mr-2">↑↓</span>
              <span>Volume</span>
            </div>
            <div className="flex items-center">
              <span className="bg-gray-700 px-2 py-1 rounded mr-2">M</span>
              <span>Mute</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Audio; 