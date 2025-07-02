import NextImage from "next/image";
import { cn } from "@/lib/utils";
import { Book } from "lucide-react";
import { useState } from "react";

interface EPUBItemProps {
  alt: string;
  thumbnail: string;
  fit?: 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';
  loading?: 'lazy' | 'eager';
  onClick?: () => void;
  className?: string;
}

export function EPUBItem({ alt, thumbnail, fit = 'contain', loading = 'lazy', onClick, className }: EPUBItemProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);

  const handleLoad = () => {
    setIsLoading(false);
  };

  const handleError = () => {
    setIsLoading(false);
    setIsError(true);
  };

  return (
    <div
      className={cn(
        "w-full h-full",
        "border border-border/30 rounded-sm overflow-hidden",
        "relative group",
        className
      )}
      onClick={onClick}
    >
      {/* Blurred background for filling empty space */}
      <div className="absolute inset-0 overflow-hidden">
        {!isError && (
          <NextImage
            src={thumbnail}
            alt=""
            className="w-full h-full object-cover scale-110 blur-md brightness-50"
            loading={loading}
            width={200}
            height={200}
          />
        )}
      </div>

      {/* Thumbnail */}
      <div className="w-full h-full relative z-10 flex items-center justify-center">
        {!isError && (
          <NextImage
            src={thumbnail}
            alt={alt}
            className={cn(
              "w-full h-full",
              fit === 'contain' && "object-contain",
              fit === 'cover' && "object-cover",
              fit === 'fill' && "object-fill",
              fit === 'none' && "object-none",
              fit === 'scale-down' && "object-scale-down",
              "group-hover:scale-105 group-hover:brightness-75",
              isLoading ? "opacity-0" : "opacity-100",
              "transition-all duration-300"
            )}
            loading={loading}
            onLoad={handleLoad}
            onError={handleError}
            width={200}
            height={200}
          />
        )}
      </div>

      {/* Display Icon */}
      <div className="inset-0 absolute z-20 flex items-center justify-center pointer-events-none">
        <div className="p-3 rounded-full bg-black/40 transform group-hover:scale-110 transition-transform duration-300">
          <Book className="h-8 w-8 text-white" />
        </div>
      </div>

      {/* EPUB Icon */}
      <div className="bottom-2 right-2 absolute z-20 px-2 py-1 rounded-sm bg-black/70 text-white text-xs">
        EPUB
      </div>

      {/* Error Display */}
      {isError && (
        <div className="inset-0 absolute z-30 flex items-center justify-center bg-muted/80">
          <div className="p-2 text-center">
            <p className="text-sm text-muted-foreground">Unable to load cover</p>
          </div>
        </div>
      )}

      {/* Loading Display */}
      {isLoading && (
        <div className="inset-0 absolute z-30 flex items-center justify-center bg-muted/50">
          <div className="w-8 h-8 border-4 border-t-transparent rounded-full border-primary animate-spin"></div>
        </div>
      )}
    </div>
  );
} 