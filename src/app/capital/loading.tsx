export default function CapitalLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 h-10 w-24 animate-pulse rounded bg-white/10" />
      <section className="rounded-xl border border-cyan-500/30 bg-black/50 p-6">
        <div className="mb-6 h-8 w-56 animate-pulse rounded bg-white/10" />
        <div className="flex min-h-[200px] items-center justify-center text-white/50">
          <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-cyan-500/30 border-t-cyan-400" />
          <span className="ml-2 text-sm">Loading capital history...</span>
        </div>
      </section>
    </div>
  );
}
