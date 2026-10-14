import type { MetadataRoute } from 'next';

/** Manifesto PWA: instalável em desktop, tablet e mobile. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'CUBE TRACK',
    short_name: 'CUBE TRACK',
    description: 'Projetos, processos e portfólio em tempo real.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#f6f7fb',
    theme_color: '#4252d9',
    lang: 'pt-BR',
    categories: ['productivity', 'business'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
    shortcuts: [
      { name: 'Minha semana', url: '/my-week' },
      { name: 'Inbox', url: '/inbox' },
    ],
  };
}
