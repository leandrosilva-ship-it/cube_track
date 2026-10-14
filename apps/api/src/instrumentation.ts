/**
 * OpenTelemetry — carregado antes da aplicação (`node --import ./dist/instrumentation.js`).
 * Traces via OTLP (se OTEL_EXPORTER_OTLP_ENDPOINT definido) e métricas Prometheus em METRICS_PORT.
 */
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';

const serviceName = process.env.OTEL_SERVICE_NAME ?? 'cube-track-api';
const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

if (process.env.OTEL_SDK_DISABLED !== 'true') {
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      'service.name': serviceName,
      'deployment.environment': process.env.NODE_ENV ?? 'development',
    }),
    ...(endpoint === undefined || endpoint === ''
      ? {}
      : { traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }) }),
    metricReader: new PrometheusExporter({ port: Number(process.env.METRICS_PORT ?? 9464) }),
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (request) => request.url?.startsWith('/health') === true,
      }),
      new ExpressInstrumentation(),
      new NestInstrumentation(),
      new PgInstrumentation({ enhancedDatabaseReporting: false }),
      new IORedisInstrumentation(),
    ],
  });
  sdk.start();
  const shutdown = () => {
    void sdk.shutdown().finally(() => process.exit(0));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
