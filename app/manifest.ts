import type { MetadataRoute } from 'next';

// Lets people add the page to their home screen as an app: own icon, own name, no browser bars.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Singapore Air Quality',
    short_name: 'Air SG',
    description: 'Official hourly PM2.5 and PSI readings for Singapore, by region.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0d0d0d',
    theme_color: '#0d0d0d',
    icons: [{ src: '/icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' }],
  };
}
