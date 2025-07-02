"use client";

import "./scrollbar.css";
import { cn, getPreviewType } from "@/lib/utils";
import axios from "axios";
import React, { Suspense, useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { FixedSizeList as List, FixedSizeGrid as Grid } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  List as ListIcon, Grid3x3 as Grid3x3Icon, Image as ImageIcon, Search, ArrowLeft, ArrowUp,
  Download, Upload, Trash2, ClipboardCopy, ClipboardPaste, MoveHorizontal, Database, Eye, 
  MoreHorizontal, TestTube2, LogIn, LogOut, User, Scissors, CircleCheck, CircleX, ArrowLeftRight, 
  RefreshCcw, FolderUp, FolderPlus, CheckCheck, Loader2, Square, Home, X, Menu, MousePointer2
} from "lucide-react";

import { BreadcrumbNav } from "@/components/nav";
import { FloatingButtons, FloatingButton } from "@/components/button";
import { Error, Loading, NotFound } from "@/components/status";
import { ImagePreview, VideoPreview, AudioPreview, TextPreview, ComicPreview, EPUBPreview, PDFPreview } from "@/components/preview";
import {
  ConfirmDialog, DetailsDialog, DownloadDialog, UploadDialog,
  IndexSettingsDialog, WatcherSettingsDialog, LoginDialog, InputDialog
} from "@/components/dialog";
import { DirectionMenu } from "@/components/menu";
import { ListView, GridView, ImageGridView, MasonryView } from "@/components/view";

import { useAuth } from '@/context/auth-context';


interface FileData {
  name: string;
  path: string;
  size: number;
  mtime: string;
  isDirectory: boolean;
  mimeType?: string;
  cover?: string;
}
interface PreviewState {
  isOpen: boolean;
  path: string;
  type: string;
  content?: string;
  currentIndex?: number;
}



function getFileExtension(filename: string) {
  return filename.split('.').pop()?.toLowerCase() || '';
}

function getColumnCount(width: number) {
  if (width < 768) return 2; // md
  if (width < 1024) return 4; // lg
  if (width < 1280) return 6; // xl
  return 8; // 2xl and above
}

function generateUniqueId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return Date.now().toString(36) + Math.random().toString(36).substring(2, 15);
}


const previewSupported: Record<string, boolean> = {
  'image': true,
  'video': true,
  'audio': true,
  'text': true,
  'application': false,
  'pdf': true,
  'epub': true,
  'comic': true,
  'archive': false,
  'other': false,
}



function FileExplorerContent() {
  const { isAuthenticated, isCheckingAuth, username, permissions, logout, token } = useAuth();
  useEffect(() => {
    if (!isAuthenticated && !isCheckingAuth) {
      setIsLoginDialogOpen(true);
    }
  }, [isAuthenticated, isCheckingAuth]);

  const [isLoginDialogOpen, setIsLoginDialogOpen] = useState(false);
  const [showLoadingIndicator, setShowLoadingIndicator] = useState(false);
  const loadingTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

  const [focusedFileIndex, setFocusedFileIndex] = useState<number | null>(null);

  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    // Clean up timer on unmount
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);


  const router = useRouter();
  const searchParams = useSearchParams();

  const [sortBy, setSortBy] = useState<'name' | 'size' | 'date'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [recursiveSearch, setRecursiveSearch] = useState(true);

  const currentPath = searchParams.get('p') || '';
  const searchQuery = searchParams.get('q') || '';
  const isSearching = !!searchQuery;
  const canGoBack = currentPath !== '' || isSearching;


  const [isImageOnlyMode, setIsImageOnlyModeTemp] = useState(false);
  const setIsImageOnlyMode = (mode: boolean) => {
    if (isSearching && mode) {
      // Can't use image-only mode with search
      return;
    }
    setIsImageOnlyModeTemp(mode);
  }
  const isImageOnlyModeRef = useRef(isImageOnlyMode);

  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const isSelectingRef = useRef(isSelecting);

  const [fileToRename, setFileToRename] = useState('');
  const [renameInputDialogOpen, setRenameInputDialogOpen] = useState(false);

  const [mkdirInputDialogOpen, setMkdirInputDialogOpen] = useState(false);

  const [fileToDownload, setFileToDownload] = useState('');
  const [downloadComfirmDialogOpen, setDownloadComfirmDialogOpen] = useState(false);
  const [downloadMultipleDialogOpen, setDownloadMultipleDialogOpen] = useState(false);

  const xhrRefsRef = useRef<Map<string, XMLHttpRequest>>(new Map());
  // States for upload progress tracking
  const [uploadFiles, setUploadFiles] = useState<any[]>([]);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  // States for download progress tracking
  const [downloadFiles, setDownloadFiles] = useState<any[]>([]);
  const [showDownloadDialog, setShowDownloadDialog] = useState(false);

  const [fileToDelete, setFileToDelete] = useState('');
  const [deleteComfirmDialogOpen, setDeleteComfirmDialogOpen] = useState(false);
  const [deleteMultipleDialogOpen, setDeleteMultipleDialogOpen] = useState(false);

  const [filesToClone, setFilesToClone] = useState<string[]>([]);
  const [cloneComfirmDialogOpen, setCloneComfirmDialogOpen] = useState(false);

  const [filesToMove, setFilesToMove] = useState<string[]>([]);
  const [moveComfirmDialogOpen, setMoveComfirmDialogOpen] = useState(false);

  const cloneTimerRef = useRef<NodeJS.Timeout | null>(null);
  const moveTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Automatically clear filesToClone and filesToMove after 5 minutes
  useEffect(() => {
    if (filesToClone.length > 0) {
      cloneTimerRef.current = setTimeout(() => {
        setFilesToClone([]);
      }, 5 * 60 * 1000);
    }

    if (filesToMove.length > 0) {
      moveTimerRef.current = setTimeout(() => {
        setFilesToMove([]);
      }, 5 * 60 * 1000);
    }

    return () => {
      cloneTimerRef.current && clearTimeout(cloneTimerRef.current);
      moveTimerRef.current && clearTimeout(moveTimerRef.current);
    };
  }, [filesToClone, filesToMove]);

  const [fileToShowDetails, setFileToShowDetails] = useState<FileData | null>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);

  const [viewMode, setViewMode] = useState<'list' | 'grid' | 'image'>('list');
  const viewModeRef = useRef(viewMode);

  const [showScrollTop, setShowScrollTop] = useState(false);

  // EXPERIMENTAL FEATURE
  const [gridDirection, setGridDirection] = useState<'ltr' | 'rtl'>('ltr');
  const [useMasonry, setUseMasonry] = useState(false);
  const [showDirectoryCovers, setShowDirectoryCovers] = useState(false);
  const [useImageQuickPreview, setUseImageQuickPreview] = useState(false);
  const [useDirectionMenu, setUseDirectionMenu] = useState(true);
  const [useBlur, setUseBlur] = useState(true);
  const [useDoubleClick, setUseDoubleClick] = useState(true);
  const [doubleClickAction, setDoubleClickAction] = useState<'imageOnly' | 'recursiveSearch' | 'refresh'>('recursiveSearch');

  // EXPERIMENTAL FEATURE FOR FILE INDEXING
  const [useFileIndex, setUseFileIndex] = useState(true);
  const [useFileWatcher, setUseFileWatcher] = useState(true);
  const [showIndexDialog, setShowIndexDialog] = useState(false);
  const [showWatcherDialog, setShowWatcherDialog] = useState(false);

  const listRef = useRef<List>(null);
  const gridRef = useRef<Grid>(null);
  const imageGridRef = useRef<Grid>(null);
  const masonryRef = useRef<HTMLDivElement>(null);
  const activeScrollRef = useRef<any>(null);
  const scrollPosition = useRef(0);
  const navRef = useRef<HTMLDivElement>(null);

  const [preview, setPreview] = useState<PreviewState>({
    isOpen: false,
    path: '',
    type: '',
  });


  // Pagination state
  const [usePagination, setUsePagination] = useState(false);
  const [page, setPage] = useState(1);
  const pageRef = useRef(page);
  const [accumulatedFiles, setAccumulatedFiles] = useState<FileData[]>([]);
  const [isUpdatingAccumulated, setIsUpdatingAccumulated] = useState(false);
  const [totalFiles, setTotalFiles] = useState(0);
  const [hasMoreFiles, setHasMoreFiles] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  // Page size for API requests
  const PAGE_SIZE = 500;
  // Buffer to trigger next page load before reaching the end
  const SCROLL_BUFFER = 10;


  // isChangingPath will be true when navigateTo is called or the browser uses the forward/backward logic,
  // and false when the searchQuery or currentPath triggers the useEffect.
  // **Purpose**: Prevent the operation of canceling ImageOnlyMode from triggering an extra data fetch before the path change.
  const [isChangingPath, setIsChangingPath] = useState(false);


  const { data: filesExplorerData, isLoading: isLoadingData, error: errorData, refetch: refetchData, isRefetching: isRefetchingData } = useQuery({
    queryKey: ['fileExplorer', currentPath, searchQuery, isImageOnlyMode, page, showDirectoryCovers, usePagination, sortBy, sortOrder, recursiveSearch],
    queryFn: async () => {
      if (!isAuthenticated) {
        return { files: [], hasMore: false, total: 0 };
      }

      setIsUpdatingAccumulated(true);

      let response;

      if (isSearching && searchQuery.length > 0) {
        // Search mode
        response = await axios.get('/api/search', {
          params: usePagination ? {
            query: searchQuery,
            dir: currentPath,
            page: page,
            limit: PAGE_SIZE,
            sortBy,
            sortOrder,
            recursive: recursiveSearch ? 'true' : 'false'
          } : {
            query: searchQuery,
            dir: currentPath,
            sortBy,
            sortOrder,
            recursive: recursiveSearch ? 'true' : 'false'
          }
        });
        return {
          files: response.data.results,
          hasMore: response.data.hasMore,
          total: response.data.total || response.data.results?.length || 0
        };
      } else if (isImageOnlyMode) {
        // Image mode
        response = await axios.get('/api/images', {
          params: usePagination ? {
            dir: currentPath,
            page: page,
            limit: PAGE_SIZE,
            sortBy,
            sortOrder,
            recursive: recursiveSearch ? 'true' : 'false'
          } : {
            dir: currentPath,
            sortBy,
            sortOrder,
            recursive: recursiveSearch ? 'true' : 'false'
          }
        });
        return {
          files: response.data.images,
          hasMore: response.data.hasMore,
          total: response.data.total || response.data.images?.length || 0
        };
      } else {
        // Default files mode
        response = await axios.get('/api/files', {
          params: usePagination ? {
            dir: currentPath,
            cover: showDirectoryCovers ? 'true' : 'false',
            page: page,
            limit: PAGE_SIZE,
            sortBy,
            sortOrder
          } : {
            dir: currentPath,
            cover: showDirectoryCovers ? 'true' : 'false',
            sortBy,
            sortOrder
          }
        });
        return {
          files: response.data.files,
          hasMore: response.data.hasMore,
          total: response.data.total || response.data.files?.length || 0
        };
      }
    },
    enabled: isAuthenticated && !isChangingPath,
  });

  // Handle paginated data updates
  useEffect(() => {
    if (!filesExplorerData || isRefetchingData) return;
    // setIsUpdatingAccumulated(true);

    // For paginated views
    if (page === 1) {
      setAccumulatedFiles(filesExplorerData.files || []);
    } else {
      setAccumulatedFiles(prev => [...prev, ...(filesExplorerData.files || [])]);
    }
    setHasMoreFiles(filesExplorerData.hasMore || false);
    setTotalFiles(filesExplorerData.total || filesExplorerData.files?.length || 0);

    // Reset loading flag when data is loaded
    setIsLoadingMore(false);
  }, [filesExplorerData, isRefetchingData, page, currentPath, searchQuery]);

  useEffect(() => {
    if (isUpdatingAccumulated && !isLoadingData && !isRefetchingData) {
      setIsUpdatingAccumulated(false);
    }
  }, [accumulatedFiles, isUpdatingAccumulated, isLoadingData, isRefetchingData])

  const _isLoading = isLoadingData || isRefetchingData || isUpdatingAccumulated || isChangingPath;
  const isLoading = showLoadingIndicator && _isLoading;
  const isError = errorData;
  const isNotFound = !_isLoading && !isError && totalFiles === 0;

  // console.log({ isLoading, _isLoading, isLoadingData, isUpdatingAccumulated, accumulatedFiles, totalFiles })
  // console.log({ isLoading, _isLoading, isImageOnlyMode, isChangingPath, accumulatedFiles, totalFiles })

  // Add a delay before showing loading indicator
  useEffect(() => {
    if (isLoadingData || isRefetchingData) {
      // Set a timer to show loading indicator after 300ms
      loadingTimerRef.current = setTimeout(() => {
        setShowLoadingIndicator(true);
      }, 300);
    } else {
      // Clear timer and hide loading indicator when loading is complete
      if (loadingTimerRef.current) {
        clearTimeout(loadingTimerRef.current);
        loadingTimerRef.current = null;
      }
      setShowLoadingIndicator(false);
    }

    return () => {
      // Clean up timer on unmount
      if (loadingTimerRef.current) {
        clearTimeout(loadingTimerRef.current);
        loadingTimerRef.current = null;
      }
    };
  }, [isLoadingData, isRefetchingData]);



  const { data: previewContent, isLoading: contentLoading, error: contentError, refetch: refetchPreviewContent } = useQuery({
    queryKey: ['fileContent', preview.path],
    queryFn: async () => {
      if (!preview.isOpen || (preview.type !== 'text')) {
        return null;
      }

      try {
        const response = await axios.get(`/api/content`, {
          params: { path: preview.path },
          responseType: 'text'
        });
        return response.data;
      } catch (error: any) {
        if (error.response) {
          return `Error loading file: Server returned ${error.response.status} ${error.response.statusText}`;
        }
        return `Error loading file: ${error.message || 'Unknown error'}`;
      }
    },
    enabled: isAuthenticated && preview.isOpen && (preview.type === 'text'),
    retry: false,
    refetchOnWindowFocus: false
  });



  const navigateTo = (path: string, query: string = '') => {

    if (path === currentPath && query === searchQuery) return;

    if (isImageOnlyMode) {
      setIsImageOnlyMode(false);
    }

    if (isSelecting) {
      setIsSelecting(false);
      setSelectedFiles([]);
    }

    // NOTE: It's not a good idea, but it works
    setIsChangingPath(true);

    setPage(1);

    const params = new URLSearchParams();
    if (path) params.set('p', path);
    if (query) params.set('q', query);
    router.push(`/?${params.toString()}`);
  }

  const goBack = () => {
    if (isSearching) {
      navigateTo(currentPath, '');
      return;
    }

    const pathParts = currentPath.split('/');
    pathParts.pop();
    const newPath = pathParts.join('/');
    navigateTo(newPath, '');
  }

  const goHome = () => {
    if (currentPath === '') {
      router.push('/');
    } else {
      navigateTo('', '');
    }
  }

  const scrollToTop = () => {
    if (viewMode === 'list') {
      listRef.current?.scrollToItem(0, "start");
    } else if (viewMode === 'grid') {
      gridRef.current?.scrollToItem({ columnIndex: 0, rowIndex: 0, align: "start" });
    } else if (viewMode === 'image' && !(isImageOnlyMode && useMasonry)) {
      if (isImageOnlyMode && useMasonry) {
        masonryRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        imageGridRef.current?.scrollToItem({ columnIndex: 0, rowIndex: 0, align: "start" });
      }
    }
    scrollPosition.current = 0;
    setShowScrollTop(false);
  };



  const handleSelectAll = () => {
    setSelectedFiles(accumulatedFiles.map(file => file.path));
  }

  const handleClearSelection = () => {
    setSelectedFiles([]);
  }

  const handleInvertSelection = () => {
    setSelectedFiles(accumulatedFiles.filter(file => !selectedFiles.includes(file.path)).map(file => file.path));
  }

  const handleQuickSelect = useCallback((path: string) => {
    if (!isSelecting) {
      setIsSelecting(true);
    }

    if (selectedFiles.includes(path)) {
      setSelectedFiles(prev => prev.filter(file => file !== path));
    } else {
      setSelectedFiles(prev => [...prev, path]);
    }
  }, [isSelecting, selectedFiles]);



  const openPreview = useCallback((path: string, mimeType: string) => {
    const currentIndex = accumulatedFiles.findIndex(file => file.path === path);
    if (currentIndex === -1) {
      console.error('File not found in accumulatedFiles:', path);
      return;
    }

    setPreview({
      isOpen: true,
      path,
      type: getPreviewType(mimeType),
      currentIndex
    });
  }, [accumulatedFiles]);

  const closePreview = useCallback(() => {
    setPreview({
      isOpen: false,
      path: '',
      type: ''
    });
  }, []);

  const navigatePreview = (direction: 'next' | 'prev') => {
    if (preview.currentIndex === undefined) return;

    if (isImageOnlyMode) {
      if (!accumulatedFiles) return;
      let newIndex;
      if (direction === 'next') {
        newIndex = (preview.currentIndex + 1) % accumulatedFiles.length;
      } else {
        newIndex = (preview.currentIndex - 1 + accumulatedFiles.length) % accumulatedFiles.length;
      }
      openPreview(accumulatedFiles[newIndex].path, accumulatedFiles[newIndex].mimeType || '');
      return;
    }

    const sameTypeFiles = accumulatedFiles.filter(file => {
      const previewType = getPreviewType(file.mimeType || '');
      return previewType === preview.type;
    });
    if (sameTypeFiles.length <= 1) return;
    const currentIndex = sameTypeFiles.findIndex(file => file.path === preview.path);

    let newIndex;
    if (direction === 'next') {
      newIndex = (currentIndex + 1) % sameTypeFiles.length;
    } else {
      newIndex = (currentIndex - 1 + sameTypeFiles.length) % sameTypeFiles.length;
    }

    openPreview(sameTypeFiles[newIndex].path, sameTypeFiles[newIndex].mimeType || '');
  }

  const handleFileClick = useCallback((path: string, mimeType: string, isDirectory: boolean) => {
    console.log("Handling file click for", { path, mimeType, isDirectory });

    if (isSelecting) {
      if (selectedFiles.includes(path)) {
        console.log("Removing file from selected files", path);
        setSelectedFiles(prev => prev.filter(file => file !== path));
      } else {
        console.log("Adding file to selected files", path);
        setSelectedFiles(prev => [...prev, path]);
      }
      return;
    }

    if (isDirectory) {
      navigateTo(path, '');
    } else {
      if (previewSupported[getPreviewType(mimeType)]) {
        openPreview(path, mimeType);
      } else {
        setFileToDownload(path);
        setDownloadComfirmDialogOpen(true);
      }
    }
  }, [openPreview, isSelecting, selectedFiles]);




  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (isImageOnlyMode) {
      setIsImageOnlyMode(false);
    }
    const formData = new FormData(e.target as HTMLFormElement);
    const query = formData.get('searchQuery') as string;
    navigateTo(currentPath, query);
  }

  const handleClearSearch = () => {
    if (isSearching) {
      navigateTo(currentPath, '');
    }
  }



  const handleShowDetails = useCallback((file: FileData) => {
    setFileToShowDetails(file);
    setDetailsDialogOpen(true);
  }, []);



  const handleUpload = async () => {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true; // Allow multiple file selection

    fileInput.onchange = async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (!files || files.length === 0) return;

      // Prepare files for tracking
      const uploadList = Array.from(files).map(file => ({
        id: generateUniqueId(),
        name: file.name,
        size: file.size,
        progress: 0,
        status: 'pending' as const,
        file: file
      }));

      // Add files to tracking state
      setUploadFiles(uploadList);
      setShowUploadDialog(true);

      // Process each file upload
      for (const fileData of uploadList) {
        await new Promise<void>((resolve) => {
          const xhr = new XMLHttpRequest();

          // Store the XHR reference in our Map
          xhrRefsRef.current.set(fileData.id, xhr);

          const formData = new FormData();
          formData.append('files', fileData.file);

          // Update file status to uploading
          setUploadFiles(prev => prev.map(f =>
            f.id === fileData.id ? { ...f, status: 'uploading' } : f
          ));

          // Setup progress handler
          xhr.upload.addEventListener('progress', (event) => {
            if (event.lengthComputable) {
              const progress = Math.round((event.loaded / event.total) * 100);

              setUploadFiles(prev => prev.map(f =>
                f.id === fileData.id ? { ...f, progress } : f
              ));
            }
          });

          // Handle completion
          xhr.addEventListener('load', () => {
            // Remove XHR reference
            xhrRefsRef.current.delete(fileData.id);

            if (xhr.status >= 200 && xhr.status < 300) {
              setUploadFiles(prev => prev.map(f =>
                f.id === fileData.id ? { ...f, progress: 100, status: 'completed' } : f
              ));

              // Refresh file list
              refetchData();
            } else {
              setUploadFiles(prev => prev.map(f =>
                f.id === fileData.id ? {
                  ...f,
                  status: 'error',
                  error: `Error: ${xhr.status} ${xhr.statusText}`
                } : f
              ));
            }
            resolve();
          });

          // Handle errors
          xhr.addEventListener('error', () => {
            // Remove XHR reference
            xhrRefsRef.current.delete(fileData.id);

            setUploadFiles(prev => prev.map(f =>
              f.id === fileData.id ? {
                ...f,
                status: 'error',
                error: 'Network error occurred'
              } : f
            ));
            resolve();
          });

          // Handle abort event
          xhr.addEventListener('abort', () => {
            // Remove XHR reference
            xhrRefsRef.current.delete(fileData.id);

            setUploadFiles(prev => prev.map(f =>
              f.id === fileData.id ? {
                ...f,
                status: 'error',
                error: 'Upload cancelled'
              } : f
            ));
            resolve();
          });

          // Start upload
          xhr.open('POST', `/api/upload?dir=${encodeURIComponent(currentPath)}${token ? `&token=${token}` : ''}`);
          xhr.send(formData);
        });
      }
    };

    fileInput.click();
  }

  const handleFolderUpload = async () => {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    // Set directory selection attributes
    // TypeScript doesn't recognize webkitdirectory by default
    (fileInput as any).webkitdirectory = true;
    (fileInput as any).directory = true; // For Firefox compatibility

    fileInput.onchange = async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (!files || files.length === 0) return;

      // Prepare files for tracking with proper typing
      const uploadList = Array.from(files).map(file => {
        // Use webkitRelativePath for folder structure path if available
        const relativePath = (file as any).webkitRelativePath || file.name;

        return {
          id: generateUniqueId(),
          name: relativePath,
          size: file.size,
          progress: 0,
          status: 'pending' as const,
          file: file
        };
      });

      // Add files to tracking state
      setUploadFiles(uploadList);
      setShowUploadDialog(true);

      // Process each file upload
      for (const fileData of uploadList) {
        await new Promise<void>((resolve) => {
          const xhr = new XMLHttpRequest();

          // Store the XHR reference in our Map
          xhrRefsRef.current.set(fileData.id, xhr);

          const formData = new FormData();
          formData.append('files', fileData.file);

          // Update file status to uploading
          setUploadFiles(prev => prev.map(f =>
            f.id === fileData.id ? { ...f, status: 'uploading' } : f
          ));

          // Setup progress handler
          xhr.upload.addEventListener('progress', (event) => {
            if (event.lengthComputable) {
              const progress = Math.round((event.loaded / event.total) * 100);

              setUploadFiles(prev => prev.map(f =>
                f.id === fileData.id ? { ...f, progress } : f
              ));
            }
          });

          // Handle completion
          xhr.addEventListener('load', () => {
            // Remove XHR reference
            xhrRefsRef.current.delete(fileData.id);

            if (xhr.status >= 200 && xhr.status < 300) {
              setUploadFiles(prev => prev.map(f =>
                f.id === fileData.id ? { ...f, progress: 100, status: 'completed' } : f
              ));

              // Refresh file list
              refetchData();
            } else {
              setUploadFiles(prev => prev.map(f =>
                f.id === fileData.id ? {
                  ...f,
                  status: 'error',
                  error: `Error: ${xhr.status} ${xhr.statusText}`
                } : f
              ));
            }
            resolve();
          });

          // Handle errors
          xhr.addEventListener('error', () => {
            // Remove XHR reference
            xhrRefsRef.current.delete(fileData.id);

            setUploadFiles(prev => prev.map(f =>
              f.id === fileData.id ? {
                ...f,
                status: 'error',
                error: 'Network error occurred'
              } : f
            ));
            resolve();
          });

          // Handle abort event
          xhr.addEventListener('abort', () => {
            // Remove XHR reference
            xhrRefsRef.current.delete(fileData.id);

            setUploadFiles(prev => prev.map(f =>
              f.id === fileData.id ? {
                ...f,
                status: 'error',
                error: 'Upload cancelled'
              } : f
            ));
            resolve();
          });

          // Start upload
          xhr.open('POST', `/api/upload-folder?dir=${encodeURIComponent(currentPath)}${token ? `&token=${token}` : ''}`);
          xhr.send(formData);
        });
      }
    };

    fileInput.click();
  }

  const cancelUpload = (fileId: string) => {
    const xhr = xhrRefsRef.current.get(fileId);
    if (xhr) {
      // Actually abort the XHR request
      xhr.abort();
      // UI state will be updated by the abort event handler
    } else {
      // If XHR not found (already completed or never started), just update the UI
      setUploadFiles(prev => prev.map(f =>
        f.id === fileId ? { ...f, status: 'error', error: 'Cancelled by user' } : f
      ));
    }
  };

  const cancelAllUploads = () => {
    // Abort all pending XHR requests
    uploadFiles.forEach(file => {
      if (file.status === 'pending' || file.status === 'uploading') {
        const xhr = xhrRefsRef.current.get(file.id);
        if (xhr) {
          xhr.abort();
        }
      }
    });

    // Update UI for any uploads that didn't have XHR references
    setUploadFiles(prev => prev.map(f =>
      f.status === 'pending' || f.status === 'uploading'
        ? { ...f, status: 'error', error: 'Cancelled by user' }
        : f
    ));
  };

  const removeUploadTask = (fileId: string) => {
    setUploadFiles(prev => prev.filter(f => f.id !== fileId));
  };



  const handleDownload = useCallback((path: string) => {
    const filename = path.split('/').pop() || 'download';

    // Create a download entry
    // const downloadId = crypto.randomUUID();
    const downloadId = generateUniqueId();
    const newDownload = {
      id: downloadId,
      name: filename,
      path: path,
      progress: 0,
      size: 0, // We'll update this when we get the response
      status: 'pending' as const
    };

    // Add to download list
    setDownloadFiles(prev => [...prev, newDownload]);
    setShowDownloadDialog(true);

    // Start download with XHR to track progress
    const xhr = new XMLHttpRequest();

    // Store XHR reference for cancellation
    xhrRefsRef.current.set(downloadId, xhr);

    xhr.open('GET', `/api/raw?path=${encodeURIComponent(path)}${token ? `&token=${token}` : ''}`);
    xhr.responseType = 'blob';

    // Update status to downloading
    setDownloadFiles(prev => prev.map(f =>
      f.id === downloadId ? { ...f, status: 'downloading' } : f
    ));

    // Track progress
    xhr.onprogress = (event) => {
      if (event.lengthComputable) {
        const progress = Math.round((event.loaded / event.total) * 100);
        const size = event.total;

        setDownloadFiles(prev => prev.map(f =>
          f.id === downloadId ? { ...f, progress, size } : f
        ));
      }
    };

    // Handle completion
    xhr.onload = () => {
      // Remove XHR reference
      xhrRefsRef.current.delete(downloadId);

      if (xhr.status === 200) {
        // Create download link
        const blob = xhr.response;
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);

        // Update status
        setDownloadFiles(prev => prev.map(f =>
          f.id === downloadId ? { ...f, progress: 100, status: 'completed' } : f
        ));
      } else {
        setDownloadFiles(prev => prev.map(f =>
          f.id === downloadId ? {
            ...f,
            status: 'error',
            error: `Error: ${xhr.status} ${xhr.statusText}`
          } : f
        ));
      }
    };

    // Handle errors
    xhr.onerror = () => {
      // Remove XHR reference
      xhrRefsRef.current.delete(downloadId);

      setDownloadFiles(prev => prev.map(f =>
        f.id === downloadId ? {
          ...f,
          status: 'error',
          error: 'Network error occurred'
        } : f
      ));
    };

    // Handle abort event
    xhr.onabort = () => {
      // Remove XHR reference
      xhrRefsRef.current.delete(downloadId);

      setDownloadFiles(prev => prev.map(f =>
        f.id === downloadId ? {
          ...f,
          status: 'error',
          error: 'Download cancelled'
        } : f
      ));
    };

    xhr.send();
  }, []);

  const handleDownloadMultiple = useCallback((paths: string[]) => {
    // This version will send a request to the backend's download endpoint,
    // and the final download will be a zip file.

    // TODO: Implement this version
  }, []);

  const handleDownloadMultiple2 = useCallback((paths: string[]) => {
    if (paths.length === 0) return;
    paths.forEach(path => {
      handleDownload(path);
    });
  }, []);

  const cancelDownload = (fileId: string) => {
    const xhr = xhrRefsRef.current.get(fileId);
    if (xhr) {
      // Actually abort the XHR request
      xhr.abort();
      // UI state will be updated by the abort event handler
    } else {
      // If XHR not found (already completed or never started), just update the UI
      setDownloadFiles(prev => prev.map(f =>
        f.id === fileId ? { ...f, status: 'error', error: 'Cancelled by user' } : f
      ));
    }
  };

  const cancelAllDownloads = () => {
    // Abort all pending XHR requests
    downloadFiles.forEach(file => {
      if (file.status === 'pending' || file.status === 'downloading') {
        const xhr = xhrRefsRef.current.get(file.id);
        if (xhr) {
          xhr.abort();
        }
      }
    });

    // Update UI for any downloads that didn't have XHR references
    setDownloadFiles(prev => prev.map(f =>
      f.status === 'pending' || f.status === 'downloading'
        ? { ...f, status: 'error', error: 'Cancelled by user' }
        : f
    ));
  };

  const removeDownloadTask = (fileId: string) => {
    setDownloadFiles(prev => prev.filter(f => f.id !== fileId));
  };



  const handleRename = useCallback((path: string) => {
    setFileToRename(path);
    setRenameInputDialogOpen(true);
  }, []);

  const handleRenameConfirm = useCallback((newName: string) => {
    fetch(`/api/rename?path=${encodeURIComponent(fileToRename)}&newName=${encodeURIComponent(newName)}${token ? `&token=${token}` : ''}`, {
      method: 'POST',
    }).then(() => {
      refetchData();
      setRenameInputDialogOpen(false);
    }).catch((error) => {
      console.error('Error renaming file:', error);
    });
  }, [token, refetchData, fileToRename]);

  const handleRenameCancel = useCallback(() => {
    setRenameInputDialogOpen(false);
  }, []);



  const handleMkdir = useCallback(() => {
    setMkdirInputDialogOpen(true);
  }, []);

  const handleMkdirConfirm = useCallback((path: string, name: string) => {
    fetch(`/api/mkdir?path=${encodeURIComponent(path)}&name=${encodeURIComponent(name)}${token ? `&token=${token}` : ''}`, {
      method: 'POST',
    }).then(() => {
      refetchData();
      setMkdirInputDialogOpen(false);
    }).catch((error) => {
      console.error('Error creating directory:', error);
    });
  }, [token, refetchData]);

  const handleMkdirCancel = useCallback(() => {
    setMkdirInputDialogOpen(false);
  }, []);



  const handleDelete = useCallback((path: string) => {
    setFileToDelete(path);
    setDeleteComfirmDialogOpen(true);
  }, []);

  const handleDeleteConfirm = useCallback((path: string) => {
    fetch(`/api/delete?path=${encodeURIComponent(path)}${token ? `&token=${token}` : ''}`, {
      method: 'DELETE',
    }).then(() => {
      setFileToDelete('');
      setDeleteComfirmDialogOpen(false);
      refetchData();
    }).catch((error) => {
      console.error('Error deleting file:', error);
    });
  }, [token, refetchData]);

  const handleDeleteCancel = useCallback(() => {
    setFileToDelete('');
    setDeleteComfirmDialogOpen(false);
  }, []);

  const handleDeleteMultiple = useCallback((paths: string[]) => {
    setDeleteMultipleDialogOpen(true);
  }, []);

  const handleDeleteMultipleConfirm = useCallback((paths: string[]) => {
    fetch(`/api/delete?paths=${encodeURIComponent(paths.join('|'))}${token ? `&token=${token}` : ''}`, {
      method: 'DELETE',
    }).then(() => {
      setSelectedFiles([]);
      setIsSelecting(false);
      setDeleteMultipleDialogOpen(false);
      refetchData();
    }).catch((error) => {
      console.error('Error deleting files:', error);
    });
  }, [token, refetchData]);

  const handleDeleteMultipleCancel = useCallback(() => {
    setDeleteMultipleDialogOpen(false);
  }, []);



  const handleCopy = useCallback((path: string) => {
    setFilesToClone([path]);
  }, []);

  const handleCopyMultiple = useCallback((paths: string[]) => {
    setFilesToClone(paths);
  }, []);

  const handlePasteConfirm = useCallback((destinationPath: string) => {
    cloneTimerRef.current && clearTimeout(cloneTimerRef.current);
    fetch(`/api/clone${token ? `?token=${token}` : ''}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sources: filesToClone,
        destination: destinationPath
      })
    }).then(() => {
      setCloneComfirmDialogOpen(false);
      setFilesToClone([]);
      refetchData();
    }).catch((error) => {
      console.error('Error pasting files:', error);
    });
  }, [filesToClone, token, refetchData]);

  const handlePasteCancel = useCallback(() => {
    setCloneComfirmDialogOpen(false);
  }, []);



  const handleMoveFrom = useCallback((path: string) => {
    setFilesToMove([path]);
  }, []);

  const handleMoveFromMultiple = useCallback((paths: string[]) => {
    setFilesToMove(paths);
  }, []);

  const handleMoveHereComfirm = useCallback((destinationPath: string) => {
    moveTimerRef.current && clearTimeout(moveTimerRef.current);
    fetch(`/api/move${token ? `?token=${token}` : ''}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sources: filesToMove,
        destination: destinationPath
      })
    }).then(() => {
      setMoveComfirmDialogOpen(false);
      setFilesToMove([]);
      refetchData();
    }).catch((error) => {
      console.error('Error moving files:', error);
    });
  }, [filesToMove, token, refetchData]);

  const handleMoveHereCancel = useCallback(() => {
    setMoveComfirmDialogOpen(false)
  }, []);



  const handleVirtualizedScroll = ({ scrollOffset, scrollTop }: any) => {
    const currentScroll = scrollTop ?? scrollOffset ?? 0;
    scrollPosition.current = currentScroll;
    setShowScrollTop(currentScroll > 100);

    // For lists and grids we rely on onItemsRendered instead
  };

  const loadNextPage = useCallback(() => {
    if (!usePagination || isLoadingMore || !hasMoreFiles) return;

    setIsLoadingMore(true);
    setPage(prevPage => prevPage + 1);
  }, [isLoadingMore, hasMoreFiles, usePagination]);

  // Handle end of list detection to load more data
  const handleItemsRendered = useCallback(({ visibleStartIndex, visibleStopIndex }: { visibleStartIndex: number, visibleStopIndex: number }) => {
    const itemCount = accumulatedFiles.length;
    if (!isLoadingMore && hasMoreFiles && visibleStopIndex >= itemCount - SCROLL_BUFFER) {
      loadNextPage();
    }
  }, [accumulatedFiles.length, isLoadingMore, hasMoreFiles, loadNextPage]);



  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  useEffect(() => {
    isSelectingRef.current = isSelecting;
  }, [isSelecting]);

  useEffect(() => {
    pageRef.current = page;
  }, [page]);

  useEffect(() => {
    switch (viewMode) {
      case 'list':
        activeScrollRef.current = listRef.current;
        break;
      case 'grid':
        activeScrollRef.current = gridRef.current;
        break;
      case 'image':
        if (isImageOnlyMode && useMasonry) {
          activeScrollRef.current = masonryRef.current;
        } else {
          activeScrollRef.current = imageGridRef.current;
        }
        break;
      default:
        activeScrollRef.current = null;
    }
  }, [viewMode, isImageOnlyMode, useMasonry]);


  useEffect(() => {
    const originalPushState = history.pushState.bind(history);
    const originalReplaceState = history.replaceState.bind(history);

    // Override pushState method
    history.pushState = function (data: any, unused: string, url?: string | URL | null) {
      // Use ref instead of state directly
      if (isImageOnlyModeRef.current) {
        // Use setTimeout to move state update to next event loop
        setTimeout(() => {
          setIsChangingPath(true);
          setIsImageOnlyMode(false);
        }, 0);
      }
      if (isSelectingRef.current) {
        setTimeout(() => {
          setIsSelecting(false);
          setSelectedFiles([]);
        }, 0);
      }
      if (pageRef.current !== 1) {
        setPage(1);
      }
      return originalPushState(data, unused, url);
    };

    // Override replaceState method
    history.replaceState = function (data: any, unused: string, url?: string | URL | null) {
      // Use ref instead of state directly
      if (isImageOnlyModeRef.current) {
        // Use setTimeout to move state update to next event loop
        setTimeout(() => {
          setIsChangingPath(true);
          setIsImageOnlyMode(false);
        }, 0);
      }
      if (isSelectingRef.current) {
        setTimeout(() => {
          setIsSelecting(false);
          setSelectedFiles([]);
        }, 0);
      }
      if (pageRef.current !== 1) {
        setPage(1);
      }
      return originalReplaceState(data, unused, url);
    };

    return () => {
      // Restore original methods
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;
    };
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      if (isImageOnlyMode) {
        setIsChangingPath(true);
        setIsImageOnlyMode(false);
      }
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [isImageOnlyMode]);

  useEffect(() => {
    const handlePopState = () => {
      if (isSelectingRef.current) {
        setIsSelecting(false);
        setSelectedFiles([]);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [isSelecting]);

  useEffect(() => {
    const handlePopState = () => {
      if (pageRef.current !== 1) {
        setPage(1);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [page])


  // add a manual scroll listener for masonry view, since it doesn't use react-window
  useEffect(() => {
    if (isImageOnlyMode && useMasonry && viewMode === 'image' && masonryRef.current) {
      const masonryElement = masonryRef.current;

      const handleMasonryScroll = () => {
        const scrollTop = masonryElement.scrollTop;
        const scrollHeight = masonryElement.scrollHeight;
        const clientHeight = masonryElement.clientHeight;

        scrollPosition.current = scrollTop;
        setShowScrollTop(scrollTop > 100);

        // Check if scrolled near the bottom (with 200px buffer)
        const scrollBuffer = 200;
        console.log(isLoadingMore, hasMoreFiles, scrollTop + clientHeight, scrollHeight - scrollBuffer);
        if (!isLoadingMore && hasMoreFiles && scrollTop + clientHeight >= scrollHeight - scrollBuffer) {
          loadNextPage();
        }
      };

      masonryElement.addEventListener('scroll', handleMasonryScroll);
      return () => {
        masonryElement.removeEventListener('scroll', handleMasonryScroll);
      };
    }
  }, [isImageOnlyMode, useMasonry, viewMode, isLoadingMore, hasMoreFiles, loadNextPage]);

  useEffect(() => {
    closePreview();
    setFocusedFileIndex(null);
  }, [currentPath, searchQuery])

  useEffect(() => {
    if (isChangingPath) {
      setIsChangingPath(false);
    }
  }, [currentPath, searchQuery, isChangingPath])


  // Add this function before the keyboard handler useEffect
  const scrollToFocusedItem = useCallback((index: number) => {
    if (index < 0 || index >= accumulatedFiles.length) return;

    if (viewMode === 'list') {
      listRef.current?.scrollToItem(index, "center");
    } else if (viewMode === 'grid') {
      const columnCount = getColumnCount(window.innerWidth);
      const rowIndex = Math.floor(index / columnCount);
      const columnIndex = index % columnCount;
      gridRef.current?.scrollToItem({ columnIndex, rowIndex, align: "center" });
    } else if (viewMode === 'image') {
      if (isImageOnlyMode && useMasonry) {
        // Masonry view doesn't support scrollToItem, we'd need a more complex solution
        // For now, we just highlight the item without scrolling
      } else {
        const columnCount = getColumnCount(window.innerWidth);
        const rowIndex = Math.floor(index / columnCount);
        const columnIndex = index % columnCount;
        imageGridRef.current?.scrollToItem({ columnIndex, rowIndex, align: "center" });
      }
    }
  }, [viewMode, accumulatedFiles.length, isImageOnlyMode, useMasonry]);

  // Keyboard shortcuts handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // When preview is open, don't handle keyboard shortcuts
      if (preview.isOpen) return;

      // When input is focused, don't handle keyboard shortcuts
      if (e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement) return;

      switch (e.key.toLowerCase()) {
        case 'l': // List view
          setViewMode('list');
          break;
        case 'g': // Grid view
          setViewMode('grid');
          break;
        case 'i': // Image view
          if (e.shiftKey) { // Shift+I switch to image only mode
            if (!isSearching) {
              setIsImageOnlyMode(!isImageOnlyMode);
            }
          } else {
            setViewMode('image');
          }
          break;

        case 'escape': // Exit selection mode
          if (isSelecting) {
            setIsSelecting(false);
            setSelectedFiles([]);
          } else {
            setFocusedFileIndex(null);
          }
          break;
        case 's': // Toggle selection mode
          setIsSelecting(!isSelecting);
          break;
        case 'a': // Select all files (using Ctrl/Cmd)
          if ((e.ctrlKey || e.metaKey) && isSelecting) {
            e.preventDefault();
            handleSelectAll();
          }
          break;
        case 'c': // Clear selection or copy (using Ctrl/Cmd)
          if ((e.ctrlKey || e.metaKey) && isSelecting) {
            if (selectedFiles.length > 0) {
              e.preventDefault();
              handleCopyMultiple(selectedFiles);
            }
          } else if (isSelecting) {
            handleClearSelection();
          }
          break;
        case 'x': // Cut selected files (using Ctrl/Cmd)
          if ((e.ctrlKey || e.metaKey) && isSelecting && selectedFiles.length > 0) {
            e.preventDefault();
            handleMoveFromMultiple(selectedFiles);
          }
          break;
        case 'v': // Paste file (using Ctrl/Cmd)
          if ((e.ctrlKey || e.metaKey) && filesToClone.length > 0) {
            e.preventDefault();
            setCloneComfirmDialogOpen(true);
          } else if ((e.ctrlKey || e.metaKey) && filesToMove.length > 0) {
            e.preventDefault();
            setMoveComfirmDialogOpen(true);
          }
          break;
        case 'd': // download selected files
          if (isSelecting && selectedFiles.length > 0) {
            e.preventDefault();
            handleDownloadMultiple2(selectedFiles);
          } else if (focusedFileIndex !== null && accumulatedFiles[focusedFileIndex]) {
            e.preventDefault();
            handleDownload(accumulatedFiles[focusedFileIndex].path);
          }
          break;
        case 'delete': // Delete selected files
          if (selectedFiles.length > 0) {
            handleDeleteMultiple(selectedFiles);
          } else if (focusedFileIndex !== null && accumulatedFiles[focusedFileIndex]) {
            handleDelete(accumulatedFiles[focusedFileIndex].path);
          }
          break;

        case 'h': // Go home
          goHome();
          break;
        case 'b': // Go back
          if (canGoBack) {
            goBack();
          }
          break;
        case 'r': // Refresh file list
          refetchData();
          break;
        case 'u': // Upload file
          handleUpload();
          break;

        case '/': // Focus search
          e.preventDefault();
          const searchInput = document.querySelector('input[name="searchQuery"]') as HTMLInputElement;
          if (searchInput) {
            searchInput.focus();
          }
          break;
        case 'f': // Focus search (using Ctrl/Cmd)
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const searchInput = document.querySelector('input[name="searchQuery"]') as HTMLInputElement;
            if (searchInput) {
              searchInput.focus();
            }
          }
          break;

        case 'arrowup': // Navigate up
          e.preventDefault(); // Prevent page scroll
          if (focusedFileIndex !== null) {
            let newIndex;
            if (viewMode === 'list') {
              // List view: Simply move to the previous item
              // newIndex = (focusedFileIndex - 1 + accumulatedFiles.length) % accumulatedFiles.length;
              if (focusedFileIndex > 0) {
                newIndex = focusedFileIndex - 1;
              } else {
                newIndex = focusedFileIndex;
              }
            } else {
              // Grid view: Move to the previous row in the same column
              // NOTE: BUG here, when the window width is changed, the columnCount is not updated, so the newIndex is not correct
              const columnCount = getColumnCount(window.innerWidth);
              if (focusedFileIndex >= columnCount) {
                newIndex = focusedFileIndex - columnCount;
              } else {
                newIndex = focusedFileIndex;
              }
            }
            setFocusedFileIndex(newIndex);
            scrollToFocusedItem(newIndex);
          } else if (focusedFileIndex === null && accumulatedFiles.length > 0) {
            // setFocusedFileIndex(0);
            // scrollToFocusedItem(0);
            setFocusedFileIndex(accumulatedFiles.length - 1);
            scrollToFocusedItem(accumulatedFiles.length - 1);
          }
          break;
        case 'arrowdown': // Navigation through files
          e.preventDefault(); // Prevent page scroll
          if (focusedFileIndex !== null) {
            let newIndex;
            if (viewMode === 'list') {
              // List view: Simply move to the next item
              // newIndex = (focusedFileIndex + 1) % accumulatedFiles.length;
              if (focusedFileIndex < accumulatedFiles.length - 1) {
                newIndex = focusedFileIndex + 1;
              } else {
                newIndex = focusedFileIndex;
              }
            } else {
              // Grid view: Move to the next row in the same column
              // NOTE: BUG here, when the window width is changed, the columnCount is not updated, so the newIndex is not correct
              const columnCount = getColumnCount(window.innerWidth);
              const nextRowIndex = focusedFileIndex + columnCount;
              if (nextRowIndex < accumulatedFiles.length) {
                newIndex = nextRowIndex;
              } else {
                newIndex = focusedFileIndex;
              }
            }
            setFocusedFileIndex(newIndex);
            scrollToFocusedItem(newIndex);
          } else if (focusedFileIndex === null && accumulatedFiles.length > 0) {
            setFocusedFileIndex(0);
            scrollToFocusedItem(0);
          }
          break;
        case 'arrowleft': // Navigate left (only for grid view)
          if ((viewMode === 'grid' || viewMode === 'image') && focusedFileIndex !== null && focusedFileIndex > 0) {
            e.preventDefault();
            const newIndex = focusedFileIndex - 1;
            setFocusedFileIndex(newIndex);
            scrollToFocusedItem(newIndex);
          }
          break;
        case 'arrowright': // Navigate right (only for grid view)
          if ((viewMode === 'grid' || viewMode === 'image') && focusedFileIndex !== null && focusedFileIndex < accumulatedFiles.length - 1) {
            e.preventDefault();
            const newIndex = focusedFileIndex + 1;
            setFocusedFileIndex(newIndex);
            scrollToFocusedItem(newIndex);
          }
          break;

        case 'enter': // Open focused file
          if (focusedFileIndex !== null && accumulatedFiles[focusedFileIndex]) {
            const file = accumulatedFiles[focusedFileIndex];
            handleFileClick(file.path, file.mimeType || 'application/octet-stream', file.isDirectory);
          }
          break;
        case ' ': // Use space to quick select
          if (focusedFileIndex !== null && accumulatedFiles[focusedFileIndex]) {
            e.preventDefault(); // Prevent page scroll
            if (isSelecting) {
              handleQuickSelect(accumulatedFiles[focusedFileIndex].path);
            } else {
              handleFileClick(accumulatedFiles[focusedFileIndex].path, accumulatedFiles[focusedFileIndex].mimeType || 'application/octet-stream', accumulatedFiles[focusedFileIndex].isDirectory);
            }
          }
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    preview.isOpen,
    viewMode,
    isSelecting,
    selectedFiles,
    isImageOnlyMode,
    isSearching,
    canGoBack,
    filesToClone,
    filesToMove,
    focusedFileIndex,
    accumulatedFiles,
    handleQuickSelect,
    handleSelectAll,
    handleClearSelection,
    handleCopyMultiple,
    handleMoveFromMultiple,
    handleDeleteMultiple,
    handleDelete,
    refetchData,
    goHome,
    goBack,
    scrollToFocusedItem,
  ]);


  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    console.log('handleDragEnter');
    e.preventDefault();
    e.stopPropagation();

    dragCounterRef.current++;

    // if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    console.log('handleDragLeave');
    e.preventDefault();
    e.stopPropagation();

    dragCounterRef.current--;

    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    console.log('handleDragOver');
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    console.log('handleDrop');
    e.preventDefault();
    e.stopPropagation();

    setIsDragging(false);
    dragCounterRef.current = 0;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const items = e.dataTransfer.items;
      let containsFolder = false;

      if (items) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i].webkitGetAsEntry?.();
          if (item && item.isDirectory) {
            containsFolder = true;
            break;
          }
        }
      }

      const uploadList = Array.from(e.dataTransfer.files).map(file => ({
        id: generateUniqueId(),
        name: file.name,
        size: file.size,
        progress: 0,
        status: 'pending' as const,
        file: file
      }));

      setUploadFiles(uploadList);
      setShowUploadDialog(true);

      uploadList.forEach(async (fileData) => {
        const xhr = new XMLHttpRequest();

        xhrRefsRef.current.set(fileData.id, xhr);

        const formData = new FormData();
        formData.append('files', fileData.file);

        setUploadFiles(prev => prev.map(f =>
          f.id === fileData.id ? { ...f, status: 'uploading' } : f
        ));

        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            const progress = Math.round((event.loaded / event.total) * 100);

            setUploadFiles(prev => prev.map(f =>
              f.id === fileData.id ? { ...f, progress } : f
            ));
          }
        });

        xhr.addEventListener('load', () => {
          xhrRefsRef.current.delete(fileData.id);

          if (xhr.status >= 200 && xhr.status < 300) {
            setUploadFiles(prev => prev.map(f =>
              f.id === fileData.id ? { ...f, progress: 100, status: 'completed' } : f
            ));

            refetchData();
          } else {
            setUploadFiles(prev => prev.map(f =>
              f.id === fileData.id ? {
                ...f,
                status: 'error',
                error: `Error: ${xhr.status} ${xhr.statusText}`
              } : f
            ));
          }
        });

        xhr.addEventListener('error', () => {
          xhrRefsRef.current.delete(fileData.id);

          setUploadFiles(prev => prev.map(f =>
            f.id === fileData.id ? {
              ...f,
              status: 'error',
              error: 'Network error occurred'
            } : f
          ));
        });

        xhr.addEventListener('abort', () => {
          xhrRefsRef.current.delete(fileData.id);

          setUploadFiles(prev => prev.map(f =>
            f.id === fileData.id ? {
              ...f,
              status: 'error',
              error: 'Upload cancelled'
            } : f
          ));
        });

        const endpoint = containsFolder
          ? `/api/upload-folder?dir=${encodeURIComponent(currentPath)}${token ? `&token=${token}` : ''}`
          : `/api/upload?dir=${encodeURIComponent(currentPath)}${token ? `&token=${token}` : ''}`;

        xhr.open('POST', endpoint);
        xhr.send(formData);
      });
    }
  }, [currentPath, token, refetchData]);

  const handleDoubleClick = useCallback(() => {
    if (preview.isOpen || !useDoubleClick) return;

    switch (doubleClickAction) {
      case 'imageOnly':
        if (!isSearching) {
          setIsImageOnlyMode(!isImageOnlyMode);
          setToastMessage(`Image Only Mode: ${!isImageOnlyMode ? 'On' : 'Off'}`);
        } else {
          setToastMessage('Cannot toggle Image Only Mode during search');
        }
        break;
      case 'recursiveSearch':
        setRecursiveSearch(!recursiveSearch);
        setToastMessage(`Recursive Search: ${!recursiveSearch ? 'On' : 'Off'}`);
        break;
      case 'refresh':
        refetchData();
        setToastMessage('Page Refreshed');
        break;
    }

    // Show toast notification
    setShowToast(true);

    // Clear any existing timer
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);

    // Hide toast after 2 seconds
    toastTimerRef.current = setTimeout(() => {
      setShowToast(false);
    }, 2000);
  }, [preview.isOpen, doubleClickAction, isImageOnlyMode, isSearching, recursiveSearch, refetchData]);



  const useAdaptiveBg = true;

  let bgImage = 'api/bg';

  const [screenWidth, setScreenWidth] = useState(0);
  const [screenHeight, setScreenHeight] = useState(0);
  useEffect(() => {
    if (!useAdaptiveBg) return;
    setScreenWidth(window.innerWidth);
    setScreenHeight(window.innerHeight);
  }, []);
  if (useAdaptiveBg) {
    bgImage = `api/bgs?width=${screenWidth}&height=${screenHeight}`;
    if (screenWidth === 0 || screenHeight === 0) {
      return (
        <div className="w-screen h-screen flex items-center justify-center bg-[#3c3c3c]">
          <div className="relative group">
            <div
              className="text-[30vw] font-extralight font-serif text-transparent absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
              style={{ WebkitTextStroke: '2px #9ca3af' }}
            >
              K
            </div>
            <div
              className="text-[30vw] font-extralight font-serif text-gray-400 absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
              style={{ transform: 'translate(20px, 20px)' }}
            >
              K
            </div>
          </div>
        </div>
      );
    }
  }

  return (
    <div
      style={{
        backgroundColor: '#3c3c3c',
        backgroundImage: `url(${bgImage})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        backgroundAttachment: 'fixed',
      }}
      onClick={() => setFocusedFileIndex(null)}
      onDoubleClick={handleDoubleClick}
      onContextMenu={(e) => e.preventDefault()}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Toast notification */}
      {showToast && (
        <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-black/70 text-white px-4 py-2 rounded-md shadow-lg z-50 transition-opacity duration-300">
          {toastMessage}
        </div>
      )}

      {/* Drag and Drop indicator */}
      {isDragging && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center">
          <div className="bg-white/90 p-8 rounded-lg shadow-lg text-center">
            <Upload size={64} className="mx-auto mb-4 text-blue-500" />
            <h2 className="text-xl font-bold mb-2">Drop files to upload...</h2>
            <p className="text-gray-600">Files will be uploaded to the current directory</p>
          </div>
        </div>
      )}

      <main className="container mx-auto min-h-screen flex flex-col p-4 pb-8 gap-2">
        <header className="flex flex-col md:flex-row gap-1">
          <div className="w-full flex justify-between gap-1">
            <div className="flex-1 flex gap-1 justify-start">
              <Button
                variant="outline"
                size="icon"
                onClick={goBack}
                disabled={!canGoBack}
                className={cn(
                  "text-black",
                  "bg-white hover:bg-white/80",
                  "transition-colors duration-200"
                )}
              >
                <ArrowLeft size={18} />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={goHome}
                className={cn(
                  "text-black",
                  "bg-white hover:bg-white/80",
                  "transition-colors duration-200"
                )}
              >
                <Home size={18} />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={handleUpload}
                className={cn(
                  "text-black",
                  "bg-white hover:bg-white/80",
                  "transition-colors duration-200",
                  "max-md:hidden"
                )}
              >
                <Upload size={18} />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={handleFolderUpload}
                className={cn(
                  "text-black",
                  "bg-white hover:bg-white/80",
                  "transition-colors duration-200",
                  "max-md:hidden"
                )}
              >
                <FolderUp size={18} />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={handleMkdir}
                className={cn(
                  "text-black",
                  "bg-white hover:bg-white/80",
                  "transition-colors duration-200",
                  "max-md:hidden"
                )}
              >
                <FolderPlus size={18} />
              </Button>
              {useFileIndex && (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setShowIndexDialog(true)}
                  className={cn(
                    "text-black",
                    "bg-white hover:bg-white/80",
                    "transition-colors duration-200",
                    "max-md:hidden"
                  )}
                >
                  <Database size={18} />
                </Button>
              )}
              {useFileWatcher && (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setShowWatcherDialog(true)}
                  className={cn(
                    "text-black",
                    "bg-white hover:bg-white/80",
                    "transition-colors duration-200",
                    "max-md:hidden"
                  )}
                >
                  <Eye size={18} />
                </Button>
              )}
              <Button
                variant="outline"
                size="icon"
                onClick={() => refetchData()}
                className={cn(
                  "group",
                  "text-blue-700 hover:text-blue-800",
                  "bg-white hover:bg-white/80",
                  "transition-colors duration-200"
                )}
              >
                <RefreshCcw size={18} className="group-hover:animate-spin" />
              </Button>
            </div>

            <form onSubmit={handleSearch} className="flex-1 max-md:hidden max-w-sm flex gap-1 justify-center">
              <Input
                name="searchQuery"
                placeholder="Search files..."
                defaultValue={searchQuery}
                className={cn(
                  "w-full",
                  "backdrop-blur-sm",
                  "text-white",
                  "selection:bg-white selection:text-black",
                  "focus-visible:ring-[1px]"
                )}
              />
              <Button type="submit" variant="secondary" size="icon">
                <Search size={18} />
              </Button>
              {isSearching && (
                <Button type="button" variant="secondary" size="icon" className="text-red-500" onClick={handleClearSearch}>
                  <X size={18} />
                </Button>
              )}
            </form>

            <div className="flex-1 flex gap-1 justify-end">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="flex items-center gap-1 min-w-20 h-full font-bold font-mono select-none">
                    {sortBy === 'name' ? 'Name' : sortBy === 'size' ? 'Size' : 'Date'}
                    {sortOrder === 'asc' ? ' ↑' : ' ↓'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-1">
                  <div className="grid gap-1">
                    <Button
                      variant={sortBy === 'name' ? "default" : "ghost"}
                      size="sm"
                      className="justify-start"
                      onClick={() => {
                        setSortBy('name');
                        setSortOrder(sortBy === 'name' ? (sortOrder === 'asc' ? 'desc' : 'asc') : 'asc');
                      }}
                    >
                      Name {sortBy === 'name' && (sortOrder === 'asc' ? '↑' : '↓')}
                    </Button>
                    <Button
                      variant={sortBy === 'size' ? "default" : "ghost"}
                      size="sm"
                      className="justify-start"
                      onClick={() => {
                        setSortBy('size');
                        setSortOrder(sortBy === 'size' ? (sortOrder === 'asc' ? 'desc' : 'asc') : 'asc');
                      }}
                    >
                      Size {sortBy === 'size' && (sortOrder === 'asc' ? '↑' : '↓')}
                    </Button>
                    <Button
                      variant={sortBy === 'date' ? "default" : "ghost"}
                      size="sm"
                      className="justify-start"
                      onClick={() => {
                        setSortBy('date');
                        setSortOrder(sortBy === 'date' ? (sortOrder === 'asc' ? 'desc' : 'asc') : 'asc');
                      }}
                    >
                      Date {sortBy === 'date' && (sortOrder === 'asc' ? '↑' : '↓')}
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>

              <Button
                variant={viewMode === 'list' ? 'default' : 'outline'}
                size="icon"
                onClick={() => setViewMode('list')}
                className="max-md:hidden"
              >
                <ListIcon size={18} />
              </Button>
              <Button
                variant={viewMode === 'grid' ? 'default' : 'outline'}
                size="icon"
                onClick={() => setViewMode('grid')}
                className="max-md:hidden"
              >
                <Grid3x3Icon size={18} />
              </Button>
              <Button
                variant={viewMode === 'image' ? 'default' : 'outline'}
                size="icon"
                onClick={() => setViewMode('image')}
                className="max-md:hidden"
              >
                <ImageIcon size={18} />
              </Button>
              <Button
                variant={isImageOnlyMode ? 'default' : 'outline'}
                size="icon"
                onClick={() => setIsImageOnlyMode(!isImageOnlyMode)}
                className={cn(
                  "max-md:hidden",
                  "text-yellow-500 hover:text-white hover:bg-yellow-500/20",
                  isSearching && 'hidden',
                  isImageOnlyMode && 'text-white bg-yellow-600/20 hover:bg-yellow-400/50'
                )}
              >
                <ImageIcon size={18} />
              </Button>

              <div className="flex items-center">
                {isCheckingAuth ? (
                  <Button variant="outline" size="icon" disabled>
                    <Loader2 className="w-4 h-4 animate-spin" />
                  </Button>
                ) : isAuthenticated ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="icon">
                        <User className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem>
                        <User className="w-4 h-4 mr-2" />
                        {username} ({permissions})
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={logout}>
                        <LogOut className="w-4 h-4 mr-2" />
                        Logout
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setIsLoginDialogOpen(true)}
                    title="Login"
                    className="max-md:hidden"
                  >
                    <LogIn className="w-4 h-4" />
                  </Button>
                )}
              </div>

              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="icon">
                    <MoreHorizontal size={18} />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-1 select-none">
                  <ScrollArea className="h-[50vh]">
                    <div className="grid gap-1">
                      <div className="px-2 py-1 text-sm font-semibold flex justify-center md:hidden">View Mode</div>
                      <Button variant={viewMode === 'list' ? 'default' : 'outline'} size="sm" className="justify-start md:hidden" onClick={() => setViewMode('list')}>
                        <ListIcon size={18} /> List View
                      </Button>
                      <Button variant={viewMode === 'grid' ? 'default' : 'outline'} size="sm" className="justify-start md:hidden" onClick={() => setViewMode('grid')}>
                        <Grid3x3Icon size={18} /> Grid View
                      </Button>
                      <Button variant={viewMode === 'image' ? 'default' : 'outline'} size="sm" className="justify-start md:hidden" onClick={() => setViewMode('image')}>
                        <ImageIcon size={18} /> Image View
                      </Button>

                      <Separator className="my-1 md:hidden" />

                      <div className="px-2 py-1 text-sm font-semibold flex justify-center">Image Options</div>
                      <Button variant="outline" size="sm" className="justify-start md:hidden" onClick={() => setIsImageOnlyMode(!isImageOnlyMode)}>
                        <ImageIcon size={18} className={cn(
                          "text-yellow-500",
                          isImageOnlyMode && "fill-yellow-300"
                        )} /> Image Only
                      </Button>
                      <Button variant="outline" size="sm" className="justify-start" onClick={() => setUseImageQuickPreview(!useImageQuickPreview)}>
                        <ImageIcon size={18} /> {useImageQuickPreview ? 'Disable Quick Preview' : 'Enable Quick Preview'}
                      </Button>
                      <Button variant="outline" size="sm" className="justify-start" onClick={() => setUseMasonry(!useMasonry)}>
                        <ImageIcon size={18} /> {useMasonry ? 'Disable Masonry' : 'Enable Masonry'}
                      </Button>
                      <Button variant="outline" size="sm" className="justify-start" onClick={() => setShowDirectoryCovers(!showDirectoryCovers)}>
                        <ImageIcon size={18} /> {showDirectoryCovers ? 'Hide Directory Covers' : 'Show Directory Covers'}
                      </Button>

                      <Separator className="my-1 md:hidden" />

                      <div className="px-2 py-1 text-sm font-semibold flex justify-center md:hidden">File Operations</div>
                      <Button variant="outline" size="sm" className="justify-start md:hidden" onClick={() => handleUpload()}>
                        <Upload size={18} /> Upload Files
                      </Button>
                      <Button variant="outline" size="sm" className="justify-start md:hidden" onClick={() => handleFolderUpload()}>
                        <FolderUp size={18} /> Upload Folder
                      </Button>
                      <Button variant="outline" size="sm" className="justify-start md:hidden" onClick={handleMkdir}>
                        <FolderPlus size={18} /> Create Directory
                      </Button>

                      <Separator className="my-1" />

                      <div className="px-2 py-1 text-sm font-semibold flex justify-center">Search Options</div>
                      <Button variant="outline" size="sm" className="justify-start" onClick={() => setUsePagination(!usePagination)}>
                        <Search size={18} /> {usePagination ? 'Disable Pagination' : 'Enable Pagination'}
                      </Button>
                      <Button variant="outline" size="sm" className="justify-start" onClick={() => setRecursiveSearch(!recursiveSearch)}>
                        <Search size={18} /> {recursiveSearch ? 'Disable Recursive Search' : 'Enable Recursive Search'}
                      </Button>


                      <Separator className="my-1" />

                      <div className="px-2 py-1 text-sm font-semibold flex justify-center">File Indexing</div>
                      {useFileIndex && <Button variant="outline" size="sm" className="justify-start md:hidden" onClick={() => setShowIndexDialog(true)}>
                        <Database size={18} /> Index Settings
                      </Button>}
                      {useFileWatcher && <Button variant="outline" size="sm" className="justify-start md:hidden" onClick={() => setShowWatcherDialog(true)}>
                        <Eye size={18} /> Watcher Settings
                      </Button>}
                      <Button variant="outline" size="sm" className="justify-start" onClick={() => setUseFileIndex(!useFileIndex)}>
                        <TestTube2 size={18} /> {useFileIndex ? 'Disable Index' : 'Enable Index'}
                      </Button>
                      <Button variant="outline" size="sm" className="justify-start" onClick={() => setUseFileWatcher(!useFileWatcher)}>
                        <TestTube2 size={18} /> {useFileWatcher ? 'Disable Watcher' : 'Enable Watcher'}
                      </Button>

                      <Separator className="my-1" />

                      <Button
                        variant="ghost"
                        className={cn(
                          "px-2 py-1 text-sm font-semibold",
                          !useDoubleClick && "line-through"
                        )}
                        onClick={() => setUseDoubleClick(!useDoubleClick)}
                      >
                        <MousePointer2 size={18} /> Double-Click Action
                      </Button>
                      {useDoubleClick && (
                        <>
                          <Button
                            variant={doubleClickAction === 'imageOnly' ? "default" : "outline"}
                            size="sm"
                            className="justify-start"
                            onClick={() => setDoubleClickAction('imageOnly')}
                          >
                            <ImageIcon size={18} className="mr-2" /> Toggle Image Only
                          </Button>
                          <Button
                            variant={doubleClickAction === 'recursiveSearch' ? "default" : "outline"}
                            size="sm"
                            className="justify-start"
                            onClick={() => setDoubleClickAction('recursiveSearch')}
                          >
                            <Search size={18} className="mr-2" /> Toggle Recursive Search
                          </Button>
                          <Button
                            variant={doubleClickAction === 'refresh' ? "default" : "outline"}
                            size="sm"
                            className="justify-start"
                            onClick={() => setDoubleClickAction('refresh')}
                          >
                            <RefreshCcw size={18} className="mr-2" /> Refresh Page
                          </Button>
                        </>
                      )}

                      <Separator className="my-1" />

                      <div className="px-2 py-1 text-sm font-semibold flex justify-center">Other Options</div>
                      <Button variant="outline" size="sm" className="justify-start" onClick={() => setUseBlur(!useBlur)}>
                        <Square size={18} /> {useBlur ? 'Disable Blur' : 'Enable Blur'}
                      </Button>
                      <Button variant="outline" size="sm" className="justify-start" onClick={() => setUseDirectionMenu(!useDirectionMenu)}>
                        <Menu size={18} /> {useDirectionMenu ? 'Disable Direction Menu' : 'Enable Direction Menu'}
                      </Button>
                      <Button variant="outline" size="sm" className="justify-start" onClick={() => setGridDirection(gridDirection === 'ltr' ? 'rtl' : 'ltr')}>
                        <ArrowLeftRight size={18} /> Grid Direction: {gridDirection === 'ltr' ? 'LTR' : 'RTL'}
                      </Button>
                    </div>
                  </ScrollArea>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <form onSubmit={handleSearch} className="flex-1 md:hidden w-full flex gap-1 justify-center">
            <Input
              name="searchQuery"
              placeholder="Search files..."
              defaultValue={searchQuery}
              className={cn(
                "w-full",
                "backdrop-blur-sm",
                "text-white",
                "selection:bg-white selection:text-black",
                "focus-visible:ring-[1px]"
              )}
            />
            <Button type="submit" variant="secondary" size="icon">
              <Search size={18} />
            </Button>
            {isSearching && (
              <Button type="button" variant="secondary" size="icon" className="text-red-500" onClick={handleClearSearch}>
                <X size={18} />
              </Button>
            )}
          </form>

        </header>

        <div className="flex justify-between gap-1">
          {!isSelecting ? (
            <nav ref={navRef} className="flex-1">
              {isSearching ? (
                <div className="h-9 bg-muted p-1 rounded-md text-sm flex items-center">
                  Searching: "{searchQuery}" in {currentPath || 'root'}
                </div>
              ) : (
                <div className="h-9 bg-muted p-1 rounded-md flex items-center">
                  <BreadcrumbNav
                    currentPath={currentPath}
                    onNavigate={navigateTo}
                    showRootIcon
                    onRootClick={goHome}
                    className="h-full"
                  />
                </div>
              )}
            </nav>
          ) : (
            <div className="h-9 flex-1 bg-muted px-4 py-1 rounded-md flex justify-between items-center gap-1">
              <span className="text-sm">
                {selectedFiles.length} files selected
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { handleMoveFromMultiple(selectedFiles); setIsSelecting(false); setSelectedFiles([]) }}
                  className="flex items-center gap-1 text-gray-500 hover:text-gray-600"
                >
                  <Scissors size={18} />
                  <span className="text-sm max-md:hidden">Cut</span>
                </button>
                <button
                  onClick={() => { handleCopyMultiple(selectedFiles); setIsSelecting(false); setSelectedFiles([]) }}
                  className="flex items-center gap-1 text-gray-500 hover:text-gray-600"
                >
                  <ClipboardCopy size={18} />
                  <span className="text-sm max-md:hidden">Copy</span>
                </button>
                <button
                  onClick={() => { handleDownloadMultiple2(selectedFiles); setIsSelecting(false); setSelectedFiles([]) }}
                  className="flex items-center gap-1 text-blue-500 hover:text-blue-600"
                >
                  <Download size={18} />
                  <span className="text-sm max-md:hidden">Download</span>
                </button>
                <button
                  onClick={() => { handleDeleteMultiple(selectedFiles) }}
                  className="flex items-center gap-1 text-red-500 hover:text-red-600"
                >
                  <Trash2 size={18} />
                  <span className="text-sm max-md:hidden">Delete</span>
                </button>
                <button onClick={handleInvertSelection} className="flex items-center gap-1 hover:text-gray-500">
                  <ArrowLeftRight size={18} />
                  <span className="text-sm max-md:hidden">Invert</span>
                </button>
                <button onClick={handleSelectAll} className="flex items-center gap-1 text-green-700 hover:text-green-800">
                  <CheckCheck size={18} />
                  <span className="text-sm max-md:hidden">Select All</span>
                </button>
                <button onClick={handleClearSelection} className="flex items-center gap-1 text-red-700 hover:text-red-800">
                  <X size={18} />
                  <span className="text-sm max-md:hidden">Clear</span>
                </button>
              </div>
            </div>
          )}
          {!isSelecting ? (
            <Button variant="outline" size="icon" onClick={() => setIsSelecting(true)}>
              <CircleCheck size={18} />
            </Button>
          ) : (
            <Button variant="outline" size="icon" onClick={() => {
              setIsSelecting(false);
              setSelectedFiles([]);
            }}>
              <CircleX size={18} />
            </Button>
          )}
        </div>

        <div className="relative w-full flex-1 select-none">
          {isCheckingAuth ? (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center">
              <Loading message="Checking authentication..." />
            </div>
          ) : !isAuthenticated ? (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center">
              <Error message="Please login to continue" />
            </div>
          ) : isError ? (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center">
              <Error message="Error loading files. Please try again." />
            </div>
          ) : isLoading ? (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center">
              <Loading message="Loading files..." />
            </div>
          ) : isNotFound ? (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center">
              <NotFound message="No files found" />
            </div>
          ) : null}

          <div className={cn(
            "absolute inset-0 transition-all duration-300 rounded-md",
            useBlur && "backdrop-blur-xs hover:backdrop-blur-sm",
            (!isAuthenticated || _isLoading || isError || isNotFound) && "opacity-0"
          )}>
            {viewMode === 'list' && (
              <AutoSizer>
                {({ height, width }) => (
                  <ListView
                    height={height}
                    width={width}
                    files={accumulatedFiles}
                    selectedFiles={selectedFiles}
                    isSelecting={isSelecting}
                    isSearching={isSearching}
                    focusedIndex={focusedFileIndex}
                    onFileClick={handleFileClick}
                    onCopy={handleCopy}
                    onCut={handleMoveFrom}
                    onDownload={handleDownload}
                    onDelete={handleDelete}
                    onShowDetails={handleShowDetails}
                    onQuickSelect={handleQuickSelect}
                    onRename={handleRename}
                    onScroll={handleVirtualizedScroll}
                    onItemsRendered={handleItemsRendered}
                    listRef={listRef}
                  />
                )}
              </AutoSizer>
            )}
            {viewMode === 'grid' && (
              <AutoSizer>
                {({ height, width }) => (
                  <GridView
                    height={height}
                    width={width}
                    files={accumulatedFiles}
                    selectedFiles={selectedFiles}
                    isSelecting={isSelecting}
                    focusedIndex={focusedFileIndex}
                    onFileClick={handleFileClick}
                    onCopy={handleCopy}
                    onCut={handleMoveFrom}
                    onDownload={handleDownload}
                    onDelete={handleDelete}
                    onShowDetails={handleShowDetails}
                    onQuickSelect={handleQuickSelect}
                    onRename={handleRename}
                    onScroll={handleVirtualizedScroll}
                    onItemsRendered={handleItemsRendered}
                    gridRef={gridRef}
                  />
                )}
              </AutoSizer>
            )}
            {viewMode === 'image' && (
              <>
                {isImageOnlyMode && useMasonry ? (
                  <AutoSizer>
                    {({ height, width }) => (
                      <MasonryView
                        height={height}
                        width={width}
                        files={accumulatedFiles}
                        selectedFiles={selectedFiles}
                        isSelecting={isSelecting}
                        focusedIndex={focusedFileIndex}
                        useImageQuickPreview={useImageQuickPreview}
                        direction={gridDirection}
                        token={token}
                        onFileClick={handleFileClick}
                        onCopy={handleCopy}
                        onCut={handleMoveFrom}
                        onDownload={handleDownload}
                        onDelete={handleDelete}
                        onShowDetails={handleShowDetails}
                        onQuickSelect={handleQuickSelect}
                        onRename={handleRename}
                        masonryRef={masonryRef}
                      />
                    )}
                  </AutoSizer>
                ) : (
                  <AutoSizer>
                    {({ height, width }) => (
                      <ImageGridView
                        height={height}
                        width={width}
                        files={accumulatedFiles}
                        selectedFiles={selectedFiles}
                        isSelecting={isSelecting}
                        focusedIndex={focusedFileIndex}
                        useImageQuickPreview={useImageQuickPreview}
                        token={token}
                        onFileClick={handleFileClick}
                        onCopy={handleCopy}
                        onCut={handleMoveFrom}
                        onDownload={handleDownload}
                        onDelete={handleDelete}
                        onShowDetails={handleShowDetails}
                        onQuickSelect={handleQuickSelect}
                        onRename={handleRename}
                        onScroll={handleVirtualizedScroll}
                        onItemsRendered={handleItemsRendered}
                        imageGridRef={imageGridRef}
                      />
                    )}
                  </AutoSizer>
                )}
              </>
            )}
          </div>
        </div>

        {/* Show total files count with loaded count */}
        <div className={cn(
          "flex justify-center text-sm text-muted/70 select-none",
          (!isAuthenticated || _isLoading || isError || isNotFound) && "opacity-0"
        )}>
          {usePagination ?
            `${accumulatedFiles.length} of ${totalFiles} files loaded`
            :
            `${totalFiles} files found`
          }
        </div>


        {/* Preview Overlay */}
        {preview.isOpen && (
          <>
            {/* Image preview */}
            {preview.type === 'image' && (
              <ImagePreview
                isOpen={preview.isOpen}
                title={isImageOnlyMode ? preview.path : preview.path.split('/').pop()}
                src={`/api/raw?path=${encodeURIComponent(preview.path)}${token ? `&token=${token}` : ''}`}
                controls={{
                  onClose: closePreview,
                  onDownload: () => window.open(`/api/raw?path=${encodeURIComponent(preview.path)}${token ? `&token=${token}` : ''}`, '_blank'),
                  onNext: () => navigatePreview('next'),
                  onPrev: () => navigatePreview('prev'),
                }}
              />
            )}

            {/* Video preview */}
            {preview.type === 'video' && (
              <VideoPreview
                isOpen={preview.isOpen}
                title={preview.path.split('/').pop()}
                src={`/api/raw?path=${encodeURIComponent(preview.path)}${token ? `&token=${token}` : ''}`}
                controls={{
                  onClose: closePreview,
                  onDownload: () => window.open(`/api/raw?path=${encodeURIComponent(preview.path)}${token ? `&token=${token}` : ''}`, '_blank'),
                  onNext: () => navigatePreview('next'),
                  onPrev: () => navigatePreview('prev'),
                }}
              />
            )}

            {/* Audio preview */}
            {preview.type === 'audio' && (
              <AudioPreview
                isOpen={preview.isOpen}
                title={preview.path.split('/').pop()}
                src={`/api/raw?path=${encodeURIComponent(preview.path)}${token ? `&token=${token}` : ''}`}
                controls={{
                  onClose: closePreview,
                  onDownload: () => window.open(`/api/raw?path=${encodeURIComponent(preview.path)}${token ? `&token=${token}` : ''}`, '_blank'),
                  onNext: () => navigatePreview('next'),
                  onPrev: () => navigatePreview('prev'),
                }}
              />
            )}

            {/* Text preview */}
            {(preview.type === 'text') && (
              <TextPreview
                isOpen={preview.isOpen}
                fileName={preview.path.split('/').pop()}
                fileExtension={getFileExtension(preview.path)}
                content={previewContent}
                isLoading={contentLoading}
                hasError={!!contentError}
                controls={{
                  onClose: closePreview,
                  onDownload: () => window.open(`/api/raw?path=${encodeURIComponent(preview.path)}${token ? `&token=${token}` : ''}`, '_blank'),
                }}
              />
            )}

            {/* PDF preview */}
            {preview.type === 'pdf' && (
              <PDFPreview
                isOpen={preview.isOpen}
                title={preview.path.split('/').pop()}
                src={`/api/raw?path=${encodeURIComponent(preview.path)}${token ? `&token=${token}` : ''}`}
                controls={{
                  onClose: closePreview,
                  onDownload: () => window.open(`/api/raw?path=${encodeURIComponent(preview.path)}${token ? `&token=${token}` : ''}`, '_blank'),
                }}
              />
            )}

            {/* Comic preview */}
            {preview.type === 'comic' && (
              <ComicPreview
                isOpen={preview.isOpen}
                title={preview.path.split('/').pop()}
                src={`/api/comic?path=${encodeURIComponent(preview.path)}${token ? `&token=${token}` : ''}`}
                controls={{
                  onClose: closePreview,
                  onNext: () => navigatePreview('next'),
                  onPrev: () => navigatePreview('prev'),
                  onDownload: () => window.open(`/api/raw?path=${encodeURIComponent(preview.path)}${token ? `&token=${token}` : ''}`, '_blank'),
                }}
              />
            )}

            {preview.type === 'epub' && (
              <EPUBPreview
                isOpen={preview.isOpen}
                title={preview.path.split('/').pop()}
                src={`/api/raw?path=${encodeURIComponent(preview.path)}${token ? `&token=${token}` : ''}`}
                controls={{
                  onClose: closePreview,
                  onDownload: () => window.open(`/api/raw?path=${encodeURIComponent(preview.path)}${token ? `&token=${token}` : ''}`, '_blank'),
                }}
              />
            )}
          </>
        )}

        <Separator />
        <footer className="flex justify-center items-center">
          <p className="text-sm text-muted-foreground font-bold font-mono">
            Developed by <a href="https://github.com/Kobayashi2003" className="underline">Kobayashi2003</a>
          </p>
          <span className="mx-2">•</span>
          <a href="https://github.com/Kobayashi2003" className="rounded-full overflow-hidden">
            <img src="github_icon.png" alt="GitHub" className="w-4 h-4" />
          </a>
        </footer>

        <FloatingButtons direction="up">
          {/* Paste here button */}
          {filesToClone.length > 0 && (
            <FloatingButton
              icon={<ClipboardPaste size={18} />}
              onClick={() => setCloneComfirmDialogOpen(true)}
              label="Paste here"
            />
          )}

          {/* Move here button */}
          {filesToMove.length > 0 && (
            <FloatingButton
              icon={<MoveHorizontal size={18} />}
              onClick={() => setMoveComfirmDialogOpen(true)}
              label="Move here"
            />
          )}

          {/* Scroll to top button */}
          {showScrollTop && (
            <FloatingButton
              icon={<ArrowUp size={24} />}
              onClick={scrollToTop}
              label="Scroll to top"
            />
          )}

          {/* Upload status button */}
          {uploadFiles.length > 0 && (
            <FloatingButton
              icon={<Upload size={20} />}
              onClick={() => setShowUploadDialog(true)}
              label="Show upload progress"
            />
          )}

          {/* Download status button */}
          {downloadFiles.length > 0 && (
            <FloatingButton
              icon={<Download size={20} />}
              onClick={() => setShowDownloadDialog(true)}
              label="Show download progress"
            />
          )}
        </FloatingButtons>

        {/* Upload dialog */}
        <UploadDialog
          open={showUploadDialog}
          setOpen={setShowUploadDialog}
          files={uploadFiles}
          onCancel={cancelUpload}
          onCancelAll={cancelAllUploads}
          removeTask={removeUploadTask}
        />

        {/* Download dialog */}
        <DownloadDialog
          open={showDownloadDialog}
          setOpen={setShowDownloadDialog}
          files={downloadFiles}
          onCancel={cancelDownload}
          onCancelAll={cancelAllDownloads}
          removeTask={removeDownloadTask}
        />

        {/* Details dialog */}
        {fileToShowDetails && (
          <DetailsDialog
            open={detailsDialogOpen}
            setOpen={setDetailsDialogOpen}
            file={fileToShowDetails}
          />
        )}

        {/* Download confirm dialog */}
        <ConfirmDialog
          open={downloadComfirmDialogOpen}
          setOpen={setDownloadComfirmDialogOpen}
          title="Download"
          description="This type of file is not supported, do you want to download it?"
          confirmText="Download"
          cancelText="Cancel"
          onConfirm={() => {
            // window.open(`/api/raw?path=${encodeURIComponent(fileToDownload)}${token ? `&token=${token}` : ''}`, '_blank');
            handleDownload(fileToDownload);
            setFileToDownload('');
            setDownloadComfirmDialogOpen(false);
          }}
          onCancel={() => {
            setFileToDownload('');
            setDownloadComfirmDialogOpen(false);
          }}
        />

        {/* Download multiple files dialog */}
        <ConfirmDialog
          open={downloadMultipleDialogOpen}
          setOpen={setDownloadMultipleDialogOpen}
          title="Download"
          description={`Are you sure you want to download ${selectedFiles.length} files?`}
          confirmText="Download"
          cancelText="Cancel"
          onConfirm={() => {
            handleDownloadMultiple2(selectedFiles);
            setSelectedFiles([]);
            setDownloadMultipleDialogOpen(false);
          }}
          onCancel={() => {
            setSelectedFiles([]);
            setDownloadMultipleDialogOpen(false);
          }}
        />

        {/* Delete confirm dialog */}
        <ConfirmDialog
          open={deleteComfirmDialogOpen}
          setOpen={setDeleteComfirmDialogOpen}
          title="Delete"
          description="Are you sure you want to delete this file?"
          confirmText="Delete"
          cancelText="Cancel"
          onConfirm={() => handleDeleteConfirm(fileToDelete)}
          onCancel={handleDeleteCancel}
        />

        {/* Delete multiple files dialog */}
        <ConfirmDialog
          open={deleteMultipleDialogOpen}
          setOpen={setDeleteMultipleDialogOpen}
          title="Delete"
          description={`Are you sure you want to delete ${selectedFiles.length} files?`}
          confirmText="Delete"
          cancelText="Cancel"
          onConfirm={() => handleDeleteMultipleConfirm(selectedFiles)}
          onCancel={handleDeleteMultipleCancel}
        />

        {/* Paste here dialog */}
        <ConfirmDialog
          open={cloneComfirmDialogOpen}
          setOpen={setCloneComfirmDialogOpen}
          title="Paste here"
          description="Are you sure you want to paste these files here?"
          confirmText="Paste"
          cancelText="Cancel"
          onConfirm={() => handlePasteConfirm(currentPath)}
          onCancel={handlePasteCancel}
        />

        {/* Move here dialog */}
        <ConfirmDialog
          open={moveComfirmDialogOpen}
          setOpen={setMoveComfirmDialogOpen}
          title="Move here"
          description="Are you sure you want to move these files here?"
          confirmText="Move"
          cancelText="Cancel"
          onConfirm={() => handleMoveHereComfirm(currentPath)}
          onCancel={handleMoveHereCancel}
        />

        {/* Index settings dialog */}
        <IndexSettingsDialog
          open={showIndexDialog}
          setOpen={setShowIndexDialog}
        />

        {/* Watcher settings dialog */}
        <WatcherSettingsDialog
          open={showWatcherDialog}
          setOpen={setShowWatcherDialog}
        />

        {/* Login dialog */}
        <LoginDialog
          open={isLoginDialogOpen}
          setOpen={setIsLoginDialogOpen}
        />

        {/* Rename input dialog */}
        <InputDialog
          open={renameInputDialogOpen}
          setOpen={setRenameInputDialogOpen}
          title="Rename"
          description="Enter the new name for the file"
          confirmText="Rename"
          cancelText="Cancel"
          defaultValue={fileToRename.split('/').pop()}
          placeholder="New name"
          onConfirm={(newName) => handleRenameConfirm(newName.trim())}
          onCancel={handleRenameCancel}
        />

        {/* Mkdir input dialog */}
        <InputDialog
          open={mkdirInputDialogOpen}
          setOpen={setMkdirInputDialogOpen}
          title="Mkdir"
          description="Enter the name for the new directory"
          confirmText="Create"
          cancelText="Cancel"
          defaultValue={"New Folder"}
          placeholder="New directory name"
          onConfirm={(name) => handleMkdirConfirm(currentPath, name.trim())}
          onCancel={handleMkdirCancel}
        />
      </main>

      {/* Direction Menu for view mode selection */}
      {useDirectionMenu && <DirectionMenu
        topNode={
          <div className="flex flex-col items-center">
            <Grid3x3Icon size={24} />
            <span className="text-xs mt-1">Grid</span>
          </div>
        }
        rightNode={
          <div className="flex flex-col items-center">
            <ImageIcon size={24} />
            <span className="text-xs mt-1">Image</span>
          </div>
        }
        bottomNode={
          <div className="flex flex-col items-center">
            <ImageIcon size={24} className={isImageOnlyMode ? 'text-yellow-500' : ''} />
            <span className="text-xs mt-1">Image Only</span>
          </div>
        }
        leftNode={
          <div className="flex flex-col items-center">
            <ListIcon size={24} />
            <span className="text-xs mt-1">List</span>
          </div>
        }
        onTopAction={() => setViewMode('grid')}
        onRightAction={() => setViewMode('image')}
        onBottomAction={() => setIsImageOnlyMode(!isImageOnlyMode)}
        onLeftAction={() => setViewMode('list')}
        centerLabel="View"
      />}
    </div>
  );
}

export default function FileExplorer() {
  return (
    <Suspense fallback={
      <div className="w-screen h-screen flex items-center justify-center bg-[#3c3c3c]">
        <div className="relative group">
          <div
            className="text-[30vw] font-extralight font-serif text-transparent absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ WebkitTextStroke: '2px #9ca3af' }}
          >
            K
          </div>
          <div
            className="text-[30vw] font-extralight font-serif text-gray-400 absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ transform: 'translate(20px, 20px)' }}
          >
            K
          </div>
        </div>
      </div>
    }>
      <FileExplorerContent />
    </Suspense>
  );
}