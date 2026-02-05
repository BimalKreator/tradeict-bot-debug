export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { LocalScheduler } = await import('./lib/scheduler/simple-scheduler');
    const { init } = await import('./lib/state/global-state');
    const { addNotification } = await import('./lib/db/notifications');
    const { syncOpenTradesToActive } = await import('./lib/db/active-trades');
    init();
    syncOpenTradesToActive();
    LocalScheduler.getInstance().start();
    addNotification('INFO', 'Bot Started');
  }
}
