'use client';

import { Activity } from 'lucide-react';
import { useBotContext } from '../../context/BotContext';

export function MobileSystemStatus() {
  const { isBotActive } = useBotContext();

  return (
    <div className="glass flex items-center justify-between rounded-xl p-4 md:hidden">
      <div className="flex items-center gap-3">
        <Activity className="h-5 w-5 text-white/70" />
        <span className="text-sm font-medium text-white/90">System Status</span>
      </div>
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${isBotActive ? 'bg-[#10b981]' : 'bg-red-500'}`}
        />
        <span className={`text-sm font-semibold ${isBotActive ? 'text-[#10b981]' : 'text-red-500'}`}>
          {isBotActive ? 'Online' : 'Offline'}
        </span>
      </div>
    </div>
  );
}
