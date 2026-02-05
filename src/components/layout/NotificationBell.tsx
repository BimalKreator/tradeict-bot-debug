'use client';

import { useState, useEffect, useRef } from 'react';
import { Bell, Check, Info, AlertTriangle, XCircle } from 'lucide-react';
import { clsx } from 'clsx';

interface NotificationItem {
  id: number;
  type: string;
  message: string;
  created_at: string;
  is_read: number;
}

function getTypeStyles(type: string): { icon: typeof Info; border: string } {
  switch (type) {
    case 'SUCCESS':
      return { icon: Check, border: 'border-l-emerald-500' };
    case 'ERROR':
      return { icon: XCircle, border: 'border-l-red-500' };
    case 'WARNING':
      return { icon: AlertTriangle, border: 'border-l-amber-500' };
    default:
      return { icon: Info, border: 'border-l-blue-500' };
  }
}

function formatRelativeTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diffMs = now - d.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);

    if (diffSec < 60) return 'Just now';
    if (diffMin < 60) return `${diffMin} min${diffMin === 1 ? '' : 's'} ago`;
    if (diffHour < 24) return `${diffHour} hour${diffHour === 1 ? '' : 's'} ago`;
    return d.toLocaleDateString();
  } catch {
    return iso;
  }
}

export function NotificationBell() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = async () => {
    try {
      const res = await fetch('/api/notifications');
      if (res.ok) {
        const data = await res.json();
        const items = Array.isArray(data) ? data : [];
        setNotifications(items);
        const unread = items.filter((n: NotificationItem) => n.is_read === 0).length;
        setUnreadCount(unread);
      }
    } catch {
      setNotifications([]);
      setUnreadCount(0);
    }
  };

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const markAllRead = async () => {
    try {
      await fetch('/api/notifications/mark-read', { method: 'POST' });
      setUnreadCount(0);
      await fetchNotifications();
    } catch {
      // ignore
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        className="relative flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-white/90 transition-colors hover:text-white md:min-h-[40px] md:min-w-[40px]"
        aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : 'Notifications'}
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-bold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[340px] overflow-hidden rounded-xl border border-cyan-500/30 bg-cyber-slate shadow-xl md:w-[380px]">
          <div className="flex items-center justify-between border-b border-white/10 bg-black/30 px-4 py-3">
            <span className="font-semibold text-white">Notifications</span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="text-xs font-medium text-cyan-400 transition-colors hover:text-cyan-300"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-[320px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-white/50">
                No notifications yet
              </div>
            ) : (
              notifications.map((n) => {
                const { icon: Icon, border } = getTypeStyles(n.type);
                return (
                  <div
                    key={n.id}
                    className={clsx(
                      'flex gap-3 border-l-4 px-4 py-3',
                      border,
                      n.is_read === 0 ? 'bg-white/5' : ''
                    )}
                  >
                    <Icon
                      className={clsx(
                        'mt-0.5 h-4 w-4 shrink-0',
                        n.type === 'SUCCESS' && 'text-emerald-400',
                        n.type === 'ERROR' && 'text-red-400',
                        n.type === 'WARNING' && 'text-amber-400',
                        n.type === 'INFO' && 'text-blue-400'
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-white/90">{n.message}</p>
                      <p className="mt-1 text-xs text-white/50">
                        {formatRelativeTime(n.created_at)}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
