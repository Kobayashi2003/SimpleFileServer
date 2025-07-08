import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}


export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function getPreviewType(mimeType: string) {

  const mainType = mimeType.split('/')[0];

  switch (mainType) {
    case 'image':
    case 'video':
    case 'audio':
    case 'text':
      return mainType;
    case 'application':
      if (mimeType === 'application/pdf') {
        return 'pdf';
      } else if (mimeType === 'application/epub+zip') {
        return 'epub';
      } else if (mimeType === 'application/cbz' || mimeType === 'application/cbr') {
        return 'comic';
      } 
    default:
      return 'other'
  }
}