import React, { useCallback } from 'react';
import { FixedSizeGrid as Grid } from 'react-window';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { FileItemGridView, ImageItem, VideoItem, EPUBItem } from "@/components/fileItem";
import { cn } from "@/lib/utils";
import {
  Info, Check, Edit, ClipboardCopy, Scissors, Download, Trash2, X
} from "lucide-react";
import { FileData } from './types';

interface FileContextMenuProps {
  children: React.ReactNode;
  file: FileData;
  isSelected: boolean;
  onShowDetails: (file: FileData) => void;
  onQuickSelect: (path: string) => void;
  onRename: (path: string) => void;
  onCopy: (path: string) => void;
  onCut: (path: string) => void;
  onDownload: (path: string) => void;
  onDelete: (path: string) => void;
}

const FileContextMenu = React.memo(({ 
  children, 
  file, 
  isSelected,
  onShowDetails, 
  onQuickSelect, 
  onRename, 
  onCopy, 
  onCut, 
  onDownload, 
  onDelete 
}: FileContextMenuProps) => {
  return (
    <ContextMenu>
      <ContextMenuTrigger>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onShowDetails(file)}>
          <Info className="mr-2" size={16} />
          Details
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onQuickSelect(file.path)}>
          {isSelected ? (
            <X className="mr-2" size={16} />
          ) : (
            <Check className="mr-2" size={16} />
          )}
          {isSelected ? 'Deselect' : 'Select'}
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
  );
});

FileContextMenu.displayName = 'FileContextMenu';

interface ImageCellProps {
  columnIndex: number;
  rowIndex: number;
  style: React.CSSProperties;
  data: {
    columnCount: number;
    files: FileData[];
    selectedFiles: string[];
    isSelecting: boolean;
    useImageQuickPreview: boolean;
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

const ImageCell = React.memo(({ columnIndex, rowIndex, style, data }: ImageCellProps) => {
  const { files, selectedFiles, isSelecting, columnCount, useImageQuickPreview, onFileClick, onCopy, onCut, onDownload, onDelete, onShowDetails, onQuickSelect, onRename, focusedIndex } = data;
  const index = rowIndex * columnCount + columnIndex;
  if (index >= files.length) return null;

  const file = files[index];
  const isSelected = isSelecting && selectedFiles.includes(file.path);
  const commonClassName = cn(
    "w-full h-full object-cover rounded-md cursor-pointer",
    isSelected && "border-2 border-blue-500 bg-blue-500/10 hover:text-black hover:bg-blue-500/20",
    focusedIndex === index && "border-2 border-yellow-500"
  );

  if (file.mimeType?.startsWith('image/')) {
    return (
      <div style={style} className="p-1">
        <FileContextMenu
          file={file}
          isSelected={isSelected}
          onShowDetails={onShowDetails}
          onQuickSelect={onQuickSelect}
          onRename={onRename}
          onCopy={onCopy}
          onCut={onCut}
          onDownload={onDownload}
          onDelete={onDelete}
        >
          <ImageItem
            src={`/api/raw?path=${encodeURIComponent(file.path)}`}
            thumbnail={`/api/thumbnail?path=${encodeURIComponent(file.path)}&width=300&quality=80`}
            alt={file.name}
            onClick={() => onFileClick(file.path, file.mimeType || 'application/octet-stream', file.isDirectory)}
            className={commonClassName}
            loading="eager"
            disablePreview={!useImageQuickPreview || isSelecting}
          />
        </FileContextMenu>
      </div>
    );
  } else if (file.mimeType?.startsWith('video/')) {
    return (
      <div style={style} className="p-1">
        <FileContextMenu
          file={file}
          isSelected={isSelected}
          onShowDetails={onShowDetails}
          onQuickSelect={onQuickSelect}
          onRename={onRename}
          onCopy={onCopy}
          onCut={onCut}
          onDownload={onDownload}
          onDelete={onDelete}
        >
          <VideoItem
            alt={file.name}
            thumbnail={`/api/thumbnail?path=${encodeURIComponent(file.path)}&width=300&quality=80`}
            onClick={() => onFileClick(file.path, file.mimeType || 'application/octet-stream', file.isDirectory)}
            className={commonClassName}
            loading="eager"
          />
        </FileContextMenu>
      </div>
    )
  } else if (file.mimeType === 'application/epub') {
    return (
      <div style={style} className="p-1">
        <FileContextMenu
          file={file}
          isSelected={isSelected}
          onShowDetails={onShowDetails}
          onQuickSelect={onQuickSelect}
          onRename={onRename}
          onCopy={onCopy}
          onCut={onCut}
          onDownload={onDownload}
          onDelete={onDelete}
        >
          <EPUBItem
            alt={file.name}
            thumbnail={`/api/thumbnail?path=${encodeURIComponent(file.path)}&width=300&quality=80`}
            onClick={() => onFileClick(file.path, file.mimeType || 'application/octet-stream', file.isDirectory)}
            className={commonClassName}
            loading="eager"
          />
        </FileContextMenu>
      </div>
    );
  } else {
    return (
      <div style={style} className="p-1">
        <FileContextMenu
          file={file}
          isSelected={isSelected}
          onShowDetails={onShowDetails}
          onQuickSelect={onQuickSelect}
          onRename={onRename}
          onCopy={onCopy}
          onCut={onCut}
          onDownload={onDownload}
          onDelete={onDelete}
        >
          <FileItemGridView
            {...file}
            cover={file.cover ? `/api/thumbnail?path=${encodeURIComponent(file.cover)}&width=300&quality=80` : undefined}
            onClick={() => onFileClick(file.path, file.mimeType || 'application/octet-stream', file.isDirectory)}
            className={cn(
              "text-black hover:text-gray-600 hover:bg-accent",
              isSelected && "border-2 border-blue-500 bg-blue-500/10 hover:text-black hover:bg-blue-500/20",
              focusedIndex === index && "border-2 border-yellow-500"
            )}
          />
        </FileContextMenu>
      </div>
    );
  }
});

function getColumnCount(width: number) {
  if (width < 768) return 2; // md
  if (width < 1024) return 4; // lg
  if (width < 1280) return 6; // xl
  return 8; // 2xl and above
}

interface ImageGridViewProps {
  height: number;
  width: number;
  files: FileData[];
  selectedFiles: string[];
  isSelecting: boolean;
  focusedIndex: number | null;
  useImageQuickPreview: boolean;
  token?: string | null;
  onFileClick: (path: string, mimeType: string, isDirectory: boolean) => void;
  onCopy: (path: string) => void;
  onCut: (path: string) => void;
  onDownload: (path: string) => void;
  onDelete: (path: string) => void;
  onShowDetails: (file: FileData) => void;
  onQuickSelect: (path: string) => void;
  onRename: (path: string) => void;
  onScroll: (info: any) => void;
  onItemsRendered: (info: { visibleStartIndex: number; visibleStopIndex: number }) => void;
  imageGridRef: React.RefObject<Grid | null>;
}

export function ImageGridView({
  height,
  width,
  files,
  selectedFiles,
  isSelecting,
  focusedIndex,
  useImageQuickPreview,
  onFileClick,
  onCopy,
  onCut,
  onDownload,
  onDelete,
  onShowDetails,
  onQuickSelect,
  onRename,
  onScroll,
  onItemsRendered,
  imageGridRef
}: ImageGridViewProps) {
  const columnCount = getColumnCount(width);
  const rowCount = Math.ceil(files.length / columnCount);
  const cellWidth = width / columnCount;
  const cellHeight = cellWidth;

  const handleItemsRendered = useCallback(({ visibleRowStartIndex, visibleRowStopIndex }: { visibleRowStartIndex: number; visibleRowStopIndex: number }) => {
    // Convert row indices to item indices for grid layout
    const visibleStartIndex = visibleRowStartIndex * columnCount;
    const visibleStopIndex = (visibleRowStopIndex + 1) * columnCount - 1;
    onItemsRendered({ visibleStartIndex, visibleStopIndex });
  }, [columnCount, onItemsRendered]);

  return (
    <Grid
      ref={imageGridRef}
      height={height}
      width={width + 10}
      columnCount={columnCount}
      rowCount={rowCount}
      columnWidth={cellWidth}
      rowHeight={cellHeight}
      overscanRowCount={10}
      overscanColumnCount={5}
      itemData={{
        columnCount,
        files,
        selectedFiles,
        isSelecting,
        useImageQuickPreview,
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
      className="custom-scrollbar"
      onScroll={onScroll}
      onItemsRendered={handleItemsRendered}
    >
      {ImageCell}
    </Grid>
  );
}

ImageGridView.displayName = 'ImageGridView'; 