'use client';

import { createContext, useContext, useState } from 'react';

interface BotContextType {
  isBotActive: boolean;
  toggleBot: () => void;
}

const BotContext = createContext<BotContextType | null>(null);

export function BotProvider({ children }: { children: React.ReactNode }) {
  const [isBotActive, setBotActive] = useState(false);

  const toggleBot = () => setBotActive((prev) => !prev);

  return (
    <BotContext.Provider value={{ isBotActive, toggleBot }}>
      {children}
    </BotContext.Provider>
  );
}

export function useBotContext() {
  const ctx = useContext(BotContext);
  if (!ctx) throw new Error('useBotContext must be used within BotProvider');
  return ctx;
}
