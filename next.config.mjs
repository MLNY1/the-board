/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow images from common news source domains
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.reuters.com' },
      { protocol: 'https', hostname: '**.bbc.co.uk' },
      { protocol: 'https', hostname: '**.bbc.com' },
      { protocol: 'https', hostname: '**.apnews.com' },
      { protocol: 'https', hostname: '**.npr.org' },
      { protocol: 'https', hostname: '**.timesofisrael.com' },
      { protocol: 'https', hostname: '**.aljazeera.com' },
      { protocol: 'https', hostname: '**.cnn.com' },
      { protocol: 'https', hostname: '**.foxnews.com' },
      { protocol: 'https', hostname: '**.nbcnews.com' },
      { protocol: 'https', hostname: '**.newsapi.org' },
    ],
  },

  experimental: {
    // Ensure rss-parser runs server-side only (Next.js 14 key)
    serverComponentsExternalPackages: ['rss-parser'],
  },
};

export default nextConfig;
