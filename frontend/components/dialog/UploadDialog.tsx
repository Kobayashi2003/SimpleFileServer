import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { X, Upload } from "lucide-react";

interface FileUploadProgress {
  id: string;
  name: string;
  progress: number;
  size: number;
  status: 'pending' | 'uploading' | 'completed' | 'error';
  error?: string;
}

interface UploadDialogProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  files: FileUploadProgress[];
  onCancel: (fileId: string) => void;
  onCancelAll: () => void;
  removeTask: (fileId: string) => void;
  className?: string;
}

export function UploadDialog({
  open,
  setOpen,
  files,
  onCancel,
  onCancelAll,
  removeTask,
  className
}: UploadDialogProps) {
  const hasErrors = files.some(file => file.status === 'error');
  const allCompleted = files.every(file => file.status === 'completed');
  const totalProgress = files.length > 0
    ? files.reduce((sum, file) => sum + file.progress, 0) / files.length
    : 0;

  // Auto close dialog when all files are uploaded
  useEffect(() => {
    if (allCompleted && files.length > 0) {
      const timer = setTimeout(() => {
        setOpen(false);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [allCompleted, files.length, setOpen]);

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className={cn(
        "bg-black/80 border-white/10",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        "data-[state=closed]:slide-out-to-bottom-1/2 data-[state=open]:slide-in-from-bottom-1/2",
        "sm:max-w-md",
        className
      )}>
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <Upload className="h-5 w-5" />
            UPLOADING
          </DialogTitle>
          <DialogDescription className="text-white/60">
            {files.length} {files.length === 1 ? 'file' : 'files'} - {Math.round(totalProgress)}% completed
          </DialogDescription>
        </DialogHeader>

        <div className="w-full bg-white/10 h-1 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all duration-300 ease-in-out"
            style={{ width: `${totalProgress}%` }}
          />
        </div>

        <ScrollArea className="h-[200px] pr-4">
          <div className="space-y-2">
            {files.map((file) => (
              <div key={file.id} className="flex flex-col space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-white truncate max-w-[200px]" title={file.name}>
                    {file.name}
                  </span>
                  <div className="flex items-center space-x-2">
                    <span className="text-xs text-white/60">{formatSize(file.size)}</span>
                    {file.status !== 'completed' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 rounded-full"
                        onClick={() => onCancel(file.id)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>
                <div className="w-full bg-white/10 h-1 rounded-full overflow-hidden">
                  <div
                    className={cn(
                      "h-full transition-all duration-300 ease-in-out",
                      file.status === 'completed' ? "bg-green-500" :
                        file.status === 'error' ? "bg-red-500" :
                          "bg-blue-500"
                    )}
                    style={{ width: `${file.progress}%` }}
                  />
                </div>
                {file.status === 'error' && (
                  <p className="text-xs text-red-400">
                    {file.error || 'Error uploading'}&nbsp;
                    <Button
                      variant="link"
                      size="sm"
                      className="text-xs text-red-400 p-0 h-auto hover:text-red-300"
                      onClick={() => removeTask(file.id)}
                    >
                      Remove Task
                    </Button>
                  </p>
                )}
                {file.status === 'completed' && (
                  <p className="text-xs text-green-400">
                    Upload completed&nbsp;
                    <Button
                      variant="link"
                      size="sm"
                      className="text-xs text-red-400 p-0 h-auto ml-2 hover:text-red-300"
                      onClick={() => removeTask(file.id)}
                    >
                      Remove Task
                    </Button>
                  </p>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>

        <DialogFooter>
          {!allCompleted && (
            <Button
              variant="outline"
              onClick={onCancelAll}
              className="text-black/60 hover:text-red-500 hover:bg-red-500/10"
            >
              Cancel all
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            className="text-black/60 hover:text-black hover:bg-white/10"
          >
            {allCompleted ? 'Close' : 'Accept'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
} 