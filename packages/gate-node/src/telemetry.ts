import { AsyncLocalStorage } from 'node:async_hooks';
import type { Span, Tracer } from '@opentelemetry/api';
import type { SpanExporter } from '@opentelemetry/sdk-trace-base';

/** What a traced function may record on its span. Values are masked by the gate before they are attached. */
export interface SpanHandle {
  set(attributes: Record<string, string | number | boolean | undefined>): void;
}

export interface TelemetryOptions {
  assetId: string;
  collectorEndpoint?: string;
  collectorApiKey?: string;
  /** Test seam: spans go to this exporter instead of the OTLP/HTTP one. */
  spanExporter?: SpanExporter;
  enabled: () => boolean;
  mask: (text: string) => string;
}

export interface TurnInfo {
  sessionId: string;
  userId?: string;
  input: string;
}

interface Runtime {
  tracer: Tracer;
  flush: () => Promise<void>;
  api: typeof import('@opentelemetry/api');
}

interface Scope {
  span: Span;
  sessionId: string;
  userId?: string;
}

const NOOP: SpanHandle = { set: () => undefined };
const tracesUrl = (endpoint: string): string => {
  const trimmed = endpoint.replace(/\/+$/, '');
  return trimmed.endsWith('/v1/traces') ? trimmed : `${trimmed}/v1/traces`;
};

/**
 * OpenInference-shaped spans over the standard OpenTelemetry SDK: one AGENT span per turn, LLM and TOOL children,
 * each carrying session.id and user.id. Nothing is loaded or sent unless a collector endpoint (or a test exporter)
 * is configured and the policy leaves telemetry enabled.
 */
export class Telemetry {
  private runtime: Promise<Runtime> | null = null;
  private readonly scope = new AsyncLocalStorage<Scope>();

  constructor(private readonly options: TelemetryOptions) {}

  get configured(): boolean {
    return Boolean(this.options.collectorEndpoint || this.options.spanExporter);
  }

  private active(): boolean {
    return this.configured && this.options.enabled();
  }

  private load(): Promise<Runtime> {
    this.runtime ??= (async () => {
      const api = await import('@opentelemetry/api');
      const { BasicTracerProvider, SimpleSpanProcessor } = await import('@opentelemetry/sdk-trace-base');
      const { resourceFromAttributes } = await import('@opentelemetry/resources');
      let exporter = this.options.spanExporter;
      if (!exporter) {
        const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
        exporter = new OTLPTraceExporter({
          url: tracesUrl(this.options.collectorEndpoint as string),
          headers: this.options.collectorApiKey ? { authorization: this.options.collectorApiKey } : {},
        });
      }
      const provider = new BasicTracerProvider({
        resource: resourceFromAttributes({ 'service.name': this.options.assetId }),
        spanProcessors: [new SimpleSpanProcessor(exporter)],
      });
      return { api, tracer: provider.getTracer('assurance-gate'), flush: () => provider.forceFlush() };
    })();
    return this.runtime;
  }

  private async run<T>(
    name: string,
    kind: 'AGENT' | 'LLM' | 'TOOL',
    attributes: Record<string, string | undefined>,
    identity: { sessionId: string; userId?: string } | null,
    fn: (span: SpanHandle) => Promise<T>,
  ): Promise<T> {
    if (!this.active()) return fn(NOOP);
    const { api, tracer } = await this.load();
    const parent = this.scope.getStore();
    const who = identity ?? parent;
    const context = parent ? api.trace.setSpan(api.ROOT_CONTEXT, parent.span) : api.ROOT_CONTEXT;
    const span = tracer.startSpan(name, {}, context);
    const set: SpanHandle['set'] = (values) => {
      for (const [key, value] of Object.entries(values)) {
        if (value !== undefined) span.setAttribute(key, typeof value === 'string' ? this.options.mask(value) : value);
      }
    };
    set({ 'openinference.span.kind': kind, 'session.id': who?.sessionId, 'user.id': who?.userId, ...attributes });
    try {
      const scope: Scope = { span, sessionId: who?.sessionId ?? '', userId: who?.userId };
      const result = await this.scope.run(scope, () => fn({ set }));
      span.setStatus({ code: api.SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      span.setStatus({ code: api.SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  }

  /** Root span for one conversation turn. */
  turn<T>(info: TurnInfo, fn: (span: SpanHandle) => Promise<T>): Promise<T> {
    return this.run('agent.turn', 'AGENT', { 'input.value': info.input }, { sessionId: info.sessionId, userId: info.userId }, fn);
  }

  /** Child span for one model call; record llm.token_count.* and output.value on the handle. */
  model<T>(info: { model: string; input?: string }, fn: (span: SpanHandle) => Promise<T>): Promise<T> {
    return this.run('llm.generate', 'LLM', { 'llm.model_name': info.model, 'input.value': info.input }, null, fn);
  }

  /** Child span for one tool call; the output is recorded from the returned value. */
  tool<T>(info: { name: string; input: unknown }, fn: () => Promise<T>): Promise<T> {
    const input = JSON.stringify(info.input);
    return this.run(`tool.${info.name}`, 'TOOL', { 'tool.name': info.name, 'tool.parameters': input, 'input.value': input }, null, async (span) => {
      const output = await fn();
      span.set({ 'output.value': JSON.stringify(output) });
      return output;
    });
  }

  /** Sends anything still buffered; call before a serverless function returns. */
  async flush(): Promise<void> {
    if (this.runtime) await (await this.runtime).flush();
  }
}
