import { codeFromRepo } from '@celo/attribution-tags';

/**
 * ERC-8021 attribution, per celo-org/attribution-tags BUILDERS.md.
 *
 * The suffix itself is attached where the wallet client is built
 * (`withAttribution` in signer.ts), so every router transaction is tagged and
 * no call site can forget it. This module only guards the code value.
 *
 * Gotcha: a hackathon-assigned code is derived from the registered GitHub
 * `owner/repo` slug. A stale or mistyped code tags transactions that credit
 * nobody, and nothing on-chain reports it. Set ATTRIBUTION_REPO to the slug
 * registered with Loops House and the router refuses to start on a mismatch.
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
