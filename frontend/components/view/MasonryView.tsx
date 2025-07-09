import React, { useCallback } from 'react';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { ImageItem } from "@/components/fileItem";
import { cn } from "@/lib/utils";
import {
  Info, Check, Edit, ClipboardCopy, Scissors, Download, Trash2
} from "lucide-react";
import { FileData } from './types';

interface MasonryCellProps {
  index: number;
  style: React.CSSProperties;
  data: {
    columnCount: number;
    columnWidth: number;
    files: FileData[];
    selectedFiles: string[];
    isSelecting: boolean;
    useImageQuickPreview: boolean;
    direction: 'ltr' | 'rtl';
    onFileClick: (path: string, mimeType: string, isDirectory: boolean) => void;
    onCopy: (path: string) => void;
    onCut: (path: string) => void;
    onDownload: (path: string) => void;
    onDelete: (path: string) => void;
    onShowDetails: (file: FileData) => void;
    onQuickSelect: (path: string) => void;
    onRename: (path: string) => void;
    focusedIndex: number | null;
  };
}

const MasonryCell = React.memo(({ index, style, data }: MasonryCellProps) => {
  const { files, selectedFiles, isSelecting, columnCount, columnWidth, direction, useImageQuickPreview, onFileClick, onCopy, onCut, onDownload, onDelete, onShowDetails, onQuickSelect, onRename, focusedIndex } = data;
  // Each index represents a column of images
  if (index >= columnCount) return null;

  // Get files for this column using distribution algorithm
  const columnFiles = files.filter((_, fileIndex) => fileIndex % columnCount === index);

  return (
    <div
      style={{
        ...style,
        width: columnWidth,
        position: 'absolute',
        left: index * columnWidth,
        top: 0,
        height: 'auto',
        direction
      }}
      className="flex flex-col gap-2 px-1"
    >
      {columnFiles.map((file) => (
        <div key={file.path} className="break-inside-avoid mb-2 w-full">
          <ContextMenu>
            <ContextMenuTrigger>
              <ImageItem
                {...file}
                src={`/api/raw?path=${encodeURIComponent(file.path)}`}
                thumbnail={`/api/thumbnail?path=${encodeURIComponent(file.path)}&width=300&quality=80`}
                alt={file.name}
                onClick={() => onFileClick(file.path, file.mimeType || 'application/octet-stream', file.isDirectory)}
                className={cn(
                  "w-full h-auto rounded-md",
                  isSelecting && selectedFiles.includes(file.path) && "border-2 border-blue-500 bg-blue-500/10 hover:text-black hover:bg-blue-500/20",
                  focusedIndex === files.indexOf(file) && "border-2 border-yellow-500"
                )}
                loading="lazy"
                disablePreview={!useImageQuickPreview}
              />
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onClick={() => onShowDetails(file)}>
                <Info className="mr-2" size={16} />
                Details
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onQuickSelect(file.path)}>
                <Check className="mr-2" size={16} />
                Select
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onRename(file.path)}>
                <Edit className="mr-2" size={16} />
                Rename
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onCopy(file.path)}>
                <ClipboardCopy className="mr-2" size={16} />
                Copy
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onCut(file.path)}>
                <Scissors className="mr-2" size={16} />
                Cut
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onDownload(file.path)}>
                <Download className="mr-2" size={16} />
                Download
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onDelete(file.path)}>
                <Trash2 className="mr-2" size={16} />
                Delete
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        </div>
      ))}
    </div>
  );
});

function getColumnCount(width: number) {
  if (width < 768) return 2; // md
  if (width < 1024) return 4; // lg
  if (width < 1280) return 6; // xl
  return 8; // 2xl and above
}

interface MasonryViewProps {
  height: number;
  width: number;
  files: FileData[];
  selectedFiles: string[];
  isSelecting: boolean;
  focusedIndex: number | null;
  useImageQuickPreview: boolean;
  direction: 'ltr' | 'rtl';
  onFileClick: (path: string, mimeType: string, isDirectory: boolean) => void;
  onCopy: (path: string) => void;
  onCut: (path: string) => void;
  onDownload: (path: string) => void;
  onDelete: (path: string) => void;
  onShowDetails: (file: FileData) => void;
  onQuickSelect: (path: string) => void;
  onRename: (path: string) => void;
  masonryRef: React.RefObject<HTMLDivElement | null>;
}

export const MasonryView = React.memo(({
  height,
  width,
  files,
  selectedFiles,
  isSelecting,
  focusedIndex,
  useImageQuickPreview,
  direction,
  onFileClick,
  onCopy,
  onCut,
  onDownload,
  onDelete,
  onShowDetails,
  onQuickSelect,
  onRename,
  masonryRef
}: MasonryViewProps) => {
  const columnCount = getColumnCount(width);
  const columnWidth = width / columnCount;

  // Array of column indices
  const columns = Array.from({ length: columnCount }, (_, i) => i);

  return (
    <div
      ref={masonryRef}
      style={{ height, width: width + 10, position: 'relative', overflowY: 'auto' }}
      className="custom-scrollbar"
    >
      {columns.map(index => (
        <MasonryCell
          key={index}
          index={index}
          style={{}}
          data={{
            columnCount,
            columnWidth,
            files,
            selectedFiles,
            isSelecting,
            useImageQuickPreview,
            direction,
            onFileClick,
            onCopy,
            onCut,
            onDownload,
            onDelete,
            onShowDetails,
            onQuickSelect,
            onRename,
            focusedIndex
          }}
        />
      ))}
    </div>
  );
});

MasonryView.displayName = 'MasonryView'; 