import { cn } from "@/lib/utils";
import { formatFileSize, getPreviewType } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Folder, FolderOpen, File, FileText, FileArchive, Image, Music, Video, BookOpen, Book } from "lucide-react";

interface FileItemProps {
  name: string;
  path: string;
  size: number;
  mtime: string;
  isDirectory: boolean;
  mimeType?: string;
  cover?: string;
  onClick: () => void;
  className?: string;
}

export function FileItemGridView(
  { name, path, size, mtime, isDirectory, mimeType, cover, onClick, className }: FileItemProps
) {
  const date = new Date(mtime).toLocaleDateString();
  const type = isDirectory ? 'directory' : getPreviewType(mimeType || 'application/octet-stream');

  const getIconComponent = () => {
    switch (type) {
      case 'directory': return FolderOpen;
      case 'image': return Image;
      case 'video': return Video;
      case 'audio': return Music;
      case 'text': case 'pdf': return FileText;
      case 'epub': return Book;
      // case 'archive': return FileArchive;
      case 'comic': return BookOpen;
      default: return File;
    }
  };

  const Icon = getIconComponent();

  return (
    <Card
      className={cn(
        "relative flex flex-col items-center justify-center",
        "w-full h-full",
        "cursor-pointer select-none",
        "text-primary bg-accent",
        "overflow-hidden",
        className
      )}
      onClick={onClick}
    >
      {/* Cover image as background */}
      {cover && (
        <div className="absolute inset-0 w-full h-full">
          <img
            src={cover}
            alt={`Cover for ${name}`}
            className="w-full h-full object-cover"
            loading="lazy"
          />
          {/* Overlay to ensure content is visible */}
          <div className="absolute inset-0 bg-background/40 backdrop-blur-[2px]" />
        </div>
      )}

      <div className={`flex-1 flex items-center justify-center ${cover ? 'z-10' : ''}`}>
        <Icon size={48} />
      </div>
      <div className={`w-full p-1 ${cover ? 'z-10' : ''}`}>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="text-xs sm:text-sm md:text-base text-center truncate">{name}</div>
            </TooltipTrigger>
            <TooltipContent>
              <p>{name}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {!isDirectory && (
          <div className="text-xs sm:text-sm text-center text-muted-foreground">
            {"size: " + formatFileSize(size)}
            <br />
            {"modified: " + date}
          </div>
        )}
      </div>
    </Card>
  );
}
