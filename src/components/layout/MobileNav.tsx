'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { LayoutDashboard, Wallet, Search, History, Banknote } from 'lucide-react';
import { clsx } from 'clsx';

const items: { id: string; icon: typeof LayoutDashboard; label: string; href: string }[] = [
  { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard', href: '/' },
  { id: 'portfolio', icon: Wallet, label: 'Portfolio', href: '/portfolio' },
  { id: 'capital', icon: Banknote, label: 'Capital', href: '/capital' },
  { id: 'screener', icon: Search, label: 'Screener', href: '/' },
  { id: 'history', icon: History, label: 'History', href: '/' },
];

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="glass fixed bottom-0 left-0 right-0 z-50 flex h-16 items-center justify-around border-t border-white/10 md:hidden">
      {items.map(({ id, icon: Icon, label, href }) => {
        const isActive =
          (id === 'dashboard' && pathname === '/') ||
          (id !== 'dashboard' && pathname === href);

        return (
          <Link
            key={id}
            href={href}
            className={clsx(
              'flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-1 px-4 py-2 transition-transform active:scale-95 md:hover:opacity-80',
              isActive ? 'text-[#00d4ff]' : 'text-white/70'
            )}
          >
            <Icon className="h-5 w-5" />
            <span className="text-xs font-medium">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
