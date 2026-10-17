'use client';

import { VerdictTheater, type TheaterAnswer, type TheaterVerdict } from '@/components/VerdictTheater';

const ANSWERS: TheaterAnswer[] = [
  { responseIndex: 0, responder: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', answer: '85 KES per kg' },
  { responseIndex: 1, responder: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', answer: '85 KES per kg' },
  { responseIndex: 2, responder: '0x90F79bf6EB2c4f870365E785982E1f101E93b906', answer: '250 KES per kg' },
];

const VERDICT: TheaterVerdict = {
  paid: new Set([ANSWERS[0].responder.toLowerCase(), ANSWERS[1].responder.toLowerCase()]),
  confidenceBps: 6667,
  forced: false,
  settleTxHash: null,
  summary: 'Two independent contributors reported the same price; the third disagreed and was not paid.',
};

/** Landing-page preview. Explicitly sample data; never shown as real activity. */
export function SampleTheater() {
  return (
    <div className="relative">
      <span className="absolute -top-3 left-5 z-10 rounded-full border border-linestrong bg-obsidian px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
        Sample data
      </span>
      <VerdictTheater answers={ANSWERS} verdict={VERDICT} rewardPerResponse="16666" net={null} />
    </div>
  );
}
