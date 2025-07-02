export interface FileData {
  name: string;
  path: string;
  size: number;
  mtime: string;
  isDirectory: boolean;
  mimeType?: string;
  cover?: string;
} 