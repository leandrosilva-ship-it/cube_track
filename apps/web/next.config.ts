import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** API acessada pela mesma origem (`/v1/*`): o cookie de refresh fica first-party (ADR 0032). */
const apiUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@cube-track/ui', '@cube-track/i18n', '@cube-track/shared'],
  experimental: { optimizePackageImports: ['lucide-react', '@cube-track/ui', '@cube-track/i18n'] },
  // Pacotes internos usam imports `./x.js` (NodeNext, exigido pela API): o webpack resolve para `.ts`.
  webpack(webpackConfig: { resolve: { extensionAlias?: Record<string, string[]> } }) {
    webpackConfig.resolve.extensionAlias = {
      ...webpackConfig.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return webpackConfig;
  },
  rewrites() {
    return Promise.resolve([{ source: '/v1/:path*', destination: `${apiUrl}/v1/:path*` }]);
  },
  headers() {
    return Promise.resolve([
      { source: '/:path*', headers: securityHeaders },
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ]);
  },
};

export default withNextIntl(config);
