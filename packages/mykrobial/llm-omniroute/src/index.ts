/** DeepSeek LlmAdapter bridge to an injected, authority-owning OmniRoute transport. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  LlmAdapter,
  LlmError,
  type GenerateOptions,
  type LlmProviderInfo,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import {
  prepareOmniRouteRequest,
  projectOmniRouteReceipt,
  sha256,
  type OmniRouteReceipt,
  type OmniRouteRequest,
  type VerifiedRouteProjection,
} from '@mykrobial/dsh-integration-projections'

export const name = 'llm-mykrobial-omniroute'
export const inject = ['llm', 'omniRouteTransport', 'omniRouteReceiptSink']
export const PROVIDER = 'mykrobial-omniroute'

const DIGEST = /^[0-9a-f]{64}$/
const ENDPOINT = /^omniroute:\/\/[A-Za-z0-9._/-]{1,160}$/

export interface OmniRoutePreparedStream {
  stream: AsyncIterable<StreamChunk>
  receipt: Promise<OmniRouteReceipt>
}

export interface OmniRouteTransport {
  resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo>
  prepare(request: OmniRouteRequest, options: GenerateOptions): Promise<OmniRoutePreparedStream>
}

export interface OmniRouteReceiptSink {
  record(sessionId: string | null, receipt: VerifiedRouteProjection): Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    omniRouteTransport: OmniRouteTransport
    omniRouteReceiptSink: OmniRouteReceiptSink
  }
}

export interface Config {
  endpointRef: string
  routePolicySha256: string
  authorityRefSha256: string
  displayName?: string
}

export const Config: z<Config> = z.object({
  endpointRef: z.string().required(),
  routePolicySha256: z.string().required(),
  authorityRefSha256: z.string().required(),
  displayName: z.string().default('Mykrobial OmniRoute'),
})

interface ResolvedConfig {
  endpointRef: string
  routePolicySha256: string
  authorityRefSha256: string
  displayName: string
}

function resolveConfig(config: Config): ResolvedConfig {
  if (!ENDPOINT.test(config.endpointRef)) throw new Error('typed_blocker:omniroute_endpoint_invalid')
  if (!DIGEST.test(config.routePolicySha256)) throw new Error('typed_blocker:omniroute_policy_digest_invalid')
  if (!DIGEST.test(config.authorityRefSha256)) throw new Error('typed_blocker:omniroute_authority_digest_invalid')
  const displayName = config.displayName?.trim() ?? 'Mykrobial OmniRoute'
  if (displayName.length === 0 || displayName.length > 128) {
    throw new Error('typed_blocker:omniroute_display_name_invalid')
  }
  return {
    endpointRef: config.endpointRef,
    routePolicySha256: config.routePolicySha256,
    authorityRefSha256: config.authorityRefSha256,
    displayName,
  }
}

function requestIdentity(options: GenerateOptions): string {
  const stable = {
    provider: options.provider,
    model: options.model,
    reasoningEffort: options.reasoningEffort ?? null,
    messages: options.messages,
    system: options.system ?? null,
    tools: options.tools ?? null,
    temperature: options.temperature ?? null,
    maxTokens: options.maxTokens ?? null,
    stop: options.stop ?? null,
    sessionId: options.sessionId === undefined ? null : String(options.sessionId),
    purpose: options.purpose ?? null,
  }
  return `route-${sha256(stable).slice(0, 32)}`
}

function messageIdentity(options: GenerateOptions): string {
  return sha256({
    messages: options.messages,
    system: options.system ?? null,
    tools: options.tools ?? null,
  })
}

export class OmniRouteAdapter extends LlmAdapter {
  constructor(
    private readonly transport: OmniRouteTransport,
    private readonly sink: OmniRouteReceiptSink,
    private readonly config: ResolvedConfig,
  ) {
    super()
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: this.config.displayName }
  }

  override async resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    if (provider !== PROVIDER) throw new LlmError(`unexpected OmniRoute provider ${provider}`, 'INVALID_PROVIDER')
    const resolved = await this.transport.resolveModel(provider, model, signal)
    if (resolved.provider !== provider || resolved.id !== model) {
      throw new LlmError('OmniRoute model resolution changed requested identity', 'IDENTITY_MISMATCH')
    }
    return resolved
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.provider !== PROVIDER) {
      throw new LlmError(`unexpected OmniRoute provider ${options.provider}`, 'INVALID_PROVIDER')
    }
    const request = prepareOmniRouteRequest({
      request_id: requestIdentity(options),
      endpoint_ref: this.config.endpointRef,
      requested_model: options.model,
      message_sha256: messageIdentity(options),
      route_policy_sha256: this.config.routePolicySha256,
      authority_ref_sha256: this.config.authorityRefSha256,
    })
    const prepared = await this.transport.prepare(request, options)
    let finish: StreamChunk | undefined
    for await (const chunk of prepared.stream) {
      if (finish !== undefined) throw new LlmError('OmniRoute emitted a chunk after finish', 'PROTOCOL')
      if (chunk.type === 'finish') {
        finish = chunk
        continue
      }
      yield chunk
    }
    if (finish === undefined) throw new LlmError('OmniRoute stream ended without finish', 'PROTOCOL')
    const receipt = projectOmniRouteReceipt(request, await prepared.receipt)
    if (receipt.status !== 'served_verified') {
      throw new LlmError('OmniRoute stream lacks verified served identity', 'IDENTITY_UNVERIFIED')
    }
    await this.sink.record(options.sessionId === undefined ? null : String(options.sessionId), receipt)
    yield finish
  }
}

export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  ctx.llm.registerAdapter([
    PROVIDER,
  ], new OmniRouteAdapter(ctx.omniRouteTransport, ctx.omniRouteReceiptSink, resolved))
}
