"use client"

import React, { useState, useEffect, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import PreviewBase, { PreviewBaseProps } from "./PreviewBase";

interface ImagePreviewProps extends Omit<PreviewBaseProps, 'children' | 'onZoomIn' | 'onZoomOut' | 'isLoading' | 'hasError' | 'onFullScreen' | 'onToggleDirection'> {
  /** Image source URL */
  src: string;
  /** Alternative text for the image */
  alt?: string;
  /** Initial zoom level (1 = normal size) */
  initialZoom?: number;
  /** Max zoom level */
  maxZoom?: number;
  /** Min zoom level */
  minZoom?: number;
  /** Zoom step size */
  zoomStep?: number;
}

export const ImagePreview: React.FC<ImagePreviewProps> = ({
  src,
  alt = "Preview",
  initialZoom = 1,
  maxZoom = 5,
  minZoom = 0.5,
  zoomStep = 0.5,
  controls,
  ...restProps
}) => {
  // Internal state for zoom and position
  const [zoom, setZoom] = useState(initialZoom);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const dragStartPosition = useRef({ x: 0, y: 0 });
  const lastMousePosition = useRef({ x: 0, y: 0 });
  const moveSpeedRef = useRef({ x: 0, y: 0 });
  const animationRef = useRef<number | null>(null);
  const currentSrcRef = useRef(src);
  const cachedImagesRef = useRef<Set<string>>(new Set());
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Internal loading and error states
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  // Handle image load event
  const handleImageLoad = useCallback(() => {
    cachedImagesRef.current.add(src);
    if (src === currentSrcRef.current) {
      setIsLoading(false);
    }
  }, [src]);

  // Handle image error event
  const handleImageError = useCallback(() => {
    if (src === currentSrcRef.current) {
      setIsLoading(false);
      setHasError(true);
    }
  }, []);

  // Track current src and cached images
  useEffect(() => {
    currentSrcRef.current = src;

    const checkIfCached = () => {
      if (cachedImagesRef.current.has(src)) {
        if (src === currentSrcRef.current) {
          setIsLoading(false);
        }
        return;
      }

      const img = new Image();
      img.onload = () => {
        cachedImagesRef.current.add(src);
        if (src === currentSrcRef.current) {
          setIsLoading(false);
        }
      };
      img.onerror = () => {
        if (src === currentSrcRef.current) {
          setIsLoading(true);
        }
      };

      // Set src to trigger load check - this will use browser cache if available
      img.src = src;

      // If image is complete already (instant load from cache), 
      // onload might not fire in some browsers
      if (img.complete) {
        cachedImagesRef.current.add(src);
        if (src === currentSrcRef.current) {
          setIsLoading(false);
        }
      } else {
        if (src === currentSrcRef.current) {
          setIsLoading(true);
        }
      }
    };

    checkIfCached();
    setHasError(false);
    setZoom(initialZoom);
    setPosition({ x: 0, y: 0 });
    setIsDragging(false);
  }, [src, initialZoom]);

  // Add a timeout to prevent infinite loading
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (isLoading && src === currentSrcRef.current) {
        console.log('Image load timeout, forcing state update');
        setIsLoading(false);
      }
    }, 5000); // 5 second timeout

    return () => clearTimeout(timeoutId);
  }, [src, isLoading]);


  // Zoom handlers
  const handleZoomIn = useCallback(() => {
    setZoom(prev => Math.min(maxZoom, prev + zoomStep));
  }, [maxZoom, zoomStep]);

  const handleZoomOut = useCallback(() => {
    setZoom(prev => Math.max(minZoom, prev - zoomStep));
  }, [minZoom, zoomStep]);

  const handleResetZoom = useCallback(() => {
    setZoom(1);
    setPosition({ x: 0, y: 0 });
  }, []);

  // Calculate bounds for the image based on zoom level and dimensions
  const getBounds = useCallback(() => {
    if (!imageRef.current || !containerRef.current) {
      return { minX: -Infinity, maxX: Infinity, minY: -Infinity, maxY: Infinity };
    }

    const img = imageRef.current;
    const container = containerRef.current;

    // Calculate the scaled dimensions of the image
    const scaledWidth = img.naturalWidth * zoom;
    const scaledHeight = img.naturalHeight * zoom;

    // Get container dimensions
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;

    // If the image is smaller than the container (even with zoom), center it
    if (scaledWidth <= containerWidth) {
      // No horizontal movement allowed, just keep it centered
      const centerX = 0;
      return {
        minX: centerX,
        maxX: centerX,
        minY: -Math.max(0, (scaledHeight - containerHeight) / 2),
        maxY: Math.max(0, (scaledHeight - containerHeight) / 2)
      };
    } else {
      // Allow horizontal movement within bounds
      const horizontalExcess = (scaledWidth - containerWidth) / 2;
      const verticalExcess = Math.max(0, (scaledHeight - containerHeight) / 2);

      return {
        minX: -horizontalExcess,
        maxX: horizontalExcess,
        minY: -verticalExcess,
        maxY: verticalExcess
      };
    }
  }, [zoom]);

  // Constrain position within bounds
  const constrainPosition = useCallback((pos: { x: number, y: number }) => {
    const bounds = getBounds();
    return {
      x: Math.min(Math.max(pos.x, bounds.minX), bounds.maxX),
      y: Math.min(Math.max(pos.y, bounds.minY), bounds.maxY)
    };
  }, [getBounds]);

  // Handle inertia animation
  const applyInertia = useCallback(() => {
    if (moveSpeedRef.current.x === 0 && moveSpeedRef.current.y === 0) {
      return;
    }

    // Apply inertia with friction
    moveSpeedRef.current.x *= 0.9;
    moveSpeedRef.current.y *= 0.9;

    // Stop when speed is very low
    if (
      Math.abs(moveSpeedRef.current.x) < 0.5 &&
      Math.abs(moveSpeedRef.current.y) < 0.5
    ) {
      moveSpeedRef.current = { x: 0, y: 0 };
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      return;
    }

    // Apply position with constraints
    setPosition(prev => {
      const newPosition = {
        x: prev.x + moveSpeedRef.current.x,
        y: prev.y + moveSpeedRef.current.y
      };
      return constrainPosition(newPosition);
    });

    animationRef.current = requestAnimationFrame(applyInertia);
  }, [constrainPosition]);

  // Handle image mouse events for dragging
  const handleImageMouseDown = useCallback((e: React.MouseEvent<HTMLImageElement>) => {
    if (zoom <= 1) return; // Only enable dragging when zoomed in

    // Cancel any ongoing inertia animation
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }

    setIsDragging(true);
    dragStartPosition.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y
    };
    lastMousePosition.current = { x: e.clientX, y: e.clientY };
    moveSpeedRef.current = { x: 0, y: 0 };
    e.preventDefault();
  }, [zoom, position]);

  const handleImageMouseMove = useCallback((e: React.MouseEvent<HTMLImageElement>) => {
    if (!isDragging) return;

    // Calculate movement speed for inertia
    moveSpeedRef.current = {
      x: (e.clientX - lastMousePosition.current.x) * 0.8, // Scale down speed
      y: (e.clientY - lastMousePosition.current.y) * 0.8
    };

    lastMousePosition.current = { x: e.clientX, y: e.clientY };

    // Apply position with constraints
    const rawPosition = {
      x: e.clientX - dragStartPosition.current.x,
      y: e.clientY - dragStartPosition.current.y
    };

    setPosition(constrainPosition(rawPosition));
    e.preventDefault();
  }, [isDragging, constrainPosition]);

  const handleImageMouseUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);

      // Start inertia if we have speed
      if (
        (Math.abs(moveSpeedRef.current.x) > 0.5 ||
          Math.abs(moveSpeedRef.current.y) > 0.5) &&
        zoom > 1
      ) {
        animationRef.current = requestAnimationFrame(applyInertia);
      }
    }
  }, [isDragging, applyInertia, zoom]);

  // Handle touch events for dragging
  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLImageElement>) => {
    if (zoom <= 1) return;

    // Cancel any ongoing inertia animation
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }

    setIsDragging(true);
    const touch = e.touches[0];
    dragStartPosition.current = {
      x: touch.clientX - position.x,
      y: touch.clientY - position.y
    };
    lastMousePosition.current = { x: touch.clientX, y: touch.clientY };
    moveSpeedRef.current = { x: 0, y: 0 };
    e.preventDefault();
  }, [zoom, position]);

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLImageElement>) => {
    if (!isDragging) return;

    const touch = e.touches[0];

    // Calculate movement speed for inertia
    moveSpeedRef.current = {
      x: (touch.clientX - lastMousePosition.current.x) * 0.8,
      y: (touch.clientY - lastMousePosition.current.y) * 0.8
    };

    lastMousePosition.current = { x: touch.clientX, y: touch.clientY };

    // Apply position with constraints
    const rawPosition = {
      x: touch.clientX - dragStartPosition.current.x,
      y: touch.clientY - dragStartPosition.current.y
    };

    setPosition(constrainPosition(rawPosition));
    e.preventDefault();
  }, [isDragging, constrainPosition]);

  const handleTouchEnd = useCallback(() => {
    handleImageMouseUp();
  }, [handleImageMouseUp]);

  const handleTouchCancel = useCallback(() => {
    handleImageMouseUp();
  }, [handleImageMouseUp]);

  const handleFullScreenChange = useCallback((fullScreenState: boolean) => {
    setIsFullScreen(fullScreenState);

    // Recalculate position constraints when going fullscreen
    if (zoom > 1) {
      setPosition(prev => constrainPosition(prev));
    }
  }, [zoom, constrainPosition]);

  // Reset position when zoom changes to 1 or less
  useEffect(() => {
    if (zoom <= 1) {
      setPosition({ x: 0, y: 0 });
    } else {
      // When zooming in, make sure position stays within bounds
      setPosition(prev => constrainPosition(prev));
    }
  }, [zoom, constrainPosition]);

  // Reapply constraints when window is resized
  useEffect(() => {
    const handleResize = () => {
      if (zoom > 1) {
        setPosition(prev => constrainPosition(prev));
      }
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [zoom, constrainPosition]);

  // Global mouse up handler
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (isDragging) {
        handleImageMouseUp();
      }
    };

    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isDragging, handleImageMouseUp]);

  // Clean up animation frame on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  const getImageStyles = () => {
    const safeZoom = Math.max(minZoom, Math.min(maxZoom, zoom));

    return {
      transform: `scale(${safeZoom})`,
      translate: `${position.x}px ${position.y}px`,
      // Apply smooth transitions only for zoom, not for position when using inertia
      transition: isDragging || animationRef.current
        ? 'transform 0.2s ease' // Only zoom transitions when dragging or inertia is active
        : 'transform 0.2s ease, translate 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)' // Smooth easing for manual positioning
    };
  };

  return (
    <PreviewBase
      isLoading={isLoading}
      hasError={hasError}
      controls={{
        showClose: true,
        enableBackdropClose: true,

        showDownload: true,

        showZoom: true,
        enableCtrlWheelZoom: true,
        enablePinchZoom: true,
        onZoomIn: handleZoomIn,
        onZoomOut: handleZoomOut,

        showDirectionToggle: true,

        showNavigation: true,
        enableTouchNavigation: zoom <= 1,
        enableWheelNavigation: zoom <= 1,

        showFullscreen: true,
        useBrowserFullscreenAPI: true,
        enableFullscreenNavigation: zoom == 1,
        enableFullscreenToolbar: true,
        
        enableHandleKeyboard: true,
        enableBaseHandleKeyboard: true,

        preventBrowserZoom: true,
        preventPinchZoom: true,
        preventContextMenu: true,
        preventTextSelection: true,
        preventDrag: true,
        preventBrowserNavigation: true,
        preventPullToRefresh: true,
        removeTouchDelay: true,

        ...controls
      }}
      callbacks={{
        onFullScreenChange: handleFullScreenChange
      }}
      {...restProps}
    >
      <div ref={containerRef} className="relative flex items-center justify-center w-full h-full">
        <img
          ref={imageRef}
          src={src}
          alt={alt}
          className={cn(
            (isLoading || hasError) && "opacity-0",
            isFullScreen ? "max-w-screen max-h-screen" : "max-w-[90vw] max-h-[90vh]",
            isDragging && "cursor-grabbing",
            zoom > 1 && !isDragging && "cursor-grab"
          )}
          style={getImageStyles()}
          onLoad={handleImageLoad}
          onError={handleImageError}
          onDoubleClick={handleResetZoom}
          onMouseDown={handleImageMouseDown}
          onMouseMove={handleImageMouseMove}
          onMouseUp={handleImageMouseUp}
          onMouseLeave={() => isDragging && handleImageMouseUp()}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchCancel}
        />
      </div>
    </PreviewBase>
  );
};

export default ImagePreview; 