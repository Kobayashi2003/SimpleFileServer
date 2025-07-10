import React, { useState, useRef, useEffect, forwardRef, useImperativeHandle, ReactNode } from 'react';
import { MousePointerClick } from 'lucide-react';

interface DirectionMenuProps {
  topNode: ReactNode;
  rightNode: ReactNode;
  bottomNode: ReactNode;
  leftNode: ReactNode;
  onTopAction: () => void;
  onRightAction: () => void;
  onBottomAction: () => void;
  onLeftAction: () => void;
  centerLabel?: string;
  onVisibilityChange?: (visible: boolean) => void;
}

export interface DirectionMenuHandle {
  showAt: (x: number, y: number) => void;
}

export const DirectionMenu = forwardRef<DirectionMenuHandle, DirectionMenuProps>(({
  topNode,
  rightNode,
  bottomNode,
  leftNode,
  onTopAction,
  onRightAction,
  onBottomAction,
  onLeftAction,
  centerLabel = "Menu",
  onVisibilityChange
}, ref) => {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const [selectedDirection, setSelectedDirection] = useState<'top' | 'right' | 'bottom' | 'left' | null>(null);
  const selectedDirectionRef = useRef<'top' | 'right' | 'bottom' | 'left' | null>(null);
  const updateSelectedDirection = (direction: 'top' | 'right' | 'bottom' | 'left' | null) => {
    setSelectedDirection(direction);
    selectedDirectionRef.current = direction;
  };

  const startPosition = useRef({ x: 0, y: 0 });
  const isMouseDown = useRef(false);

  const menuRef = useRef<HTMLDivElement>(null);
  const visibleTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);


  // Distance threshold to activate a direction - reduced from 60 to 30 for easier activation
  const THRESHOLD = 30;

  useImperativeHandle(ref, () => ({
    showAt: (x: number, y: number) => {
      setPosition({ x, y });
      setIsVisible(true);
    }
  }));

  // Add effect to call onVisibilityChange when isVisible changes
  useEffect(() => {
    onVisibilityChange?.(isVisible);
  }, [isVisible, onVisibilityChange]);

  const handleRightMouseDown = (e: MouseEvent) => {
    if (e.button !== 2) return;

    isMouseDown.current = true;
    startPosition.current = { x: e.clientX, y: e.clientY };
    visibleTimeoutRef.current = setTimeout(() => {
      e.preventDefault(); // Only prevent default after the timeout
      setPosition({
        x: e.clientX - 100, // 100 is half the width of the menu (200px)
        y: e.clientY - 100  // 100 is half the height of the menu (200px)
      });
      setIsVisible(true);
    }, 300); // 300ms delay to detect long press
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isVisible) return;

    e.preventDefault(); // Prevent default only when menu is visible
    const dx = e.clientX - startPosition.current.x;
    const dy = e.clientY - startPosition.current.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > THRESHOLD) {
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;

      if (angle > -45 && angle <= 45) {
        updateSelectedDirection('right');
      } else if (angle > 45 && angle <= 135) {
        updateSelectedDirection('bottom');
      } else if (angle > 135 || angle <= -135) {
        updateSelectedDirection('left');
      } else {
        updateSelectedDirection('top');
      }
    } else {
      updateSelectedDirection(null);
    }
  };

  const handleRightMouseUp = (e: MouseEvent) => {
    if (e.button !== 2) return;

    // Clear the timeout if it exists
    if (visibleTimeoutRef.current) {
      clearTimeout(visibleTimeoutRef.current);
      visibleTimeoutRef.current = null;
    }

    // If menu was not shown, don't prevent default behavior
    if (!isVisible) {
      isMouseDown.current = false;
      return;
    }

    e.preventDefault(); // Prevent default only if menu was shown

    const currentDirection = selectedDirectionRef.current;

    if (currentDirection) {
      switch (currentDirection) {
        case 'left':
          onLeftAction();
          break;
        case 'top':
          onTopAction();
          break;
        case 'right':
          onRightAction();
          break;
        case 'bottom':
          onBottomAction();
          break;
        default:
          break;
      }
    }

    closeTimeoutRef.current = setTimeout(() => {
      setIsVisible(false);
      updateSelectedDirection(null);
      isMouseDown.current = false;
    }, 100);
  };

  useEffect(() => {
    document.addEventListener('mousedown', handleRightMouseDown);

    return () => {
      document.removeEventListener('mousedown', handleRightMouseDown);
    };
  }, []);

  useEffect(() => {
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleRightMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleRightMouseUp);
    };
  }, [isVisible]);

  if (!isVisible) return null;

  return (
    <>
      {/* Overlay to capture all mouse events */}
      <div
        className="fixed inset-0 z-40"
        onClick={() => setIsVisible(false)}
      />

      {/* Menu */}
      <div
        ref={menuRef}
        className="fixed z-50"
        style={{
          left: position.x,
          top: position.y,
        }}
      >
        <div className="w-[200px] h-[200px] rounded-full bg-black/70  flex items-center justify-center relative">
          {/* Center point */}
          <div className="w-12 h-12 rounded-full bg-white bg-opacity-80 flex items-center justify-center z-10 select-none">
            <span className="text-xs font-semibold">{centerLabel}</span>
          </div>

          {/* Top */}
          <div
            className={`absolute top-4 left-1/2 -translate-x-1/2 flex flex-col items-center ${selectedDirection === 'top' ? 'scale-125 text-blue-500' : 'text-white'}`}
          >
            {topNode}
          </div>

          {/* Right */}
          <div
            className={`absolute right-4 top-1/2 -translate-y-1/2 flex flex-col items-center ${selectedDirection === 'right' ? 'scale-125 text-blue-500' : 'text-white'}`}
          >
            {rightNode}
          </div>

          {/* Bottom */}
          <div
            className={`absolute bottom-4 left-1/2 -translate-x-1/2 flex flex-col items-center ${selectedDirection === 'bottom' ? 'scale-125 text-yellow-500' : 'text-white'}`}
          >
            {bottomNode}
          </div>

          {/* Left */}
          <div
            className={`absolute left-4 top-1/2 -translate-y-1/2 flex flex-col items-center ${selectedDirection === 'left' ? 'scale-125 text-blue-500' : 'text-white'}`}
          >
            {leftNode}
          </div>
        </div>
      </div>
    </>
  );
});

// Add a component to show a hint about the right-click gesture
export const DirectionMenuHint: React.FC = () => {
  return (
    <div className="fixed bottom-4 right-4 bg-black/70 text-white px-3 py-2 rounded-full flex items-center text-xs gap-2 z-40 pointer-events-none">
      <MousePointerClick size={14} />
      <span>Right-click + hold for menu options</span>
    </div>
  );
};

export default DirectionMenu; 