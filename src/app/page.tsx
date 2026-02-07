'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import { LayoutDashboard, Wallet, Settings, Banknote } from 'lucide-react';
import { clsx } from 'clsx';
import { MobileSystemStatus, StatsGrid, FundingCountdown } from '../components/dashboard';
import { SettingsPanel } from '../components/settings';

const LivePositionsPanel = dynamic(
  () => import('../components/positions/LivePositionsPanel').then((m) => m.LivePositionsPanel),
  { ssr: false }
);

const FundingTable = dynamic(
  () => import('../components/screener/FundingTable').then((m) => m.default),
  { ssr: false }
);

type Tab = 'dashboard' | 'portfolio' | 'capital' | 'settings';

const tabs: { id: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'portfolio', label: 'Portfolio', icon: Wallet },
  { id: 'capital', label: 'Capital', icon: Banknote },
  { id: 'settings', label: 'Settings', icon: Settings },
];

type SettingsState = {
  auto_entry_enabled?: number;
  auto_exit_enabled?: number;
  manual_trading_enabled?: number;
};

export default function Home() {
  const pathname = usePathname();
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [settings, setSettings] = useState<SettingsState>({});

  useEffect(() => {
    let cancelled = false;
    fetch('/api/settings')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setSettings(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const isDashboard = pathname === '/';

  return (
    <div className="min-h-screen bg-cyber-black text-white">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Tab bar: Dashboard | Portfolio | Capital | Settings — use Link for instant prefetch */}
        <div className="mb-6 flex gap-1 rounded-xl border border-cyan-500/30 bg-black/50 p-1">
          {tabs.map(({ id, label, icon: Icon }) => {
            const isActive =
              id === 'dashboard' ? isDashboard && activeTab === 'dashboard'
              : id === 'portfolio' ? pathname === '/portfolio'
              : id === 'capital' ? pathname === '/capital'
              : activeTab === id;
            const href = id === 'portfolio' ? '/portfolio' : id === 'capital' ? '/capital' : null;
            if (href) {
              return (
                <Link
                  key={id}
                  href={href}
                  prefetch={true}
                  className={clsx(
                    'flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                    isActive ? 'bg-cyan-500/20 text-cyan-400' : 'text-white/70 hover:text-white'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              );
            }
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={clsx(
                  'flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                  isActive ? 'bg-cyan-500/20 text-cyan-400' : 'text-white/70 hover:text-white'
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            );
          })}
        </div>

        {/* Mobile System Status - visible only on mobile */}
        <div className="mb-6 md:hidden">
          <MobileSystemStatus />
        </div>

        {activeTab === 'dashboard' && (
          <>
            <section className="mb-8">
              <StatsGrid />
            </section>
            <section className="mb-8">
              <h2 className="mb-4 text-xl font-semibold text-white">Live Activity</h2>
              <LivePositionsPanel autoExitEnabled={(settings.auto_exit_enabled ?? 1) === 1} />
            </section>
            <section>
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-xl font-semibold text-white">
                  Arbitrage Opportunities
                </h2>
                <FundingCountdown />
              </div>
              <FundingTable />
            </section>
          </>
        )}

        {activeTab === 'portfolio' && (
          <section className="rounded-xl border border-cyan-500/30 bg-black/50 p-6">
            <h2 className="mb-4 text-xl font-semibold text-white">Portfolio</h2>
            <p className="text-white/70">Loading portfolio...</p>
          </section>
        )}

        {activeTab === 'settings' && (
          <section>
            <h2 className="mb-4 text-xl font-semibold text-white">Settings</h2>
            <SettingsPanel />
          </section>
        )}
      </div>
    </div>
  );
}
