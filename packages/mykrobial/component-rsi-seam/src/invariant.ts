/** Package-owned invariant companion for the pure component RSI seam. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@mykrobial/dsh-component-rsi-seam'

/** CORDIS companion plugin name. */
export const name = 'mykrobial-component-rsi-seam-invariant'

/** Service required before package ownership can be registered. */
export const inject = ['invariants']

/** No runtime invariant: pure constructors return immutable plans and never mount, append, execute, or promote. */
const install: InvariantInstaller = () => {}

/**
 * Register the package-owned no-runtime invariant explanation.
 * @param ctx - CORDIS context carrying the invariant registry.
 * @returns The registration disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
