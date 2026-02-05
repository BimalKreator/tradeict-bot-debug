'use client';

import { useState } from 'react';
import { LayoutDashboard, Wallet, Search, History } from 'lucide-react';
import { clsx } from 'clsx';

type NavItem = 'dashboard' | 'portfolio' | 'screener' | 'history';

const items: { id: NavItem; icon: typeof LayoutDashboard; label: string }[] = [
  { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { id: 'portfolio', icon: Wallet, label: 'Portfolio' },
  { id: 'screener', icon: Search, label: 'Screener' },
  { id: 'history', icon: History, label: 'History' },
];

export function MobileNav() {
  const [active, setActive] = useState<NavItem>('dashboard');

  return (
    <nav className="glass fixed bottom-0 left-0 right-0 z-50 flex h-16 items-center justify-around border-t border-white/10 md:hidden">
      {items.map(({ id, icon: Icon, label }) => (
        <button
          key={id}
          type="button"
          onClick={() => setActive(id)}
          className={clsx(
            'flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-1 px-4 py-2 transition-transform active:scale-95 md:hover:opacity-80',
            active === id ? 'text-[#00d4ff]' : 'text-white/70'
          )}
        >
          <Icon className="h-5 w-5" />
          <span className="text-xs font-medium">{label}</span>
        </button>
      ))}
    </nav>
  );
}
