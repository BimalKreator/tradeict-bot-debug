'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { clsx } from 'clsx';

type Settings = {
  auto_entry_enabled?: number;
  auto_exit_enabled?: number;
  manual_trading_enabled?: number;
  max_capital_percent?: number;
  min_spread_percent?: number;
  leverage?: number;
  liquidation_buffer?: number;
  negative_funding_exit?: number;
  mtm_stoploss_enabled?: number;
  mtm_stoploss_percent?: number;
};

const defaultSettings: Settings = {
  auto_entry_enabled: 1,
  auto_exit_enabled: 1,
  manual_trading_enabled: 1,
  max_capital_percent: 25,
  min_spread_percent: 0.075,
  leverage: 1,
  liquidation_buffer: 30,
  negative_funding_exit: 1,
  mtm_stoploss_enabled: 1,
  mtm_stoploss_percent: 0.5,
};

const panelClass =
  'glass rounded-xl border border-cyan-500/30 bg-black/50 p-4 sm:p-6';

function useDebouncedSave(ms: number) {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const save = useCallback(
    async (payload: Partial<Settings>) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(async () => {
        try {
          await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
        } finally {
          timeoutRef.current = null;
        }
      }, ms);
    },
    [ms]
  );
  return save;
}

export function SettingsPanel() {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const saveImmediate = useCallback(async (payload: Partial<Settings>) => {
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      // ignore
    }
  }, []);
  const saveDebounced = useDebouncedSave(400);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/settings');
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setSettings((prev) => ({ ...prev, ...data }));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback(
    (key: keyof Settings, value: number | undefined, debounce = false) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
      if (debounce) saveDebounced({ [key]: value });
      else saveImmediate({ [key]: value });
    },
    [saveDebounced, saveImmediate]
  );

  if (loading) {
    return (
      <div className={panelClass}>
        <p className="text-white/70">Loading settings…</p>
      </div>
    );
  }

  const autoEntry = (settings.auto_entry_enabled ?? 1) === 1;
  const autoExit = (settings.auto_exit_enabled ?? 1) === 1;
  const manualTrading = (settings.manual_trading_enabled ?? 1) === 1;

  return (
    <div className="space-y-6">
      {/* Section 1: Master Controls */}
      <section className={panelClass}>
        <h3 className="mb-4 text-lg font-semibold text-white">Master Controls</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-medium text-white">Auto Entry</p>
              <p className="text-sm text-white/70">
                {autoEntry
                  ? 'Bot scans & enters automatically'
                  : 'Manual entry only'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoEntry}
              onClick={() =>
                update('auto_entry_enabled', autoEntry ? 0 : 1)
              }
              className={clsx(
                'relative h-8 w-14 shrink-0 rounded-full transition-colors',
                autoEntry ? 'bg-[#10b981]' : 'bg-white/20'
              )}
            >
              <span
                className={clsx(
                  'absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-transform',
                  autoEntry ? 'left-7' : 'left-1'
                )}
              />
            </button>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-medium text-white">Auto Exit</p>
              <p className="text-sm text-white/70">
                {autoExit
                  ? 'Bot manages exits & risk automatically'
                  : 'Manual exit only'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoExit}
              onClick={() => update('auto_exit_enabled', autoExit ? 0 : 1)}
              className={clsx(
                'relative h-8 w-14 shrink-0 rounded-full transition-colors',
                autoExit ? 'bg-[#10b981]' : 'bg-white/20'
              )}
            >
              <span
                className={clsx(
                  'absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-transform',
                  autoExit ? 'left-7' : 'left-1'
                )}
              />
            </button>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-medium text-white">Manual Trading</p>
              <p className="text-sm text-white/70">
                {manualTrading ? 'Enable manual trades from dashboard' : 'All manual trades disabled'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={manualTrading}
              onClick={() => update('manual_trading_enabled', manualTrading ? 0 : 1)}
              className={clsx(
                'relative h-8 w-14 shrink-0 rounded-full transition-colors',
                manualTrading ? 'bg-[#10b981]' : 'bg-white/20'
              )}
            >
              <span
                className={clsx(
                  'absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-transform',
                  manualTrading ? 'left-7' : 'left-1'
                )}
              />
            </button>
          </div>
        </div>
      </section>

      {/* Section 2: Capital & Entry */}
      <section
        className={clsx(
          panelClass,
          !autoEntry && 'pointer-events-none opacity-50'
        )}
      >
        <h3 className="mb-4 text-lg font-semibold text-white">
          Capital & Entry
        </h3>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-white/80">
              Max Capital (%)
            </label>
            <input
              type="range"
              min={10}
              max={50}
              step={1}
              value={settings.max_capital_percent ?? 25}
              onChange={(e) =>
                update(
                  'max_capital_percent',
                  Number(e.target.value),
                  true
                )
              }
              className="w-full accent-cyan-500"
            />
            <span className="text-sm text-white/70">
              {settings.max_capital_percent ?? 25}%
            </span>
          </div>
          <div>
            <label className="mb-1 block text-sm text-white/80">
              Min Spread (%)
            </label>
            <input
              type="number"
              min={0}
              step={0.001}
              value={settings.min_spread_percent ?? 0.075}
              onChange={(e) =>
                update('min_spread_percent', Number(e.target.value), true)
              }
              className="w-full rounded-lg border border-white/20 bg-black/50 px-3 py-2 text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-white/80">
              Leverage
            </label>
            <select
              value={settings.leverage ?? 1}
              onChange={(e) =>
                update('leverage', Number(e.target.value))
              }
              className="w-full rounded-lg border border-white/20 bg-black/50 px-3 py-2 text-white"
            >
              <option value={1}>1x</option>
              <option value={2}>2x</option>
              <option value={3}>3x</option>
            </select>
          </div>
        </div>
      </section>

      {/* Section 3: Exit Configuration */}
      <section
        className={clsx(
          panelClass,
          !autoExit && 'pointer-events-none opacity-50'
        )}
      >
        <h3 className="mb-4 text-lg font-semibold text-white">
          Exit Configuration
        </h3>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-white/80">
              Liquidation Buffer (%)
            </label>
            <input
              type="number"
              min={0}
              step={0.1}
              value={settings.liquidation_buffer ?? 30}
              onChange={(e) =>
                update('liquidation_buffer', Number(e.target.value), true)
              }
              className="w-full rounded-lg border border-white/20 bg-black/50 px-3 py-2 text-white"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={(settings.negative_funding_exit ?? 1) === 1}
              onChange={(e) =>
                update('negative_funding_exit', e.target.checked ? 1 : 0)
              }
              className="h-4 w-4 accent-cyan-500"
            />
            <span className="text-white/90">Negative Funding Exit</span>
          </label>
          <div className="space-y-2">
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={(settings.mtm_stoploss_enabled ?? 1) === 1}
                onChange={(e) =>
                  update('mtm_stoploss_enabled', e.target.checked ? 1 : 0)
                }
                className="h-4 w-4 accent-cyan-500"
              />
              <span className="text-white/90">MTM Stoploss</span>
            </label>
            <div className="pl-7">
              <input
                type="number"
                min={0}
                step={0.1}
                value={settings.mtm_stoploss_percent ?? 0.5}
                onChange={(e) =>
                  update('mtm_stoploss_percent', Number(e.target.value), true)
                }
                className="w-full max-w-[120px] rounded-lg border border-white/20 bg-black/50 px-3 py-2 text-white"
              />
              <span className="ml-2 text-sm text-white/70">%</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
