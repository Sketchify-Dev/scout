import { codeFromRepo } from '@celo/attribution-tags';

/**
 * ERC-8021 attribution, per celo-org/attribution-tags BUILDERS.md.
 *
 * The suffix itself is attached where the wallet client is built
 * (`withAttribution` in signer.ts), so every router transaction is tagged and
 * no call site can forget it. This module only guards the code value.
 *
 * Gotcha: our code is platform-assigned by Loops House for this entry
 * (`celo_0107eaa60597`), not derived from the GitHub slug. A stale or
 * mistyped code tags transactions that credit nobody, and nothing on-chain
 * reports it. ATTRIBUTION_REPO is an optional extra guard: when set, the
 * router refuses to start unless the code matches the slug's derivation.
 * Leave it unset for assigned codes, since no slug derives them.
 */
export function assertBuilderCode(code: string, repo: string | null): void {
  if (!/^[a-z0-9_]{1,32}$/.test(code)) {
    throw new Error(`BUILDER_TAG "${code}" is not a valid ERC-8021 code ([a-z0-9_], 1 to 32 chars).`);
  }
  if (!repo) return;
  const derived = codeFromRepo(repo);
  if (derived !== code) {
    throw new Error(
      `BUILDER_TAG ${code} does not match ATTRIBUTION_REPO ${repo} (derives ${derived}). ` +
        'Tagged transactions would credit nobody.',
    );
  }
}
