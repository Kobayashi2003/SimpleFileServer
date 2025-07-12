import React, { useCallback } from 'react';
import { FixedSizeList as List } from 'react-window';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { FileItemListView } from "@/components/fileItem";
import { cn } from "@/lib/utils";
import {
  Info, Check, Edit, ClipboardCopy, Scissors, Download, Trash2, X
} from "lucide-react";
import { FileData } from './types';

interface FileRowProps {
  index: number;
  style: React.CSSProperties;
  data: {
    files: FileData[];
    selectedFiles: string[];
    isSelecting: boolean;
    isSearching: boolean;
    onFileClick: (path: string, mimeType: string, isDirectory: boolean) => void;
    onCopy: (path: string) => void;
    onCut: (path: string) => void;
    onDownload: (path: string) => void;
    onDelete: (path: string) => void;
    onShowDetails: (file: FileData) => void;
    onQuickSelect: (path: string) => void;
    onRename: (path: string) => void;
    onFocusItem: (index: number) => void;
    focusedIndex: number | null;
  };
}

const FileRow = React.memo(({ index, style, data }: FileRowProps) => {
  const { files, selectedFiles, isSelecting, isSearching, onFileClick, onCopy, onCut, onDownload, onDelete, onShowDetails, onQuickSelect, onRename, onFocusItem, focusedIndex } = data;
  const file = files[index];
  const isFocused = focusedIndex === index;
  const isSelected = isSelecting && selectedFiles.includes(file.path);

  const handleContextMenu = useCallback(() => {
    onFocusItem(index);
  }, [index, onFocusItem]);

  return (
    <div style={style}>
      <ContextMenu>
        <ContextMenuTrigger onContextMenu={handleContextMenu}>
          <FileItemListView
            {...file}
            isSearching={isSearching}
            onClick={() => onFileClick(file.path, file.mimeType || 'application/octet-stream', file.isDirectory)}
            className={cn(
              "text-white hover:text-black hover:bg-accent",
              isSelecting && selectedFiles.includes(file.path) && "border-2 border-blue-500 bg-blue-500/10 hover:text-white hover:bg-blue-500/20",
              isFocused && "border-l-4 border-yellow-500"
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
  );
});

interface ListViewProps {
  height: number;
  width: number;
  files: FileData[];
  selectedFiles: string[];
  isSelecting: boolean;
  isSearching: boolean;
  focusedIndex: number | null;
  onFileClick: (path: string, mimeType: string, isDirectory: boolean) => void;
  onCopy: (path: string) => void;
  onCut: (path: string) => void;
  onDownload: (path: string) => void;
  onDelete: (path: string) => void;
  onShowDetails: (file: FileData) => void;
  onQuickSelect: (path: string) => void;
  onRename: (path: string) => void;
  onFocusItem: (index: number) => void;
  onScroll: (info: any) => void;
  onItemsRendered: (info: { visibleStartIndex: number; visibleStopIndex: number }) => void;
  listRef: React.RefObject<List | null>;
}

export const ListView = React.memo(({
  height,
  width,
  files,
  selectedFiles,
  isSelecting,
  isSearching,
  focusedIndex,
  onFileClick,
  onCopy,
  onCut,
  onDownload,
  onDelete,
  onShowDetails,
  onQuickSelect,
  onRename,
  onFocusItem,
  onScroll,
  onItemsRendered,
  listRef
}: ListViewProps) => {
  const SCROLL_BUFFER = 10;

  const handleItemsRendered = useCallback(({ visibleStartIndex, visibleStopIndex }: { visibleStartIndex: number; visibleStopIndex: number }) => {
    const itemCount = files.length;
    if (visibleStopIndex >= itemCount - SCROLL_BUFFER) {
      onItemsRendered({ visibleStartIndex, visibleStopIndex });
    }
  }, [files.length, onItemsRendered]);

  return (
    <List
      ref={listRef}
      height={height}
      width={width}
      itemCount={files.length}
      itemSize={48}
      overscanCount={20}
      itemData={{
        files,
        selectedFiles,
        isSelecting,
        isSearching,
        onFileClick,
        onCopy,
        onCut,
        onDownload,
        onDelete,
        onShowDetails,
        onQuickSelect,
        onRename,
        onFocusItem,
        focusedIndex
      }}
      className="custom-scrollbar"
      onScroll={onScroll}
      onItemsRendered={handleItemsRendered}
    >
      {FileRow}
    </List>
  );
});

ListView.displayName = 'ListView'; 