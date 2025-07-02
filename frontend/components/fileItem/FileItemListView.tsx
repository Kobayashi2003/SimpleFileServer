import { cn } from "@/lib/utils";
import { formatFileSize, getPreviewType } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Folder, File, FileText, FileArchive, Image, Music, Video, Book, BookOpen } from "lucide-react";

interface FileItemProps {
  name: string;
  path: string;
  size: number;
  mtime: string;
  isDirectory: boolean;
  mimeType?: string;
  isSearching: boolean;
  onClick: () => void;
  className?: string;
}

export function FileItemListView(
  { name, path, size, mtime, isDirectory, mimeType, isSearching, onClick, className }: FileItemProps
) {
  const date = new Date(mtime).toLocaleDateString();
  const type = isDirectory ? 'directory' : getPreviewType(mimeType || 'application/octet-stream');

  const getIconComponent = () => {
    switch (type) {
      case 'directory': return Folder;
      case 'image': return Image;
      case 'video': return Video;
      case 'audio': return Music;
      case 'text': case 'pdf': return FileText;
      // case 'archive': return FileArchive;
      case 'epub': return Book;
      case 'comic': return BookOpen;
      default: return File;
    }
  };

  const Icon = getIconComponent();

  return (
    <div
      className={cn(
        "w-full",
        "p-2 rounded-md",
        "flex items-center",
        "cursor-pointer select-none",
        "text-primary bg-transparent", 
        className
      )}
      onClick={onClick}
    >
      <div className="mr-2">
        <Icon size={24} />
      </div>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex-1 min-w-0 truncate text-xs sm:text-sm md:text-base">{name}</div>
          </TooltipTrigger>
          <TooltipContent>
            <p>{name}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {isSearching && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="w-80 truncate text-right text-xs sm:text-sm text-muted-foreground">
                {path}
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>{path}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      <div className="w-24 hidden md:block text-right text-xs sm:text-sm text-muted-foreground">
        {!isDirectory && formatFileSize(size)}
      </div>
      <div className="w-32 hidden md:block text-right text-xs sm:text-sm text-muted-foreground">
        {date}
      </div>
    </div>
  )
}
