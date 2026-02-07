'use client';

import Image from 'next/image';
import { Menu, Bot } from 'lucide-react';
import { clsx } from 'clsx';
import { useBotContext } from '../../context/BotContext';
import { NotificationBell } from './NotificationBell';

export function Header() {
  const { isBotActive, toggleBot } = useBotContext();

  return (
    <header className="glass fixed left-0 right-0 top-0 z-50 flex h-16 items-center justify-between px-4">
      {/* Left: Logo */}
      <Image
        src="/logo.png"
        alt="Tradeict Earner"
        width={150}
        height={50}
        className="h-[50px] w-auto max-h-[38px] md:max-h-none md:h-[50px] object-contain"
      />

      {/* Center: LIVE SYSTEM badge - hidden on mobile, reflects bot state */}
      <div className="absolute left-1/2 hidden -translate-x-1/2 md:flex md:items-center md:gap-2">
        <span className="relative flex h-2 w-2">
          {isBotActive && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#10b981] opacity-75" />
          )}
          <span
            className={clsx(
              'relative inline-flex h-2 w-2 rounded-full',
              isBotActive ? 'bg-[#10b981]' : 'bg-red-500'
            )}
          />
        </span>
        <span
          className={clsx(
            'text-sm font-medium',
            isBotActive ? 'text-[#10b981]' : 'text-red-500'
          )}
        >
          LIVE SYSTEM
        </span>
      </div>

      {/* Right: Notifications + Bot Toggle + Mobile Menu */}
      <div className="flex items-center gap-3">
        <NotificationBell />
        {/* Desktop Bot Toggle - hidden on mobile when we show menu, or always show */}
        <button
          type="button"
          onClick={toggleBot}
          className={clsx(
            'hidden min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors md:flex md:hover:opacity-90',
            isBotActive
              ? 'bg-[#10b981] text-black'
              : 'bg-red-600 text-white'
          )}
        >
          <Bot className="h-4 w-4" />
          {isBotActive ? 'Active' : 'Offline'}
        </button>

        {/* Mobile Menu Icon - min 44x44 touch target */}
        <button
          type="button"
          className="flex min-h-[44px] min-w-[44px] items-center justify-center text-white/90 active:scale-95 md:hidden md:hover:text-white"
          aria-label="Open menu"
        >
          <Menu className="h-6 w-6" />
        </button>
      </div>
    </header>
  );
}
