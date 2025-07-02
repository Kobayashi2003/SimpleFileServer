"use client"

import { cn } from "@/lib/utils";
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize,
  SkipBack, SkipForward, Settings, X, Download,
  Sun, ChevronLeft, ChevronRight, Monitor, HelpCircle
} from 'lucide-react';

interface VideoProps {
  src: string;
  autoPlay?: boolean;
  className?: string;
  onError?: () => void;
  onLoad?: () => void;
  onClose?: () => void;
  onDownload?: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  // Fallbacks 
  onFullscreen?: (isFullscreen: boolean) => void;
  onPictureInPicture?: (isPictureInPicture: boolean) => void;
}

export const Video = ({
  src,
  autoPlay = false,
  className,
  onError,
  onLoad,
  onClose,
  onDownload,
  onNext,
  onPrev,
  onFullscreen,
  onPictureInPicture,
}: VideoProps) => {

  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Core video refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlLayerRef = useRef<HTMLDivElement>(null);

  // Core video state
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1.0);

  // Pending progress system
  const [pendingTime, setPendingTime] = useState<number | null>(null);
  const seekTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Seek gesture state
  const [showSeekCancelHint, setShowSeekCancelHint] = useState(false);
  const initialSeekPosRef = useRef<{ x: number, y: number } | null>(null);

  // UI controls state and refs
  const [showControls, setShowControls] = useState(true);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPictureInPicture, setIsPictureInPicture] = useState(false);
  const [isMouseOverControls, setIsMouseOverControls] = useState(false);

  // Video adjustments state
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [brightness, setBrightness] = useState(1);

  // Progress bar refs and state
  const progressRef = useRef<HTMLDivElement>(null);
  const [isUpdatingProgress, setIsUpdatingProgress] = useState(false);
  const progressTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Visual indicators state and refs
  const [skipIndicator, setSkipIndicator] = useState<{ direction: 'forward' | 'backward', seconds: number } | null>(null);
  const skipIndicatorTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const cumulativeSkipRef = useRef<{ direction: 'forward' | 'backward', seconds: number } | null>(null);
  const skipResetTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [showVolumeIndicator, setShowVolumeIndicator] = useState(false);
  const [showBrightnessIndicator, setShowBrightnessIndicator] = useState(false);
  const volumeIndicatorTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const brightnessIndicatorTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Touch gesture refs
  const isTouchingRef = useRef(false);
  const isTouchDraggingRef = useRef(false);
  const touchGestureTypeRef = useRef<'seek' | 'brightness' | 'volume' | null>(null);
  const touchStartRef = useRef<{ x: number, y: number } | null>(null);
  const lastTouchRef = useRef<{ x: number, y: number } | null>(null);


  // Mouse gesture refs
  const isMouseDraggingRef = useRef(false);
  const isMouseDraggingProgressRef = useRef(false);
  const mouseGestureTypeRef = useRef<'seek' | 'brightness' | 'volume' | null>(null);
  const startMousePosRef = useRef<{ x: number, y: number } | null>(null);
  const lastMousePosRef = useRef<{ x: number, y: number } | null>(null);


  // Settings menu state and refs
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  // Container width state for responsive layout
  const [containerWidth, setContainerWidth] = useState(0);
  const controlsContainerRef = useRef<HTMLDivElement>(null);

  // Keyboard shortcuts state and refs
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);
  const keyboardShortcutsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Long press and click detection state and refs
  const [isLongPressing, setIsLongPressing] = useState(false);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const clickStartTimeRef = useRef<number | null>(null);
  const isSimpleClickRef = useRef(false);
  const LONG_PRESS_DURATION = 500; // ms

  // Double click detection
  const singleClickDelayRef = useRef<NodeJS.Timeout | null>(null);
  const isDoubleClickProcessingRef = useRef(false);
  const SINGLE_CLICK_DELAY = 250; // ms

  // Format time in MM:SS format
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const formatTime2 = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Return appropriate layout class based on container width
  const getLayoutClass = () => {
    return containerWidth > 768 ? "grid-cols-3" : "grid-cols-1";
  };

  // Get display time (pending time if available, otherwise current time)
  const getDisplayTime = () => {
    return pendingTime !== null ? pendingTime : currentTime;
  };

  // Get progress percentage for display
  const getProgressPercentage = () => {
    if (duration <= 0) return 0;
    return (getDisplayTime() / duration) * 100;
  };

  // Apply pending time to video
  const applyPendingTime = () => {
    if (videoRef.current) {
      // Use function update to get the latest pendingTime value, but do not clear it immediately
      setPendingTime(latestPendingTime => {
        if (latestPendingTime !== null) {
          const newTime = Math.max(0, Math.min(duration, latestPendingTime));
          videoRef.current!.currentTime = newTime;
          // console.log('applyPendingTime with latest value:', latestPendingTime);
          // Do not return null here, keep the pendingTime value until the seeked event is triggered
          return latestPendingTime;
        }
        return latestPendingTime;
      });

      setIsUpdatingProgress(false);
      setShowSeekCancelHint(false);
      setSkipIndicator(null);  // Hide skip indicator when applying time
      initialSeekPosRef.current = null;

      // Clear skip related timeouts
      if (skipIndicatorTimeoutRef.current) {
        clearTimeout(skipIndicatorTimeoutRef.current);
        skipIndicatorTimeoutRef.current = null;
      }
      // Reset cumulative skip value
      if (skipResetTimeoutRef.current) {
        clearTimeout(skipResetTimeoutRef.current);
        skipResetTimeoutRef.current = null;
      }
      cumulativeSkipRef.current = null;
    }
  };

  // Update pending time with timeout and handle skip indicators
  const updatePendingTime = (
    seconds: number,
    timeoutRef: React.MutableRefObject<NodeJS.Timeout | null>,
    delay: number = 300,
    showIndicator: boolean = true
  ) => {
    // console.log('updatePendingTime', seconds);
    setPendingTime(prevPendingTime => {
      const currentTimeValue = prevPendingTime !== null ? prevPendingTime : currentTime;
      const newTime = Math.max(0, Math.min(duration, currentTimeValue + seconds));
      // console.log('newTime', newTime);

      if (showIndicator && seconds !== 0) {
        const direction = seconds > 0 ? 'forward' : 'backward';
        const absSeconds = Math.abs(seconds);

        if (cumulativeSkipRef.current && cumulativeSkipRef.current.direction === direction) {
          cumulativeSkipRef.current.seconds += absSeconds;
        } else {
          cumulativeSkipRef.current = {
            direction,
            seconds: absSeconds
          };
        }

        setSkipIndicator({
          direction: cumulativeSkipRef.current.direction,
          seconds: Math.round(cumulativeSkipRef.current.seconds)
        });
      }

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        applyPendingTime();
      }, delay);

      return newTime;
    });

    setIsUpdatingProgress(true);
  };

  // Update pending time without timeout (for direct manipulation).
  // NOTE: If you use this function, you must call applyPendingTime() to apply the new time.
  const updatePendingTimeWithoutTimeout = (seconds: number, showIndicator: boolean = false, isNewTime: boolean = false) => {
    // console.log('updatePendingTimeWithoutTimeout', seconds);
    setPendingTime(prevPendingTime => {
      const currentTimeValue = prevPendingTime !== null ? prevPendingTime : currentTime;
      const newTime = isNewTime ?
        Math.max(0, Math.min(duration, seconds)) :
        Math.max(0, Math.min(duration, currentTimeValue + seconds));
      // console.log('newTime', newTime);

      if (showIndicator && seconds !== 0) {
        const direction = isNewTime ?
          (newTime > currentTime ? 'forward' : 'backward') :
          (seconds > 0 ? 'forward' : 'backward');
        const absSeconds = Math.abs(seconds);

        if (cumulativeSkipRef.current && cumulativeSkipRef.current.direction === direction) {
          cumulativeSkipRef.current.seconds += absSeconds;
        } else {
          cumulativeSkipRef.current = {
            direction,
            seconds: absSeconds
          };
        }

        setSkipIndicator({
          direction: cumulativeSkipRef.current.direction,
          seconds: isNewTime ?
            Math.round(Math.abs(newTime - currentTime)) :
            Math.round(cumulativeSkipRef.current.seconds)
        });
      }

      return newTime;
    });

    setIsUpdatingProgress(true);
  };

  // Simplified skip function that uses updatePendingTime
  const skip = (seconds: number) => {
    if (duration > 0) {
      updatePendingTime(seconds, seekTimeoutRef, 300);
    }
  };

  const changePlaybackRate = (rate: number) => {
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
      setPlaybackRate(rate);
      setShowSettings(false);
    }
  };

  const toggleMute = () => {
    if (videoRef.current) {
      const newMutedState = !isMuted;
      videoRef.current.muted = newMutedState;
      setIsMuted(newMutedState);
    }
  };

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play().catch(err => {
          console.error("Error playing video:", err);
        });
      }
    }
  };

  const togglePictureInPicture = async () => {
    if (!videoRef.current) return;

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        setIsPictureInPicture(false);
        onPictureInPicture?.(false);
      } else if (document.pictureInPictureEnabled) {
        await videoRef.current.requestPictureInPicture();
        setIsPictureInPicture(true);
        onPictureInPicture?.(true);
      } else {
        console.error("Picture-in-Picture is not supported in this browser");
      }
    } catch (error) {
      console.error("Error toggling Picture-in-Picture mode:", error);
    }
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;

    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable fullscreen: ${err.message}`);
      });
      onFullscreen?.(true);
    } else {
      document.exitFullscreen().catch(err => {
        console.error(`Error attempting to exit fullscreen: ${err.message}`);
      });
      onFullscreen?.(false);
    }
  };

  const handleVolumeChange = (newVolume: number) => {
    const clampedVolume = Math.max(0, Math.min(1, newVolume));

    setVolume(clampedVolume);
    if (videoRef.current) {
      videoRef.current.volume = clampedVolume;
      setIsMuted(clampedVolume === 0);
    }

    // Show volume indicator and hide brightness indicator
    setShowVolumeIndicator(true);
    setShowBrightnessIndicator(false);

    if (volumeIndicatorTimeoutRef.current) {
      clearTimeout(volumeIndicatorTimeoutRef.current);
    }
    volumeIndicatorTimeoutRef.current = setTimeout(() => {
      setShowVolumeIndicator(false);
    }, 2000);

    // Show controls
    resetControlsTimeout();
  };

  const handleBrightnessChange = (newBrightness: number) => {
    const clampedBrightness = Math.max(0.1, Math.min(2, newBrightness));

    setBrightness(clampedBrightness);

    // Show brightness indicator and hide volume indicator
    setShowBrightnessIndicator(true);
    setShowVolumeIndicator(false);

    if (brightnessIndicatorTimeoutRef.current) {
      clearTimeout(brightnessIndicatorTimeoutRef.current);
    }
    brightnessIndicatorTimeoutRef.current = setTimeout(() => {
      setShowBrightnessIndicator(false);
    }, 2000);

    // Show controls
    resetControlsTimeout();
  };

  const handleVolumeInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    handleVolumeChange(newVolume);
  };

  const handleBrightnessInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newBrightness = parseFloat(e.target.value);
    handleBrightnessChange(newBrightness);
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (controlLayerRef.current) {
      const containerRect = controlLayerRef.current.getBoundingClientRect();
      const mouseX = e.clientX;
      const containerWidth = containerRect.width;
      const mousePosition = (mouseX - containerRect.left) / containerWidth;

      // Left half of the container adjusts brightness
      if (mousePosition < 0.5) {
        const delta = e.deltaY < 0 ? 0.05 : -0.05;
        handleBrightnessChange(brightness + delta);
      }
      // Right half of the container adjusts volume
      else {
        const delta = e.deltaY < 0 ? 0.05 : -0.05;
        handleVolumeChange(volume + delta);
      }
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    const containerRect = controlLayerRef.current?.getBoundingClientRect();

    if (containerRect) {
      // Mark that we're processing a double click
      isDoubleClickProcessingRef.current = true;
      
      // Cancel any pending single click
      if (singleClickDelayRef.current) {
        clearTimeout(singleClickDelayRef.current);
        singleClickDelayRef.current = null;
      }

      // Check if click is in the controls area (bottom 20% of the container)
      const clickY = e.clientY;
      const containerHeight = containerRect.height;
      const controlsAreaThreshold = containerRect.bottom - (containerHeight * 0.2);

      if (clickY > controlsAreaThreshold) {
        return;
      }

      // Process valid double click
      const mouseX = e.clientX;
      const containerWidth = containerRect.width;
      const position = (mouseX - containerRect.left) / containerWidth;

      // Prevent default behavior and stop propagation
      e.preventDefault();
      e.stopPropagation();

      if (position < 0.3) {
        // Left area - skip backward
        skip(-10);
      } else if (position > 0.7) {
        // Right area - skip forward
        skip(10);
      } else {
        // Center area - toggle play
        togglePlay();
      }
    }
  };


  // Auto-hide controls after inactivity
  const resetControlsTimeout = useCallback(() => {
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }

    setShowControls(true);

    if (isPlaying && !isUpdatingProgress && !(containerWidth > 768 && isMouseOverControls)) {
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
      }, 3000);
    }
  }, [isPlaying, isUpdatingProgress, isMouseOverControls, containerWidth]);

  // Track dragging state to prevent controls from hiding
  useEffect(() => {
    if (isUpdatingProgress) {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
      setShowControls(true);
    } else {
      resetControlsTimeout();
    }
  }, [isUpdatingProgress, resetControlsTimeout]);

  // Event listeners
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTimeUpdate = () => {
      if (pendingTime === null) {
        setCurrentTime(video.currentTime);
      }
    };

    const onLoadedMetadata = () => {
      setDuration(video.duration);
      if (onLoad) onLoad();
    };

    const handleError = () => {
      if (onError) onError();
    };

    const onEnded = () => {
      setIsPlaying(false);
      setShowControls(true);
    };

    const onPlay = () => {
      setIsPlaying(true);
      resetControlsTimeout();
    };

    const onPause = () => {
      setIsPlaying(false);
      setShowControls(true);
    };

    const onVolumeChange = () => {
      setVolume(video.volume);
      setIsMuted(video.muted);
    };

    const onFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    const onEnterpictureinpicture = () => {
      setIsPictureInPicture(true);
    };

    const onLeavepictureinpicture = () => {
      setIsPictureInPicture(false);
    };

    const onSeeked = () => {
      setCurrentTime(video.currentTime);
      // Clear pending time when video has actually seeked to new position
      setPendingTime(null);
    };

    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('error', handleError);
    video.addEventListener('ended', onEnded);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('volumechange', onVolumeChange);
    video.addEventListener('enterpictureinpicture', onEnterpictureinpicture);
    video.addEventListener('leavepictureinpicture', onLeavepictureinpicture);
    video.addEventListener('seeked', onSeeked);
    document.addEventListener('fullscreenchange', onFullscreenChange);

    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('error', handleError);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('volumechange', onVolumeChange);
      video.removeEventListener('enterpictureinpicture', onEnterpictureinpicture);
      video.removeEventListener('leavepictureinpicture', onLeavepictureinpicture);
      video.removeEventListener('seeked', onSeeked);
      document.removeEventListener('fullscreenchange', onFullscreenChange);

      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, [onLoad, onError]);

  // Setup ResizeObserver to track container width
  useEffect(() => {
    if (!controlsContainerRef.current) return;

    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });

    resizeObserver.observe(controlsContainerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Handle click outside settings
  useEffect(() => {
    const handleClickOutsideSettings = (e: MouseEvent) => {
      if (showSettings && settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setShowSettings(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutsideSettings);
    return () => {
      document.removeEventListener('mousedown', handleClickOutsideSettings);
    };
  }, [showSettings]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!isMounted) return;

    const handleKeyDown = (e: KeyboardEvent) => {

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
          if (e.ctrlKey) {
            handleBrightnessChange(brightness + 0.1);
          } else {
            handleVolumeChange(volume + 0.1);
          }
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (e.ctrlKey) {
            handleBrightnessChange(brightness - 0.1);
          } else {
            handleVolumeChange(volume - 0.1);
          }
          break;
        case 'f':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'm':
          e.preventDefault();
          toggleMute();
          break;
        case '>':
        case '.':
          e.preventDefault();
          changePlaybackRate(Math.min(playbackRate + 0.25, 2));
          break;
        case '<':
        case ',':
          e.preventDefault();
          changePlaybackRate(Math.max(playbackRate - 0.25, 0.25));
          break;
        case 'Escape':
          if (isFullscreen) {
            e.preventDefault();
            document.exitFullscreen().catch(console.error);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMounted, volume, brightness, isPlaying, playbackRate, isFullscreen]);

  // Clean up timeouts
  useEffect(() => {
    return () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
      if (volumeIndicatorTimeoutRef.current) {
        clearTimeout(volumeIndicatorTimeoutRef.current);
      }
      if (brightnessIndicatorTimeoutRef.current) {
        clearTimeout(brightnessIndicatorTimeoutRef.current);
      }
      if (skipIndicatorTimeoutRef.current) {
        clearTimeout(skipIndicatorTimeoutRef.current);
      }
      if (skipResetTimeoutRef.current) {
        clearTimeout(skipResetTimeoutRef.current);
      }
      if (seekTimeoutRef.current) {
        clearTimeout(seekTimeoutRef.current);
      }
      if (progressTimeoutRef.current) {
        clearTimeout(progressTimeoutRef.current);
      }
      if (keyboardShortcutsTimeoutRef.current) {
        clearTimeout(keyboardShortcutsTimeoutRef.current);
      }
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
      }
      if (singleClickDelayRef.current) {
        clearTimeout(singleClickDelayRef.current);
      }
    };
  }, []);


  // Cancel pending seek operation
  const cancelSeek = () => {
    setPendingTime(null);
    setIsUpdatingProgress(false);
    setSkipIndicator(null);  // Hide skip indicator when canceling
    // setShowSeekCancelHint(false);
    initialSeekPosRef.current = null;

    if (skipIndicatorTimeoutRef.current) {
      clearTimeout(skipIndicatorTimeoutRef.current);
      skipIndicatorTimeoutRef.current = null;
    }
    if (skipResetTimeoutRef.current) {
      clearTimeout(skipResetTimeoutRef.current);
      skipResetTimeoutRef.current = null;
    }
    cumulativeSkipRef.current = null;
  };

  // Check if a point is outside the controls area
  const isOutsideControlsArea = (clientX: number, clientY: number) => {
    if (!controlLayerRef.current || !controlsContainerRef.current) return false;
    
    const containerRect = controlLayerRef.current.getBoundingClientRect();
    const controlsRect = controlsContainerRef.current.getBoundingClientRect();
    
    // Check if the click is above the controls area
    return clientY < controlsRect.top;
  };

  // Get the side (left/right) of the click relative to the container
  const getClickSide = (clientX: number) => {
    if (!controlLayerRef.current) return 'center';
    
    const containerRect = controlLayerRef.current.getBoundingClientRect();
    const position = (clientX - containerRect.left) / containerRect.width;
    
    if (position < 0.5) return 'left';
    return 'right';
  };

  // Handle simple click outside controls area
  const handleClickOutsideControls = (clientX: number, clientY: number) => {
    if (!isOutsideControlsArea(clientX, clientY)) return;
    
    const side = getClickSide(clientX);
    console.log(`Simple click outside controls - Side: ${side}`);
    
    // TODO: Implement click outside controls logic
    // Example: Toggle play/pause for center area clicks
  };

  // Handle simple click outside controls area with delay
  const handleClickOutsideControlsDelayed = (clientX: number, clientY: number) => {
    if (singleClickDelayRef.current) {
      clearTimeout(singleClickDelayRef.current);
    }
    
    singleClickDelayRef.current = setTimeout(() => {
      if (!isDoubleClickProcessingRef.current) {
        handleClickOutsideControls(clientX, clientY);
      }
      isDoubleClickProcessingRef.current = false;
    }, SINGLE_CLICK_DELAY);
  };

  // Handle long press outside controls area
  const handleLongPressOutsideControls = (clientX: number, clientY: number) => {
    if (!isOutsideControlsArea(clientX, clientY)) return;
    
    const side = getClickSide(clientX);
    console.log(`Long press outside controls - Side: ${side}`);
    
    // TODO: Implement long press logic based on side
    switch (side) {
      case 'left':
        console.log('Long press on left side outside controls');
        // TODO: Implement left side long press functionality
        break;
      case 'right':
        console.log('Long press on right side outside controls');
        // TODO: Implement right side long press functionality
        break;
    }
  };

  // Start long press timer
  const startLongPressTimer = (clientX: number, clientY: number) => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
    }
    
    longPressTimerRef.current = setTimeout(() => {
      setIsLongPressing(true);
      handleLongPressOutsideControls(clientX, clientY);
    }, LONG_PRESS_DURATION);
  };

  // Cancel long press timer
  const cancelLongPressTimer = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    setIsLongPressing(false);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    console.log('handleMouseDown');
    e.preventDefault();
    e.stopPropagation();
    isMouseDraggingRef.current = true;
    startMousePosRef.current = { x: e.clientX, y: e.clientY };
    lastMousePosRef.current = { x: e.clientX, y: e.clientY };
    mouseGestureTypeRef.current = null;
    
    // Track click start time for simple click detection
    clickStartTimeRef.current = Date.now();
    isSimpleClickRef.current = true;
    
    // Start long press timer if outside controls area
    if (isOutsideControlsArea(e.clientX, e.clientY)) {
      startLongPressTimer(e.clientX, e.clientY);
    }
    
    resetControlsTimeout();
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    console.log('handleMouseMove');
    e.preventDefault();
    e.stopPropagation();
    resetControlsTimeout();
    
    if (isMouseDraggingRef.current && startMousePosRef.current && lastMousePosRef.current) {
      const deltaXFromStart = e.clientX - startMousePosRef.current.x;
      const deltaYFromStart = e.clientY - startMousePosRef.current.y;
      const deltaX = e.clientX - lastMousePosRef.current.x;
      const deltaY = e.clientY - lastMousePosRef.current.y;
      lastMousePosRef.current = { x: e.clientX, y: e.clientY };
      
      // If movement detected, cancel simple click and long press
      if (Math.abs(deltaXFromStart) > 5 || Math.abs(deltaYFromStart) > 5) {
        isSimpleClickRef.current = false;
        cancelLongPressTimer();
      }
      
      if (mouseGestureTypeRef.current === null) {
        if (Math.abs(deltaXFromStart) > Math.abs(deltaYFromStart) * 2 && Math.abs(deltaXFromStart) > 10) {
          mouseGestureTypeRef.current = 'seek';
        } else if (Math.abs(deltaYFromStart) > Math.abs(deltaXFromStart) * 2 && Math.abs(deltaYFromStart) > 10) {
          const containerRect = controlLayerRef.current?.getBoundingClientRect();
          if (containerRect) {
            const position = (e.clientX - containerRect.left) / containerRect.width;
            if (position < 0.5) {
              mouseGestureTypeRef.current = 'brightness';
            } else {
              mouseGestureTypeRef.current = 'volume';
            }
          }
        }

      }

      if (mouseGestureTypeRef.current === 'seek') {
        if (Math.abs(deltaYFromStart) > 50) {
          setShowSeekCancelHint(true);
          cancelSeek();
        } else {
          setShowSeekCancelHint(false);
          updatePendingTimeWithoutTimeout(currentTime + deltaXFromStart / 10, true, true);
        }
      } else if (mouseGestureTypeRef.current === 'brightness') {
        handleBrightnessChange(brightness + (deltaY < 0 ? 0.005 : -0.005));
      } else if (mouseGestureTypeRef.current === 'volume') {
        handleVolumeChange(volume + (deltaY < 0 ? 0.005 : -0.005));
      }
    }
  };

  const handleMouseUp = (e?: React.MouseEvent) => {
    console.log('handleMouseUp');
    e?.preventDefault();
    e?.stopPropagation();
    
    // Handle simple click detection
    if (isSimpleClickRef.current && clickStartTimeRef.current && e) {
      const clickDuration = Date.now() - clickStartTimeRef.current;
      // Only consider it a simple click if it was quick and no long press occurred
      if (clickDuration < LONG_PRESS_DURATION && !isLongPressing) {
        handleClickOutsideControlsDelayed(e.clientX, e.clientY);
      }
    }
    
    // Cancel long press timer
    cancelLongPressTimer();
    
    // Reset click tracking
    clickStartTimeRef.current = null;
    isSimpleClickRef.current = false;
    
    if (isMouseDraggingRef.current) {
      if (mouseGestureTypeRef.current === 'seek') {
        applyPendingTime();
      }
      isMouseDraggingRef.current = false;
      mouseGestureTypeRef.current = null;
      startMousePosRef.current = null;
      lastMousePosRef.current = null;
      setShowSeekCancelHint(false);
    }
    if (isMouseDraggingProgressRef.current) {
      applyPendingTime();
      isMouseDraggingProgressRef.current = false;
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    // console.log('handleTouchStart');
    // e.preventDefault();
    e.stopPropagation();

    isTouchingRef.current = true;
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    lastTouchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    touchGestureTypeRef.current = null;
    
    // Track touch start time for simple touch detection
    clickStartTimeRef.current = Date.now();
    isSimpleClickRef.current = true;
    
    // Start long press timer if outside controls area
    if (isOutsideControlsArea(e.touches[0].clientX, e.touches[0].clientY)) {
      startLongPressTimer(e.touches[0].clientX, e.touches[0].clientY);
    }
    
    resetControlsTimeout();
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    // console.log('handleTouchMove');
    // e.preventDefault();
    e.stopPropagation();
    resetControlsTimeout();
    
    if (e.touches.length === 1 && touchStartRef.current && lastTouchRef.current) {
      const touch = e.touches[0];
      const deltaXFromStart = touch.clientX - touchStartRef.current.x;
      const deltaYFromStart = touch.clientY - touchStartRef.current.y;
      const deltaX = touch.clientX - lastTouchRef.current.x;
      const deltaY = touch.clientY - lastTouchRef.current.y;
      lastTouchRef.current = { x: touch.clientX, y: touch.clientY };
      
      // If movement detected, cancel simple touch and long press
      if (Math.abs(deltaXFromStart) > 5 || Math.abs(deltaYFromStart) > 5) {
        isSimpleClickRef.current = false;
        cancelLongPressTimer();
      }
      
      if (touchGestureTypeRef.current === null) {
        if (Math.abs(deltaXFromStart) > Math.abs(deltaYFromStart) * 2 && Math.abs(deltaXFromStart) > 10) {
          touchGestureTypeRef.current = 'seek';
        } else if (Math.abs(deltaYFromStart) > Math.abs(deltaXFromStart) * 2 && Math.abs(deltaYFromStart) > 10) {
          const containerRect = controlLayerRef.current?.getBoundingClientRect();
          if (containerRect) {
            const position = (touch.clientX - containerRect.left) / containerRect.width;
            if (position < 0.5) {
              touchGestureTypeRef.current = 'brightness';
            } else {
              touchGestureTypeRef.current = 'volume';
            }
          }
        }
      }

      if (touchGestureTypeRef.current === 'seek') {
        if (Math.abs(deltaYFromStart) > 50) {
          setShowSeekCancelHint(true);
          cancelSeek();
        } else {
          setShowSeekCancelHint(false);
          updatePendingTimeWithoutTimeout(currentTime + deltaXFromStart, true, true);
        }
      } else if (touchGestureTypeRef.current === 'brightness') {
        handleBrightnessChange(brightness + (deltaY < 0 ? 0.005 : -0.005));
      } else if (touchGestureTypeRef.current === 'volume') {
        handleVolumeChange(volume + (deltaY < 0 ? 0.005 : -0.005));
      }
    }
  };

  const handleTouchEnd = (e?: React.TouchEvent) => {
    // console.log('handleTouchEnd');
    // e?.preventDefault();
    e?.stopPropagation();
    
    // Handle simple touch detection
    if (isSimpleClickRef.current && clickStartTimeRef.current && touchStartRef.current) {
      const touchDuration = Date.now() - clickStartTimeRef.current;
      // Only consider it a simple touch if it was quick and no long press occurred
      if (touchDuration < LONG_PRESS_DURATION && !isLongPressing) {
        handleClickOutsideControlsDelayed(touchStartRef.current.x, touchStartRef.current.y);
      }
    }
    
    // Cancel long press timer
    cancelLongPressTimer();
    
    // Reset touch tracking
    clickStartTimeRef.current = null;
    isSimpleClickRef.current = false;
    
    if (isTouchingRef.current) {
      if (touchGestureTypeRef.current === 'seek') {
        applyPendingTime();
      }
      isTouchingRef.current = false;
      touchStartRef.current = null;
      lastTouchRef.current = null;
      touchGestureTypeRef.current = null;
      setShowSeekCancelHint(false);
    }
    if (isTouchDraggingRef.current) {
      applyPendingTime();
      isTouchDraggingRef.current = false;
    }
  };

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    console.log('handleProgressClick');
    e.preventDefault();
    e.stopPropagation();
    if (!showControls) return;
    if (progressRef.current && duration > 0) {
      const rect = progressRef.current.getBoundingClientRect();
      const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const newTime = pos * duration;
      updatePendingTimeWithoutTimeout(newTime, false, true);
      applyPendingTime();
    }
  }

  const handleProgressMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    console.log('handleProgressMouseDown');
    e.preventDefault();
    e.stopPropagation();
    isMouseDraggingProgressRef.current = true;
  }

  const handleProgressMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    console.log('handleProgressMouseMove');
    e.preventDefault();
    e.stopPropagation();
    if (isMouseDraggingProgressRef.current && progressRef.current && duration > 0) {
      const rect = progressRef.current.getBoundingClientRect();
      const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const newTime = pos * duration;
      updatePendingTimeWithoutTimeout(newTime, false, true);
    }
  }

  const handleProgressMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    console.log('handleProgressMouseUp');
    e.preventDefault();
    e.stopPropagation();
    if (isMouseDraggingProgressRef.current) {
      applyPendingTime();
      isMouseDraggingProgressRef.current = false;
    }
  }

  const handleProgressTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    // console.log('handleProgressTouchStart');
    // e.preventDefault();
    e.stopPropagation();
    isTouchDraggingRef.current = true;
  }

  const handleProgressTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    // console.log('handleProgressTouchMove');
    // e.preventDefault();
    e.stopPropagation();
    if (isTouchDraggingRef.current && progressRef.current && duration > 0) {
      const rect = progressRef.current.getBoundingClientRect();
      const pos = Math.max(0, Math.min(1, (e.touches[0].clientX - rect.left) / rect.width));
      const newTime = pos * duration;
      updatePendingTimeWithoutTimeout(newTime, false, true);
    }
  }

  const handleProgressTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    // console.log('handleProgressTouchEnd');
    // e.preventDefault();
    // We don't need to handle this event here, it will be handled by the parent
  }

  // Global mouse up / touch end handler
  useEffect(() => {

    const handleGlobalMouseUp = () => {
      if (isMouseDraggingRef.current) {
        handleMouseUp();
      }
    }

    const handleGlobalTouchEnd = () => {
      if (isTouchDraggingRef.current) {
        handleTouchEnd();
      }
    }

    window.addEventListener('mouseup', handleGlobalMouseUp);
    window.addEventListener('touchend', handleGlobalTouchEnd);
    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      window.removeEventListener('touchend', handleGlobalMouseUp);
    }
  }, []);

  // Function to show/hide keyboard shortcuts
  const showKeyboardShortcutsHelp = () => {
    setShowKeyboardShortcuts(true);

    if (keyboardShortcutsTimeoutRef.current) {
      clearTimeout(keyboardShortcutsTimeoutRef.current);
    }

    keyboardShortcutsTimeoutRef.current = setTimeout(() => {
      setShowKeyboardShortcuts(false);
    }, 5000); // Hide after 5 seconds
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "select-none",
        "relative group",
        "flex flex-col items-center justify-center",
        "text-white text-sm",
        className
      )}
    >
      <video
        ref={videoRef}
        src={src}
        autoPlay={autoPlay}
        className={isFullscreen ? "max-w-screen max-h-screen" : "max-w-[90vw] max-h-[90vh]"}
        style={{ filter: `brightness(${brightness})` }}
      />

      {/* Control layer */}
      <div
        ref={controlLayerRef}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="absolute inset-0 z-10"
      />

      {/* Seek cancel hint */}
      {showSeekCancelHint && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-black/70 rounded-lg p-2 z-40">
          Release to cancel seeking
        </div>
      )}

      {/* Skip indicators */}
      {skipIndicator && (
        <div className={cn(
          "absolute top-1/2 -translate-y-1/2 z-40",
          skipIndicator.direction === 'forward' ? "right-8" : "left-8",
          "flex flex-col items-center justify-center gap-2",
          "bg-black/70 rounded-full h-20 w-20",
        )}>
          {skipIndicator.direction === 'forward' ? (
            <SkipForward size={32} />
          ) : (
            <SkipBack size={32} />
          )}
          {formatTime2(skipIndicator.seconds)}
        </div>
      )}

      {/* Volume indicator at top */}
      {showVolumeIndicator && (
        <div className="absolute top-6 left-0 right-0 px-6 flex items-center justify-center z-40">
          <div className="bg-black/70 rounded-full p-2 flex items-center justify-center gap-2">
            {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
            <div className="w-40 h-2 bg-gray-600 rounded-full">
              <div
                className="h-full bg-white rounded-full"
                style={{ width: `${isMuted ? 0 : volume * 100}%` }}
              />
            </div>
            {Math.round(volume * 100)}%
          </div>
        </div>
      )}

      {/* Brightness indicator at top */}
      {showBrightnessIndicator && (
        <div className="absolute top-6 left-0 right-0 px-6 flex items-center justify-center z-40">
          <div className="bg-black/70 rounded-full p-2 flex items-center justify-center gap-2">
            <Sun size={20} />
            <div className="w-40 h-2 bg-gray-600 rounded-full">
              <div
                className="h-full bg-yellow-500 rounded-full"
                style={{ width: `${Math.min(brightness * 50, 100)}%` }}
              />
            </div>
            {Math.round(brightness * 50)}%
          </div>
        </div>
      )}

      {/* Play/Pause button in center when paused */}
      {!isPlaying && (
        <div className="absolute inset-0 flex items-center justify-center z-40">
          <div
            className="bg-black/40 rounded-full p-5 cursor-pointer hover:bg-black/70 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              togglePlay();
            }}
          >
            <Play size={40} />
          </div>
        </div>
      )}

      {/* Custom controls - positioned absolutely at the bottom */}
      <div
        ref={controlsContainerRef}
        onMouseEnter={() => setIsMouseOverControls(true)}
        onMouseLeave={() => {
          setIsMouseOverControls(false);
          resetControlsTimeout();
        }}
        // Add mouse / touch end events here to handle the case where the touch bar is dragged and the mouse / touch end event is missed
        onMouseUp={handleMouseUp}
        onTouchEnd={handleTouchEnd}
        className={cn(
          "controls",
          "absolute bottom-0 left-0 right-0 z-40",
          "flex flex-col items-center justify-center gap-2",
          "px-4 pt-16 pb-4",
          "bg-gradient-to-t from-black/80 to-transparent",
          "transition-opacity duration-300",
          showControls ? "opacity-100" : "opacity-0",
        )}
      >
        {/* Progress bar */}
        <div
          ref={progressRef}
          onClick={handleProgressClick}
          onMouseDown={handleProgressMouseDown}
          onMouseMove={handleProgressMouseMove}
          onMouseUp={handleProgressMouseUp}
          onTouchStart={handleProgressTouchStart}
          onTouchMove={handleProgressTouchMove}
          onTouchEnd={handleProgressTouchEnd}
          className={cn(
            "relative group/progress",
            "bg-gray-600 w-full rounded-full",
            "transition-all duration-150",
            isUpdatingProgress ? "h-4" : "h-2",
            showControls ? "cursor-pointer" : "cursor-default"
          )}
        >
          {/* Background bar */}
          <div
            className={cn(
              "relative h-full rounded-full transition-colors",
              isUpdatingProgress ? "bg-red-400" : "bg-red-500"
            )}
            style={{ width: `${getProgressPercentage()}%` }}
          >
          </div>
          {/* Time indicator tooltip when dragging */}
          {isUpdatingProgress && (
            <div
              className="absolute top-0 transform -translate-y-full -translate-x-1/2 bg-black/70 text-xs p-2 rounded-full"
              style={{ left: `${getProgressPercentage()}%` }}
            >
              {formatTime(getDisplayTime())}
            </div>
          )}
        </div>

        {/* Controls grid layout */}
        <div className={`grid ${getLayoutClass()} gap-y-4 items-center w-full`}>
          {/* Time display - Left section */}
          <div className={`flex ${containerWidth > 768 ? "justify-start" : "justify-center"} items-center`}>
            {formatTime(getDisplayTime())} / {formatTime(duration)}
          </div>

          {/* Playback controls - Center section */}
          <div className="flex justify-center items-center gap-4">
            {/* Skip backward button */}
            <button
              onClick={() => skip(-10)}
              className="hover:text-gray-300 transition-colors rounded-full p-1"
              aria-label="Skip backward 10 seconds"
            >
              <SkipBack size={18} />
            </button>

            {/* Previous video button */}
            {onPrev && (
              <button
                onClick={onPrev}
                className="hover:text-gray-300 transition-colors rounded-full p-1"
                aria-label="Previous video"
              >
                <ChevronLeft size={18} />
              </button>
            )}

            {/* Play/Pause button */}
            <button
              onClick={togglePlay}
              className="hover:text-gray-300 transition-colors rounded-full p-1"
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? <Pause size={18} /> : <Play size={18} />}
            </button>

            {/* Next video button */}
            {onNext && (
              <button
                onClick={onNext}
                className="hover:text-gray-300 transition-colors rounded-full p-1"
                aria-label="Next video"
              >
                <ChevronRight size={18} />
              </button>
            )}

            {/* Skip forward button */}
            <button
              onClick={() => skip(10)}
              className="hover:text-gray-300 transition-colors rounded-full p-1"
              aria-label="Skip forward 10 seconds"
            >
              <SkipForward size={18} />
            </button>
          </div>

          {/* Settings controls - Right section */}
          <div className={`flex ${containerWidth > 768 ? "justify-end" : "justify-center"} items-center gap-4`}>
            {/* Volume control */}
            <div className="flex items-center group/volume">
              <button
                onClick={toggleMute}
                className="hover:text-gray-300 transition-colors rounded-full p-1"
                aria-label={isMuted ? "Unmute" : "Mute"}
              >
                {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
              <div className="w-0 overflow-hidden transition-all duration-200 group-hover/volume:w-20">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeInput}
                  onMouseDown={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                  className="w-20 accent-red-500"
                  aria-label="Volume"
                />
              </div>
            </div>

            {/* Brightness control */}
            <div className="flex items-center group/brightness">
              <button
                onClick={() => setBrightness(brightness === 1 ? 1.5 : 1)}
                className="hover:text-gray-300 transition-colors rounded-full p-1"
                aria-label="Adjust brightness"
              >
                <Sun size={18} />
              </button>
              <div className="w-0 overflow-hidden transition-all duration-200 group-hover/brightness:w-20">
                <input
                  type="range"
                  min="0.1"
                  max="2"
                  step="0.1"
                  value={brightness}
                  onChange={handleBrightnessInput}
                  onMouseDown={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                  className="w-20 accent-yellow-500"
                  aria-label="Brightness"
                />
              </div>
            </div>

            {/* Fullscreen button */}
            <button
              onClick={toggleFullscreen}
              className="hover:text-gray-300 transition-colors rounded-full p-1"
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            >
              {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
            </button>

            {/* Picture-in-picture button */}
            <button
              onClick={togglePictureInPicture}
              className={cn(
                "hover:text-gray-300 transition-colors rounded-full p-1",
                isPictureInPicture ? "text-blue-400 hover:text-blue-300" : "",
                isFullscreen ? "hidden" : ""
              )}
              aria-label={isPictureInPicture ? "Exit picture-in-picture" : "Enter picture-in-picture"}
            >
              <Monitor size={18} />
            </button>

            {/* Download button */}
            {onDownload && (
              <button
                onClick={onDownload}
                className="hover:text-gray-300 transition-colors rounded-full p-1"
                aria-label="Download video"
              >
                <Download size={18} />
              </button>
            )}

            {/* Help button - Add before Settings */}
            <button
              onClick={showKeyboardShortcutsHelp}
              className="hover:text-gray-300 transition-colors rounded-full p-1"
              aria-label="Keyboard shortcuts"
            >
              <HelpCircle size={18} />
            </button>

            {/* Settings */}
            <div className="relative" ref={settingsRef}>
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="hover:text-gray-300 transition-colors hidden sm:inline-block rounded-full p-1"
                aria-label="Settings"
              >
                <Settings size={18} />
              </button>

              {showSettings && (
                <div
                  className="absolute bottom-full right-0 mb-2 bg-black/90 border-0 min-w-[150px] p-2 rounded-md z-10"
                >
                  <div className="text-sm mb-2 font-medium px-2">Playback Speed</div>
                  <div className="flex flex-col gap-2">
                    {[0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0].map(rate => (
                      <button
                        key={rate}
                        onClick={() => changePlaybackRate(rate)}
                        className={cn(
                          "text-left p-2 rounded hover:bg-gray-700 transition-colors cursor-pointer",
                          playbackRate === rate ? "bg-gray-700" : ""
                        )}
                      >
                        {rate}x
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Close button (only shown when onClose is provided) */}
      {onClose && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className={cn(
            "absolute top-4 right-4 z-40 bg-black/50 p-2 rounded-full hover:bg-black/70 transition-opacity duration-300",
            showControls ? "opacity-100" : "opacity-0 pointer-events-none"
          )}
          aria-label="Close video"
        >
          <X size={24} />
        </button>
      )}

      {/* Keyboard shortcuts info */}
      {showKeyboardShortcuts && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/80 text-xs p-3 rounded-lg z-40 shadow-lg">
          <div className="flex flex-col gap-2">
            <div className="text-center font-medium text-sm mb-1">Keyboard Shortcuts</div>
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
                <span className="bg-gray-700 px-2 py-1 rounded mr-2">Ctrl+↑↓</span>
                <span>Brightness</span>
              </div>
              <div className="flex items-center">
                <span className="bg-gray-700 px-2 py-1 rounded mr-2">F</span>
                <span>Fullscreen</span>
              </div>
              <div className="flex items-center">
                <span className="bg-gray-700 px-2 py-1 rounded mr-2">M</span>
                <span>Mute</span>
              </div>
              <div className="flex items-center">
                <span className="bg-gray-700 px-2 py-1 rounded mr-2">,/.</span>
                <span>Speed -/+</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Video;
