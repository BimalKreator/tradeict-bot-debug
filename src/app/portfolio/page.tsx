'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { TradeHistoryTable } from '@/components/portfolio/TradeHistoryTable';

export default function PortfolioPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center gap-4">
        <Link
          href="/"
          className="flex items-center gap-2 text-white/70 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
      </div>
      <section className="rounded-xl border border-cyan-500/30 bg-black/50 p-6">
        <h1 className="mb-6 text-2xl font-semibold text-white">Trade History</h1>
        <TradeHistoryTable />
      </section>
    </div>
  );
}
