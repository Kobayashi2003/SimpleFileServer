import React, { useCallback } from 'react';
import { FixedSizeGrid as Grid } from 'react-window';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { FileItemGridView } from "@/components/fileItem";
import { cn } from "@/lib/utils";
import {
  Info, Check, Edit, ClipboardCopy, Scissors, Download, Trash2, X
} from "lucide-react";
import { FileData } from './types';

interface FileCellProps {
  columnIndex: number;
  rowIndex: number;
  style: React.CSSProperties;
  data: {
    files: FileData[];
    selectedFiles: string[];
    isSelecting: boolean;
    columnCount: number;
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

const FileCell = React.memo(({ columnIndex, rowIndex, style, data }: FileCellProps) => {
  const { files, selectedFiles, isSelecting, columnCount, onFileClick, onCopy, onCut, onDownload, onDelete, onShowDetails, onQuickSelect, onRename, focusedIndex } = data;
  const index = rowIndex * columnCount + columnIndex;
  if (index >= files.length) return null;

  const file = files[index];
  const isFocused = focusedIndex === index;
  const isSelected = isSelecting && selectedFiles.includes(file.path);

  return (
    <div style={style} className="p-1">
      <ContextMenu>
        <ContextMenuTrigger>
          <FileItemGridView
            {...file}
            cover=""
            onClick={() => onFileClick(file.path, file.mimeType || 'application/octet-stream', file.isDirectory)}
            className={cn(
              "text-black hover:text-gray-600 hover:bg-accent",
              isSelected && "border-2 border-blue-500 bg-blue-500/10 hover:text-black hover:bg-blue-500/20",
              isFocused && "border-2 border-yellow-500"
            )}
          />
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
    </div>
  )
});

function getColumnCount(width: number) {
  if (width < 768) return 2; // md
  if (width < 1024) return 4; // lg
  if (width < 1280) return 6; // xl
  return 8; // 2xl and above
}

interface GridViewProps {
  height: number;
  width: number;
  files: FileData[];
  selectedFiles: string[];
  isSelecting: boolean;
  focusedIndex: number | null;
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
  gridRef: React.RefObject<Grid | null>;
}

export const GridView = React.memo(({
  height,
  width,
  files,
  selectedFiles,
  isSelecting,
  focusedIndex,
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
  gridRef
}: GridViewProps) => {
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
      ref={gridRef}
      height={height}
      width={width + 10}
      columnCount={columnCount}
      rowCount={rowCount}
      columnWidth={cellWidth}
      rowHeight={cellHeight}
      overscanRowCount={10}
      overscanColumnCount={5}
      itemData={{
        files,
        selectedFiles,
        isSelecting,
        columnCount,
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
      {FileCell}
    </Grid>
  );
});

GridView.displayName = 'GridView'; 