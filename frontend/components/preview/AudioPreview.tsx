"use client";

import React, { useCallback, useState, useEffect, useRef } from "react";
import PreviewBase, { PreviewBaseProps } from "./PreviewBase";
import { cn } from "@/lib/utils";
import { Audio } from "@/components/audio/Audio";

interface AudioPreviewProps extends Omit<PreviewBaseProps, 'children' | 'isLoading' | 'hasError'> {
  /** Audio source URL */
  src: string;
}

export const AudioPreview: React.FC<AudioPreviewProps> = ({
  src,
  controls,
  ...restProps
}) => {
  const currentSrcRef = useRef(src);
  const cachedAudioRef = useRef<Set<string>>(new Set());

  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const handleLoad = useCallback(() => {
    if (src === currentSrcRef.current) {
      cachedAudioRef.current.add(src);
      setIsLoading(false);
    }
  }, [src]);

  const handleError = useCallback(() => {
    if (src === currentSrcRef.current) {
      setIsLoading(false);
      setHasError(true);
    }
  }, [src]);

  useEffect(() => {
    currentSrcRef.current = src;
    setHasError(false);
  }, [src]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (isLoading && src === currentSrcRef.current) {
        console.log('Audio load timeout, forcing state update');
        setIsLoading(false);
      }
    }, 60000); // 60 second timeout

    return () => clearTimeout(timeoutId);
  }, [src, isLoading]);

  return (
    <PreviewBase
      isLoading={isLoading}
      hasError={hasError}
      controls={{
        enableBackdropClose: true,
        ...controls
      }}
      {...restProps}
      title=""
    >
      <div className="flex flex-col items-center">
        <Audio
          title={restProps.title}
          src={src}
          onLoad={handleLoad}
          onError={handleError}
          onNext={controls?.onNext}
          onPrev={controls?.onPrev}
          onDownload={controls?.onDownload}
          onClose={controls?.onClose}
          className={cn(
            isLoading || hasError ? "opacity-0" : "",
            "max-w-[90vw] max-h-[90vh]"
          )}
        />
      </div>
    </PreviewBase>
  );
};

export default AudioPreview; 