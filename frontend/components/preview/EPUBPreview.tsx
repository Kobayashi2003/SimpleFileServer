"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import PreviewBase, { PreviewBaseProps } from "./PreviewBase";
import { EPUBReader } from "@/components/reader";

interface EPUBPreviewProps extends Omit<PreviewBaseProps, 'children' | 'isLoading' | 'hasError' | 'onFullScreen' | 'onToggleDirection'> {
  /** EPUB source URL */
  src: string;
}


export const EPUBPreview: React.FC<EPUBPreviewProps> = ({
  src,
  controls,
  ...restProps
}) => {

  const [isFullScreen, setIsFullScreen] = useState(false);

  return (
    <PreviewBase
      controls={{
        enableBackdropClose: true,
        preventBrowserZoom: true,
        preventPinchZoom: true,
        preventDrag: true,
        preventBrowserNavigation: true,
        preventPullToRefresh: true,
        ...controls
      }}
      {...restProps}
      title={""}
    >
      <EPUBReader
        key={`epub-reader-${isFullScreen ? 'fullscreen' : 'normal'}`}
        src={src}
        className={cn(
          isFullScreen ? "w-screen h-screen" : "w-[90vw] h-[90vh]"
        )}
        onClose={controls?.onClose}
        onDownload={controls?.onDownload}
        onFullScreenChange={setIsFullScreen}
      />
    </PreviewBase>
  );
};

export default EPUBPreview; 