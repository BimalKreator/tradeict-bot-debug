import { toast as sonnerToast } from 'sonner';

const TOAST_STYLES = {
  success: {
    style: {
      background: '#0a0a0f',
      border: '1px solid #10b981',
      color: 'white',
    },
  },
  error: {
    style: {
      background: '#0a0a0f',
      border: '1px solid #ef4444',
      color: 'white',
    },
  },
  info: {
    style: {
      background: '#0a0a0f',
      border: '1px solid #00d4ff',
      color: 'white',
    },
  },
} as const;

export function showToast(
  message: string,
  type: 'success' | 'error' | 'info' = 'info',
  options?: { duration?: number; persistent?: boolean }
) {
  const opts = {
    duration: options?.persistent ? Infinity : options?.duration ?? 4000,
    style: TOAST_STYLES[type].style,
  };

  switch (type) {
    case 'success':
      return sonnerToast.success(message, opts);
    case 'error':
      return sonnerToast.error(message, opts);
    default:
      return sonnerToast(message, opts);
  }
}
