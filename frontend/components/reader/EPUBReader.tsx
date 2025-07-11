"use client";

import React, { useState, useEffect, useRef, MouseEvent, TouchEvent } from 'react';
import type { Rendition, NavItem } from 'epubjs';
import { ReactReader, ReactReaderStyle, type IReactReaderStyle } from 'react-reader';
import { cn } from "@/lib/utils";
import { 
  Settings, ArrowRightToLine, ArrowLeftToLine, Search, Sun, Moon, 
  RotateCcw, MousePointer, Menu, Ban, Pointer, PointerOff, Type, 
  GripHorizontal, X, Download, Maximize, Minimize
} from 'lucide-react';

interface EPUBReaderProps {
  src: string;
  className?: string;
  onClose?: () => void;
  onDownload?: () => void;
  onFullScreenChange?: (isFullScreen: boolean) => void;
}

type SearchResult = { cfi: string; excerpt: string };
type FontFamily = 'Default' | 'Georgia' | 'Verdana' | 'Courier' | 'Arial' | 'OpenDyslexic';

const lightReaderTheme: IReactReaderStyle = {
  ...ReactReaderStyle,
  readerArea: {
    ...ReactReaderStyle.readerArea,
    transition: undefined,
  },
}

const darkReaderTheme: IReactReaderStyle = {
  ...ReactReaderStyle,
  arrow: {
    ...ReactReaderStyle.arrow,
    color: 'white',
  },
  arrowHover: {
    ...ReactReaderStyle.arrowHover,
    color: '#ccc',
  },
  readerArea: {
    ...ReactReaderStyle.readerArea,
    backgroundColor: '#000',
    transition: undefined,
  },
  titleArea: {
    ...ReactReaderStyle.titleArea,
    color: '#ccc',
  },
  tocArea: {
    ...ReactReaderStyle.tocArea,
    background: '#111',
  },
  tocButtonExpanded: {
    ...ReactReaderStyle.tocButtonExpanded,
    background: '#222',
  },
  tocButtonBar: {
    ...ReactReaderStyle.tocButtonBar,
    background: '#fff',
  },
  tocButton: {
    ...ReactReaderStyle.tocButton,
    color: 'white',
  },
}


export const EPUBReader = ({
  src,
  className,
  onClose,
  onDownload,
  onFullScreenChange,
}: EPUBReaderProps) => {

  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);

  const [location, setLocation] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [isRTL, setIsRTL] = useState(false);
  const [swipeable, setSwipeable] = useState(false);
  const [darkMode, setDarkMode] = useState(true);
  const [fontSize, setFontSize] = useState(100);
  const [fontFamily, setFontFamily] = useState<FontFamily>('Default');
  const [pageInfo, setPageInfo] = useState('');
  const [pageTurnOnScroll, setPageTurnOnScroll] = useState(true);
  const [disableContextMenu, setDisableContextMenu] = useState(false);
  const [showDownload, setShowDownload] = useState(true);
  const [showFullscreen, setShowFullscreen] = useState(true);
  const [isFullScreen, setIsFullScreen] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [currentResultIndex, setCurrentResultIndex] = useState(0);
  const [showSearch, setShowSearch] = useState(false);

  const tocRef = useRef<NavItem[]>([]);
  const renditionRef = useRef<Rendition | null>(null);
  const prevResultsRef = useRef<SearchResult[]>([]);

  const [searchPosition, setSearchPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; initialX: number; initialY: number }>({
    startX: 0,
    startY: 0,
    initialX: 0,
    initialY: 0
  });
  const searchBoxRef = useRef<HTMLDivElement>(null);

  const loadingView = (
    <div className={cn("flex flex-col items-center justify-center h-full",
      darkMode ? "text-white" : "text-black")}>
      <RotateCcw className="animate-spin" />
      <p>Loading...</p>
    </div>
  );

  useEffect(() => {
    const loadSetting = <T,>(key: string, defaultValue: T, parser?: (value: string) => T): T => {
      const saved = localStorage.getItem(key);
      if (saved === null) return defaultValue;
      return parser ? parser(saved) : (saved as unknown as T);
    };

    setLocation(localStorage.getItem(`epub-location-${src}`));

    setIsRTL(loadSetting('epub-direction', false, value => value === 'rtl'));
    setFontSize(loadSetting('epub-fontsize', 100, value => parseInt(value, 10)));
    setDarkMode(loadSetting('epub-theme', true, value => value === 'dark'));
    setPageTurnOnScroll(loadSetting('epub-pageturn', true, value => value === 'true'));
    setSwipeable(loadSetting('epub-swipeable', false, value => value === 'true'));
    setDisableContextMenu(loadSetting('epub-disablecontextmenu', false, value => value === 'true'));
    setFontFamily(loadSetting('epub-fontfamily', 'Default' as FontFamily));
    setShowDownload(loadSetting('epub-showdownload', true, value => value === 'true'));
    setShowFullscreen(loadSetting('epub-showfullscreen', true, value => value === 'true'));
  }, [src]);

  const handleTocChanged = (toc: NavItem[]) => {
    tocRef.current = toc;
  };

  const handleLocationChanged = (loc: string) => {
    setLocation(loc);
    localStorage.setItem(`epub-location-${src}`, loc);

    if (renditionRef.current && tocRef.current) {
      const { displayed, href } = renditionRef.current.location.start;
      const chapter = tocRef.current.find((item) => {
        let itemHref = item.href;
        while (itemHref.startsWith("../")) {
          itemHref = itemHref.substring(3);
        }
        let hrefHref = href;
        while (hrefHref.startsWith("../")) {
          hrefHref = hrefHref.substring(3);
        }
        return itemHref === hrefHref;
      });
      setPageInfo(
        `${displayed.page} / ${displayed.total}${chapter ? ` - ${chapter.label}` : ''}`
      );
    }
  };

  const setupRendition = (rendition: Rendition) => {
    renditionRef.current = rendition;

    // *** Apply theme settings first
    // ******************************************************
    rendition.themes.fontSize(`${fontSize}%`);
    applyFontFamily(rendition);

    const themeColors = darkMode ?
      { text: '#fff', background: '#000' } :
      { text: '#000', background: '#fff' };

    rendition.themes.override('color', themeColors.text);
    rendition.themes.override('background', themeColors.background);

    // *** Enhanced spine item getter with relative path support
    // ******************************************************
    const getSpineItem = rendition.book.spine.get.bind(rendition.book.spine);
    rendition.book.spine.get = (target: string) => {
      let spineItem = getSpineItem(target);

      if (!spineItem && target?.startsWith("../")) {
        spineItem = getSpineItem(target.substring(3));
      }

      if (!spineItem) {
        spineItem = getSpineItem(undefined);
      }

      return spineItem;
    }

    // *** Layout Analysis
    // ******************************************************
    const book = rendition.book as any;
    const metadata = book.package?.metadata;
    const spine = book.spine;
    
    const layoutAnalysis = {
      // Global layout mode
      globalLayout: metadata?.layout || 'reflowable',
      
      // Global spread mode
      globalSpread: metadata?.spread || 'auto',
      
      // Fixed layout detection
      hasFixedLayoutItems: spine?.items?.some((item: any) =>
        item.properties?.includes('rendition:layout-pre-paginated')
      ),
      
      // Spread properties analysis
      spreadProperties: {
        hasSpreadNone: spine?.items?.some((item: any) =>
          item.properties?.includes('rendition:spread-none')
        ),
        hasSpreadLeft: spine?.items?.some((item: any) =>
          item.properties?.includes('page-spread-left')
        ),
        hasSpreadRight: spine?.items?.some((item: any) =>
          item.properties?.includes('page-spread-right')
        ),
        hasSpreadCenter: spine?.items?.some((item: any) =>
          item.properties?.includes('page-spread-center')
        )
      },
      
      // Orientation properties
      orientation: metadata?.orientation || 'auto',
      orientationLock: metadata?.['orientation-lock'],
      
      // Writing mode
      writingMode: metadata?.['primary-writing-mode'] || 'horizontal-lr'
    };

    // *** Determine navigation strategy
    // ******************************************************
    const isFixedLayout = layoutAnalysis.globalLayout === 'pre-paginated' || 
                         layoutAnalysis.hasFixedLayoutItems;
    
    // *** Setup content hooks
    // ******************************************************
    rendition.hooks.content.register((contents: any) => {
      const spineItem = contents.spineItem;
      if (!spineItem?.properties) return;

      // Apply fixed layout settings
      if (spineItem.properties.includes('rendition:layout-pre-paginated')) {
        const viewportSettings = {
          width: "100%",
          height: "100%",
          scale: 1.0,
          spread: "none"
        };
        Object.assign(contents.viewport, viewportSettings);
      }

      // Apply spread position
      if (spineItem.properties.includes('rendition:spread-none')) {
        contents.viewport.spread = "none";
      } else if (spineItem.properties.includes('page-spread-left')) {
        contents.viewport.spread = "left";
      } else if (spineItem.properties.includes('page-spread-right')) {
        contents.viewport.spread = "right";
      } else if (spineItem.properties.includes('page-spread-center')) {
        contents.viewport.spread = "center";
      }

      // Apply writing mode if specified
      if (layoutAnalysis.writingMode === 'horizontal-rl') {
        contents.document.documentElement.style.direction = 'rtl';
        contents.document.documentElement.style.writingMode = 'horizontal-rl';
      }
    });

    // *** Apply global spread mode
    // ******************************************************
    let globalSpreadMode: string;
    
    if (isFixedLayout) {
      // For fixed layout, respect individual spine item properties
      // but fall back to global setting
      if (layoutAnalysis.spreadProperties.hasSpreadNone) {
        globalSpreadMode = "none";
      } else {
        globalSpreadMode = layoutAnalysis.globalSpread;
      }
    } else {
      // For reflowable layout, use global spread setting
      globalSpreadMode = layoutAnalysis.globalSpread;
    }
    
    rendition.spread(globalSpreadMode);

    // *** Navigation Helper Functions
    // ******************************************************
    
    // Check if current spine item is fixed layout
    const isCurrentSpineItemFixed = (currentLocation: any) => {
      if (!currentLocation?.start) return false;
      const currentSpineItem = rendition.book.spine.get(currentLocation.start.index);
      return currentSpineItem?.properties?.includes('rendition:layout-pre-paginated');
    };

    // Check if we should use content flow navigation
    const shouldUseContentFlow = (currentLocation: any) => {
      return layoutAnalysis.globalLayout === 'reflowable' && 
             !isCurrentSpineItemFixed(currentLocation);
    };

    // Calculate next spine index for fixed layout navigation
    const getNextSpineIndex = (currentLocation: any) => {
      const currentIndex = currentLocation.start.index;
      const spineItems = (rendition.book.spine as any).items;
      
      // Check if we're at the end
      if (currentIndex >= spineItems.length - 1) {
        return null;
      }

      let nextIndex = currentIndex + 1;
      
      // Handle double-page mode
      if (currentLocation.end && currentLocation.start.index !== currentLocation.end.index) {
        nextIndex = Math.max(currentLocation.start.index, currentLocation.end.index) + 1;
      }

      // Ensure we don't exceed total items
      if (nextIndex >= spineItems.length) {
        return null;
      }

      return nextIndex;
    };

    // Calculate previous spine index for fixed layout navigation
    const getPrevSpineIndex = (currentLocation: any) => {
      const currentIndex = currentLocation.start.index;
      
      // Check if we're at the beginning
      if (currentIndex <= 0) {
        return null;
      }

      let prevIndex = currentIndex - 1;
      
      // Handle double-page mode
      if (currentLocation.end && currentLocation.start.index !== currentLocation.end.index) {
        prevIndex = Math.min(currentLocation.start.index, currentLocation.end.index) - 2;
        
        // If we can't go back 2 positions, go back 1 position
        if (prevIndex < 0) {
          prevIndex = Math.min(currentLocation.start.index, currentLocation.end.index) - 1;
        }
      }

      // Ensure we don't go below 0
      if (prevIndex < 0) {
        return null;
      }

      return prevIndex;
    };

    // Handle spine item display with spread properties
    const displaySpineItem = (spineItem: any, currentLocation: any) => {
      if (!spineItem) return originalNavigation.next();

      const isCurrentItemFixed = isCurrentSpineItemFixed(currentLocation);

      // Handle spread properties for fixed layout items
      if (isFixedLayout || isCurrentItemFixed) {
        if (spineItem.properties?.includes('rendition:spread-none')) {
          return rendition.display(spineItem.href);
        } else if (spineItem.properties?.includes('page-spread-left')) {
          return rendition.display(spineItem.href);
        } else if (spineItem.properties?.includes('page-spread-right')) {
          return rendition.display(spineItem.href);
        } else if (spineItem.properties?.includes('page-spread-center')) {
          return rendition.display(spineItem.href);
        }
      }

      // Handle global spread settings
      if (layoutAnalysis.globalSpread === 'both') {
        // For forced double-page spread, we might need special handling
        // For now, just display the item normally
      }

      // Default: display the item
      return rendition.display(spineItem.href);
    };

    // *** Create navigation strategy
    // ******************************************************
    const originalNavigation = {
      next: rendition.next.bind(rendition),
      prev: rendition.prev.bind(rendition)
    };

    // Enhanced next page navigation
    rendition.next = () => {
      try {
        const currentLocation = (rendition as any).currentLocation();
        if (!currentLocation?.start) {
          return originalNavigation.next();
        }

        // For reflowable layout and non-fixed spine items, use original navigation (content flow)
        if (shouldUseContentFlow(currentLocation)) {
          return originalNavigation.next();
        }

        // For fixed layout or fixed spine items, use spine index navigation
        const nextIndex = getNextSpineIndex(currentLocation);
        if (nextIndex === null) {
          return Promise.resolve();
        }

        const nextSpineItem = rendition.book.spine.get(nextIndex);
        return displaySpineItem(nextSpineItem, currentLocation);
      } catch (error) {
        console.error("Error in EPUB 3.0 compliant next navigation:", error);
        return originalNavigation.next();
      }
    };

    // Enhanced previous page navigation
    rendition.prev = () => {
      try {
        const currentLocation = (rendition as any).currentLocation();
        if (!currentLocation?.start) {
          return originalNavigation.prev();
        }

        // For reflowable layout and non-fixed spine items, use original navigation (content flow)
        if (shouldUseContentFlow(currentLocation)) {
          return originalNavigation.prev();
        }

        // For fixed layout or fixed spine items, use spine index navigation
        const prevIndex = getPrevSpineIndex(currentLocation);
        if (prevIndex === null) {
          return Promise.resolve();
        }

        const prevSpineItem = rendition.book.spine.get(prevIndex);
        return displaySpineItem(prevSpineItem, currentLocation);
      } catch (error) {
        console.error("Error in EPUB 3.0 compliant prev navigation:", error);
        return originalNavigation.prev();
      }
    };
  };

  const clearHighlights = () => {
    if (!renditionRef.current) return;
    prevResultsRef.current.forEach((result) => {
      renditionRef.current?.annotations.remove(result.cfi, 'highlight');
    });
  };

  const highlightSearchResults = (results: SearchResult[]) => {
    if (!renditionRef.current) return;
    results.forEach((result) => {
      renditionRef.current?.annotations.add('highlight', result.cfi);
    });
  };

  const goToNextResult = () => {
    if (!searchResults.length) return;
    const nextIndex = (currentResultIndex + 1) % searchResults.length;
    setCurrentResultIndex(nextIndex);
    setLocation(searchResults[nextIndex].cfi);
  };

  const goToPreviousResult = () => {
    if (!searchResults.length) return;
    const previousIndex = (currentResultIndex - 1 + searchResults.length) % searchResults.length;
    setCurrentResultIndex(previousIndex);
    setLocation(searchResults[previousIndex].cfi);
  }

  useEffect(() => {
    if (searchResults.length && renditionRef.current) {
      setLocation(searchResults[0].cfi);
      clearHighlights();
      highlightSearchResults(searchResults);
      setCurrentResultIndex(0);
      prevResultsRef.current = searchResults;
    }
  }, [searchResults]);

  const increaseFontSize = () => {
    setFontSize(prev => Math.min(prev + 10, 200));
  };

  const decreaseFontSize = () => {
    setFontSize(prev => Math.max(prev - 10, 80));
  };

  useEffect(() => {
    if (renditionRef.current) {
      renditionRef.current.themes.fontSize(`${fontSize}%`);
      localStorage.setItem('epub-fontsize', fontSize.toString());
    }
  }, [fontSize]);

  const toggleTheme = () => {
    setDarkMode(prev => !prev);
  };

  useEffect(() => {
    if (renditionRef.current) {
      if (darkMode) {
        renditionRef.current.themes.override('color', '#fff');
        renditionRef.current.themes.override('background', '#000');
      } else {
        renditionRef.current.themes.override('color', '#000');
        renditionRef.current.themes.override('background', '#fff');
      }
      localStorage.setItem('epub-theme', darkMode ? 'dark' : 'light');
    }
  }, [darkMode]);

  const toggleReadingDirection = () => {
    const newDirection = !isRTL;
    setIsRTL(newDirection);
    localStorage.setItem('epub-direction', newDirection ? 'rtl' : 'ltr');
  };

  const togglePageTurnOnScroll = () => {
    const newValue = !pageTurnOnScroll;
    setPageTurnOnScroll(newValue);
    localStorage.setItem('epub-pageturn', newValue.toString());
  };

  const toggleSwipeable = () => {
    const newValue = !swipeable;
    setSwipeable(newValue);
    localStorage.setItem('epub-swipeable', newValue.toString());
  };

  const toggleDisableContextMenu = () => {
    const newValue = !disableContextMenu;
    setDisableContextMenu(newValue);
    localStorage.setItem('epub-disablecontextmenu', newValue.toString());
  };

  const toggleShowDownload = () => {
    const newValue = !showDownload;
    setShowDownload(newValue);
    localStorage.setItem('epub-showdownload', newValue.toString());
  };

  const toggleShowFullscreen = () => {
    const newValue = !showFullscreen;
    setShowFullscreen(newValue);
    localStorage.setItem('epub-showfullscreen', newValue.toString());
  };

  const handleFullScreen = () => {
    if (!document.fullscreenElement) {
      // Enter fullscreen
      document.documentElement.requestFullscreen().then(() => {
        setIsFullScreen(true);
        onFullScreenChange?.(true);
      }).catch((err) => {
        console.error('Error attempting to enable fullscreen:', err);
      });
    } else {
      // Exit fullscreen
      document.exitFullscreen().then(() => {
        setIsFullScreen(false);
        onFullScreenChange?.(false);
      }).catch((err) => {
        console.error('Error attempting to exit fullscreen:', err);
      });
    }
  };

  const applyFontFamily = (rendition: Rendition) => {
    let fontFamilyValue: string;

    switch (fontFamily) {
      case 'Georgia':
        fontFamilyValue = 'Georgia, serif';
        break;
      case 'Verdana':
        fontFamilyValue = 'Verdana, sans-serif';
        break;
      case 'Courier':
        fontFamilyValue = '"Courier New", monospace';
        break;
      case 'Arial':
        fontFamilyValue = 'Arial, sans-serif';
        break;
      case 'OpenDyslexic':
        fontFamilyValue = '"OpenDyslexic", sans-serif';
        break;
      default:
        fontFamilyValue = 'inherit';
    }

    rendition.themes.override('font-family', fontFamilyValue);
  };

  const changeFontFamily = (newFont: FontFamily) => {
    setFontFamily(newFont);
    localStorage.setItem('epub-fontfamily', newFont);

    if (renditionRef.current) {
      applyFontFamily(renditionRef.current);
    }
  };

  const handleMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if (!searchBoxRef.current) return;

    setIsDragging(true);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialX: searchPosition.x,
      initialY: searchPosition.y
    };

    e.preventDefault();
  };

  const handleTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    if (!searchBoxRef.current || e.touches.length === 0) return;

    setIsDragging(true);
    dragRef.current = {
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      initialX: searchPosition.x,
      initialY: searchPosition.y
    };
  };

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!isDragging) return;

    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;

    setSearchPosition({
      x: dragRef.current.initialX + dx,
      y: dragRef.current.initialY + dy
    });

    e.preventDefault();
  };

  const handleTouchMove = (e: TouchEvent<HTMLDivElement>) => {
    if (!isDragging || e.touches.length === 0) return;

    const dx = e.touches[0].clientX - dragRef.current.startX;
    const dy = e.touches[0].clientY - dragRef.current.startY;

    setSearchPosition({
      x: dragRef.current.initialX + dx,
      y: dragRef.current.initialY + dy
    });

    e.preventDefault();
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

  // Add global event listeners for mouse and touch events
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mouseup', handleDragEnd);
      document.addEventListener('touchend', handleDragEnd);
    } else {
      document.removeEventListener('mouseup', handleDragEnd);
      document.removeEventListener('touchend', handleDragEnd);
    }

    return () => {
      document.removeEventListener('mouseup', handleDragEnd);
      document.removeEventListener('touchend', handleDragEnd);
    };
  }, [isDragging]);

  // Reset search position when search is closed
  useEffect(() => {
    if (!showSearch) {
      setSearchPosition({ x: 0, y: 0 });
    }
  }, [showSearch]);

  const goNext = () => {
    renditionRef.current?.next();
  }

  const goPrev = () => {
    renditionRef.current?.prev();
  }

  const handleKeyPress = (event?: KeyboardEvent) => {
    if (!event) return;

    if (event.target instanceof HTMLInputElement || 
        event.target instanceof HTMLTextAreaElement ||
        (showSearch && searchBoxRef.current?.contains(event.target as Node))) {
      return;
    }

    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        isRTL ? goPrev() : goNext();
        break;
      case 'ArrowLeft':
        event.preventDefault();
        isRTL ? goNext() : goPrev();
        break;
    }
  };

  // Handle keyboard events
  useEffect(() => {
    if (!isMounted) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if we're in an input field or search box
      if (e.target instanceof HTMLInputElement || 
          e.target instanceof HTMLTextAreaElement ||
          (showSearch && searchBoxRef.current?.contains(e.target as Node))) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'f':
          e.preventDefault();
          handleFullScreen();
          break;
        case 'escape':
          if (isFullScreen) {
            e.preventDefault();
            handleFullScreen();
          } else {
            onClose?.();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMounted, showSearch, handleFullScreen]);

  // Listen for browser fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFullscreen = !!(
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).msFullscreenElement
      );
      
      if (isFullscreen !== isFullScreen) {
        setIsFullScreen(isFullscreen);
        onFullScreenChange?.(isFullscreen);
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('msfullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('msfullscreenchange', handleFullscreenChange);
    };
  }, [isFullScreen, onFullScreenChange]);

  return (
    <div className={cn("h-full w-full relative", className)}>
      <div className="h-full">
        <ReactReader
          url={src}
          loadingView={loadingView}
          readerStyles={darkMode ? darkReaderTheme : lightReaderTheme}
          tocChanged={handleTocChanged}
          getRendition={setupRendition}
          location={location}
          locationChanged={handleLocationChanged}
          epubInitOptions={{
            openAs: 'epub',
          }}
          epubOptions={{
            flow: "paginated",
            manager: "default",
            allowScriptedContent: true,
            width: "100%",
            height: "100%",
          }}
          searchQuery={searchQuery}
          onSearchResults={setSearchResults}
          isRTL={isRTL}
          pageTurnOnScroll={pageTurnOnScroll}
          swipeable={swipeable}
          contextLength={30}
          handleKeyPress={handleKeyPress}
        />
      </div>

      <div className={cn("absolute bottom-4 left-4 p-2 text-sm rounded-md z-10", darkMode ? "bg-black/70 text-white" : "bg-white/70 text-black")}>
        {pageInfo}
      </div>

      {/* Close button in top right corner */}
      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-20 bg-black/80 text-white p-2 rounded-full hover:bg-black/90 transition-colors"
          aria-label="Close"
        >
          <X size={20} />
        </button>
      )}

      {showSearch && (
        <div
          ref={searchBoxRef}
          style={{
            transform: `translate(${searchPosition.x}px, ${searchPosition.y}px)`,
            cursor: isDragging ? 'grabbing' : 'auto'
          }}
          className="absolute top-12 z-20 right-4 w-64 p-3 rounded-md bg-black/80 backdrop-blur-sm text-white border border-gray-700"
          onMouseMove={handleMouseMove}
          onTouchMove={handleTouchMove}
        >
          <div
            className="w-full flex items-center justify-between mb-2 cursor-grab active:cursor-grabbing"
            onMouseDown={handleMouseDown}
            onTouchStart={handleTouchStart}
          >
            <GripHorizontal size={16} className="text-gray-400" />
            <span className="text-xs text-gray-400">Drag to move</span>
          </div>
          <div className="relative w-full">
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-3 py-1.5 rounded-md bg-gray-800 text-white border border-gray-600 focus:outline-none focus:border-gray-400 text-sm"
            />
            <button
              onClick={() => {
                if (searchQuery === '') {
                  setShowSearch(false);
                } else {
                  setSearchQuery('');
                }
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white flex items-center justify-center"
              aria-label="Clear search"
            >
              <span className="text-xs">×</span>
            </button>
          </div>
          {searchResults.length > 0 && (
            <div className="mt-2">
              <div className="text-xs text-gray-300 mb-1 flex flex-col justify-between items-center">
                <span className="text-xs text-gray-400">
                  <span>
                    {searchResults[currentResultIndex].excerpt.substring(
                      searchResults[currentResultIndex].excerpt.indexOf(searchQuery) - 20,
                      searchResults[currentResultIndex].excerpt.indexOf(searchQuery)
                    )}
                  </span>
                  <span className="text-white font-bold bg-amber-700">
                    {searchResults[currentResultIndex].excerpt.substring(
                      searchResults[currentResultIndex].excerpt.indexOf(searchQuery),
                      searchResults[currentResultIndex].excerpt.indexOf(searchQuery) + searchQuery.length
                    )}
                  </span>
                  <span>
                    {searchResults[currentResultIndex].excerpt.substring(
                      searchResults[currentResultIndex].excerpt.indexOf(searchQuery) + searchQuery.length,
                      searchResults[currentResultIndex].excerpt.indexOf(searchQuery) + searchQuery.length + 20
                    )}
                  </span>
                </span>
                <span>{currentResultIndex + 1} of {searchResults.length}</span>
              </div>
              <div className="flex items-center justify-center gap-1">
                <button
                  onClick={goToPreviousResult}
                  className="flex-1 py-1.5 px-2 bg-gray-700 hover:bg-gray-600 rounded text-xs flex items-center justify-center gap-1"
                >
                  <ArrowLeftToLine size={12} />
                  <span>Prev</span>
                </button>
                <button
                  onClick={goToNextResult}
                  className="flex-1 py-1.5 px-2 bg-gray-700 hover:bg-gray-600 rounded text-xs flex items-center justify-center gap-1"
                >
                  <span>Next</span>
                  <ArrowRightToLine size={12} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="absolute bottom-4 right-4 z-10 flex flex-col gap-2 items-end">
        <button
          onClick={() => {
            setShowSearch(!showSearch);
            setShowSettings(false);
          }}
          className="bg-black text-white p-2 rounded-full hover:bg-gray-800"
          aria-label="Search"
        >
          <Search size={20} />
        </button>

        {/* Download button */}
        {showDownload && onDownload && (
          <button
            onClick={onDownload}
            className="bg-black text-white p-2 rounded-full hover:bg-gray-800"
            aria-label="Download"
          >
            <Download size={20} />
          </button>
        )}

        {/* Fullscreen button */}
        {showFullscreen && (
          <button
            onClick={handleFullScreen}
            className="bg-black text-white p-2 rounded-full hover:bg-gray-800"
            aria-label={isFullScreen ? "Exit Fullscreen" : "Enter Fullscreen"}
          >
            {isFullScreen ? <Minimize size={20} /> : <Maximize size={20} />}
          </button>
        )}

        <button
          onClick={() => {
            setShowSettings(!showSettings);
            setShowSearch(false);
          }}
          className="bg-black text-white p-2 rounded-full hover:bg-gray-800"
          aria-label="Settings"
        >
          <Settings size={20} />
        </button>

        {showSettings && (
          <div className={cn(
              "absolute bottom-0 right-full mr-2 bg-black/80 text-white backdrop-blur-sm p-4 rounded-lg min-w-[250px]",
              "border",
              darkMode ? "border-gray-700" : "border-gray-300"
            )}>
            <div className="grid gap-3">
              {/* Font Size */}
              <div className="flex justify-between items-center">
                <span className="text-sm">Font Size</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={decreaseFontSize}
                    className="w-7 h-7 flex items-center justify-center bg-gray-700 hover:bg-gray-600 rounded-full"
                  >
                    -
                  </button>
                  <span className="w-10 text-center text-sm">{fontSize}%</span>
                  <button
                    onClick={increaseFontSize}
                    className="w-7 h-7 flex items-center justify-center bg-gray-700 hover:bg-gray-600 rounded-full"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Font Family */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <Type size={16} />
                  <span className="text-sm">Font</span>
                </div>
                <div className="grid grid-cols-2 gap-1 mt-1">
                  {(['Default', 'Georgia', 'Verdana', 'Courier', 'Arial', 'OpenDyslexic'] as FontFamily[]).map((font) => (
                    <button
                      key={font}
                      onClick={() => changeFontFamily(font)}
                      className={cn(
                        "py-1 px-2 text-xs rounded",
                        fontFamily === font
                          ? "bg-white text-black"
                          : "bg-gray-700 hover:bg-gray-600 text-white"
                      )}
                    >
                      {font}
                    </button>
                  ))}
                </div>
              </div>

              {/* Theme */}
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Sun size={16} className={darkMode ? "text-gray-500" : "text-yellow-400"} />
                  <span className="text-sm">Theme</span>
                </div>
                <button
                  onClick={toggleTheme}
                  className="w-12 h-6 rounded-full relative bg-gray-700 flex items-center px-1"
                >
                  <div className={`w-4 h-4 rounded-full bg-white absolute transition-all ${darkMode ? "translate-x-6" : "translate-x-0"}`} />
                  <Moon size={12} className={`text-gray-400 ml-auto mr-0.5 z-10 ${darkMode && "fill-gray-400"}`} />
                </button>
              </div>

              {/* Reading Direction */}
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <ArrowRightToLine size={16} className={isRTL ? "text-gray-500" : "text-white"} />
                  <span className="text-sm">Direction</span>
                </div>
                <button
                  onClick={toggleReadingDirection}
                  className="w-12 h-6 rounded-full relative bg-gray-700 flex items-center px-1"
                >
                  <div className={`w-4 h-4 rounded-full bg-white absolute transition-all ${isRTL ? "translate-x-6" : "translate-x-0"}`} />
                  <ArrowLeftToLine size={12} className={`ml-auto mr-0.5 z-10 ${isRTL ? "text-black" : "text-gray-400"}`} />
                </button>
              </div>

              {/* Page Turn On Scroll */}
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <MousePointer size={16} className={pageTurnOnScroll ? "text-white" : "text-gray-400"} />
                  <span className="text-sm">Scroll Turn</span>
                </div>
                <button
                  onClick={togglePageTurnOnScroll}
                  className="w-12 h-6 rounded-full relative bg-gray-700 flex items-center px-1"
                >
                  <div className={`w-4 h-4 rounded-full bg-white absolute transition-all ${pageTurnOnScroll ? "translate-x-6" : "translate-x-0"}`} />
                  <Ban size={12} className="ml-0.5 mr-auto" />
                </button>
              </div>

              {/* Swipeable */}
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Pointer size={16} className={swipeable ? "text-white" : "text-gray-400"} />
                  <span className="text-sm">Swipe</span>
                </div>
                <button
                  onClick={toggleSwipeable}
                  className="w-12 h-6 rounded-full relative bg-gray-700 flex items-center px-1"
                >
                  <div className={`w-4 h-4 rounded-full bg-white absolute transition-all ${swipeable ? "translate-x-6" : "translate-x-0"}`} />
                  <PointerOff size={12} className="ml-0.5 mr-auto" />
                </button>
              </div>

              {/* Disable Context Menu */}
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Menu size={16} className={disableContextMenu ? "text-gray-400" : "text-white"} />
                  <span className="text-sm">Context Menu</span>
                </div>
                <button
                  onClick={toggleDisableContextMenu}
                  className="w-12 h-6 rounded-full relative bg-gray-700 flex items-center px-1"
                >
                  <div className={`w-4 h-4 rounded-full bg-white absolute transition-all ${!disableContextMenu ? "translate-x-6" : "translate-x-0"}`} />
                  <Ban size={12} className="ml-0.5 mr-auto" />
                </button>
              </div>

              {/* Show Download Button */}
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Download size={16} className={showDownload ? "text-white" : "text-gray-400"} />
                  <span className="text-sm">Download Button</span>
                </div>
                <button
                  onClick={toggleShowDownload}
                  className="w-12 h-6 rounded-full relative bg-gray-700 flex items-center px-1"
                >
                  <div className={`w-4 h-4 rounded-full bg-white absolute transition-all ${showDownload ? "translate-x-6" : "translate-x-0"}`} />
                  <Ban size={12} className="ml-0.5 mr-auto" />
                </button>
              </div>

              {/* Show Fullscreen Button */}
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Maximize size={16} className={showFullscreen ? "text-white" : "text-gray-400"} />
                  <span className="text-sm">Fullscreen Button</span>
                </div>
                <button
                  onClick={toggleShowFullscreen}
                  className="w-12 h-6 rounded-full relative bg-gray-700 flex items-center px-1"
                >
                  <div className={`w-4 h-4 rounded-full bg-white absolute transition-all ${showFullscreen ? "translate-x-6" : "translate-x-0"}`} />
                  <Ban size={12} className="ml-0.5 mr-auto" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default EPUBReader;
