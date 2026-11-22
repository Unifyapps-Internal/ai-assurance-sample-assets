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
/**
 * OpenInference-shaped spans over the standard OpenTelemetry SDK: one AGENT span per turn, LLM and TOOL children,
 * each carrying session.id and user.id. Nothing is loaded or sent unless a collector endpoint (or a test exporter)
 * is configured and the policy leaves telemetry enabled.
 */
export declare class Telemetry {
    private readonly options;
    private runtime;
    private readonly scope;
    constructor(options: TelemetryOptions);
    get configured(): boolean;
    private active;
    private load;
    private run;
    /** Root span for one conversation turn. */
    turn<T>(info: TurnInfo, fn: (span: SpanHandle) => Promise<T>): Promise<T>;
    /** Child span for one model call; record llm.token_count.* and output.value on the handle. */
    model<T>(info: {
        model: string;
        input?: string;
    }, fn: (span: SpanHandle) => Promise<T>): Promise<T>;
    /** Child span for one tool call; the output is recorded from the returned value. */
    tool<T>(info: {
        name: string;
        input: unknown;
    }, fn: () => Promise<T>): Promise<T>;
    /** Sends anything still buffered; call before a serverless function returns. */
    flush(): Promise<void>;
}
