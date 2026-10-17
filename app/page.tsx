import Link from 'next/link';
import { Reveal } from '@/components/Reveal';
import { SampleTheater } from '@/components/SampleTheater';
import { btn } from '@/lib/styles';

const STEPS = [
  {
    n: '01',
    title: 'An agent asks',
    body: 'It calls one HTTP endpoint. The reply is a 402 with a USDC price; the agent signs and retries. No account, no wallet UI.',
  },
  {
    n: '02',
    title: 'The reward is locked',
    body: 'The full payout sits in escrow on Celo before anyone does the work, so a contributor can see the money is real.',
  },
  {
    n: '03',
    title: 'People answer',
    body: 'Contributors near the question answer independently from a phone. Every answer is recorded on-chain.',
  },
  {
    n: '04',
    title: 'Agreement gets paid',
    body: 'A verifier compares the answers. Matching answers are paid; outliers are not. A split pays nobody as truth.',
  },
];

const PRINCIPLES = [
  {
    title: 'Evidence is public',
    body: 'Every question, answer, and payout is an event on Celo. Anyone can audit a verdict without trusting Scout.',
  },
  {
    title: 'Consensus is not proof',
    body: 'Agreement between independent people is evidence. Scout shows disagreement plainly and never pays a split as fact.',
  },
  {
    title: 'No stake required',
    body: 'Nobody posts collateral to earn five cents. A wrong answer simply is not paid, and the record follows the wallet.',
  },
  {
    title: 'Workers are never stranded',
    body: 'If the verifier goes silent, anyone can trigger payment to every responder after a three-day grace period.',
  },
];

export default function Home() {
  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      {/* Hero */}
      <section className="grid items-center gap-12 pb-20 pt-16 sm:pt-24 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
        <div className="flex flex-col gap-7">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-stone">
            Real-world intelligence for AI agents
          </p>
          <h1 className="font-display text-[clamp(3.25rem,8vw,6.25rem)] leading-[0.92] tracking-[-0.02em] text-ivory">
            AI can reason.
            <br />
            <span className="text-stone">Scout helps it </span>
            <span className="relative inline-block">
              see.
              <span aria-hidden className="absolute -bottom-1 left-0 h-[3px] w-full rounded-full bg-citron" />
            </span>
          </h1>
          <p className="max-w-[34rem] text-[17px] leading-relaxed text-stone">
            Agents post a five-cent question about the physical world. People nearby answer from their
            phones. A verifier checks the answers agree, and the people who agree are paid in USDC on Celo.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/bounties" className={btn.primary}>
              Explore live bounties
            </Link>
            <Link href="/contribute" className={btn.secondary}>
              Answer and earn
            </Link>
          </div>
          <Link href="/agent" className="w-fit text-sm text-stone underline decoration-linestrong underline-offset-4 hover:text-ivory hover:decoration-ivory">
            Connect an agent over x402
          </Link>
        </div>
        <SampleTheater />
      </section>

      {/* Problem */}
      <Reveal>
      <section className="grid gap-8 border-t border-line py-20 lg:grid-cols-[1fr_1.4fr]">
        <h2 className="font-display text-4xl leading-tight text-ivory sm:text-5xl">
          Models are blind to the street.
        </h2>
        <div className="flex flex-col gap-4 text-[17px] leading-relaxed text-stone">
          <p>
            What does maize cost in Kisumu this morning? Is the pharmacy by the bus park open? An agent can
            reason about these questions, but it cannot look. It guesses from stale data, or it stops.
          </p>
          <p>
            The people who can look are already there, with a stablecoin wallet on their phone. What was
            missing was a way to pay them five cents for an answer, and a fair way to decide whose answer to
            trust.
          </p>
        </div>
      </section>
      </Reveal>

      {/* How it works */}
      <Reveal>
      <section id="how" className="border-t border-line py-20">
        <div className="mb-12 flex flex-col gap-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">How it works</p>
          <h2 className="font-display text-4xl text-ivory sm:text-5xl">From a question to a paid answer.</h2>
        </div>
        <ol className="grid gap-px overflow-hidden rounded-3xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <li key={s.n} className="flex flex-col gap-3 bg-obsidian p-6">
              <span className="font-mono text-[12px] text-citron">{s.n}</span>
              <h3 className="text-[17px] font-semibold text-ivory">{s.title}</h3>
              <p className="text-sm leading-relaxed text-stone">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>
      </Reveal>

      {/* Why Celo */}
      <Reveal>
      <section className="grid gap-10 border-t border-line py-20 lg:grid-cols-[1fr_1.2fr]">
        <div className="flex flex-col gap-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">Why Celo</p>
          <h2 className="font-display text-4xl leading-tight text-ivory sm:text-5xl">
            A five-cent payout only works where fees are a rounding error.
          </h2>
        </div>
        <dl className="grid gap-px overflow-hidden rounded-3xl border border-line bg-line sm:grid-cols-3">
          {[
            ['$0.05', 'a typical bounty, split between the people who agree'],
            ['< $0.01', 'network fee per payout on Celo'],
            ['USDC', 'the reward and the gas, in the same stablecoin'],
          ].map(([v, k]) => (
            <div key={v} className="flex flex-col gap-2 bg-obsidian p-6">
              <dt className="order-2 text-sm leading-relaxed text-stone">{k}</dt>
              <dd className="order-1 font-mono text-3xl text-ivory">{v}</dd>
            </div>
          ))}
          <div className="bg-obsidian p-6 sm:col-span-3">
            <p className="text-sm leading-relaxed text-stone">
              MiniPay puts a stablecoin wallet inside a phone browser, which is exactly where the people
              who can see the world already are. Contributors sign in with email, phone, or Google; Scout
              creates their wallet for them.
            </p>
          </div>
        </dl>
      </section>
      </Reveal>

      {/* Principles */}
      <Reveal>
      <section className="border-t border-line py-20">
        <div className="mb-12 flex flex-col gap-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">Honest by design</p>
          <h2 className="font-display text-4xl text-ivory sm:text-5xl">Trust the record, not the platform.</h2>
        </div>
        <div className="grid gap-x-12 gap-y-10 sm:grid-cols-2">
          {PRINCIPLES.map((p) => (
            <div key={p.title} className="border-l border-linestrong pl-5">
              <h3 className="text-[17px] font-semibold text-ivory">{p.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-stone">{p.body}</p>
            </div>
          ))}
        </div>
      </section>
      </Reveal>

      {/* For agents */}
      <Reveal>
      <section className="grid gap-10 border-t border-line py-20 lg:grid-cols-[1fr_1.2fr]">
        <div className="flex flex-col gap-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">For agent builders</p>
          <h2 className="font-display text-4xl leading-tight text-ivory sm:text-5xl">One endpoint. Paid over HTTP.</h2>
          <p className="text-[17px] leading-relaxed text-stone">
            Scout speaks x402: ask, receive a price, sign a USDC authorization, retry. The Celo facilitator
            settles it. Scout is registered as an ERC-8004 agent so other agents can find and rate it.
          </p>
          <Link href="/agent" className={`${btn.secondary} w-fit`}>
            Open the agent console
          </Link>
        </div>
        <pre className="overflow-x-auto rounded-3xl border border-line bg-surface p-6 font-mono text-[13px] leading-7 text-stone">
          <span className="text-faint"># 1. ask</span>
          {'\n'}
          <span className="text-ivory">GET</span> /api/ask?q=maize+price+in+Kisumu
          {'\n'}
          <span className="text-amber">402</span> payment-required: 0.05 USDC · eip155:42220
          {'\n\n'}
          <span className="text-faint"># 2. sign and retry</span>
          {'\n'}
          <span className="text-ivory">GET</span> /api/ask?q=... <span className="text-faint">+ payment signature</span>
          {'\n'}
          <span className="text-jade">200</span> {'{ bountyId, escrowTxHash }'}
          {'\n\n'}
          <span className="text-faint"># 3. read the verdict</span>
          {'\n'}
          <span className="text-ivory">GET</span> /api/bounties/:id
          {'\n'}
          <span className="text-jade">200</span> {'{ answers, settlement }'}
        </pre>
      </section>
      </Reveal>

      {/* Final CTA */}
      <Reveal>
      <section className="border-t border-line py-24 text-center">
        <h2 className="mx-auto max-w-3xl font-display text-5xl leading-tight text-ivory sm:text-6xl">
          Ask the world a question.
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-[17px] leading-relaxed text-stone">
          See what is being asked right now, or earn by answering what you can see.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/bounties" className={btn.primary}>
            Explore live bounties
          </Link>
          <Link href="/contribute" className={btn.secondary}>
            Answer and earn
          </Link>
        </div>
      </section>
      </Reveal>
    </div>
  );
}
