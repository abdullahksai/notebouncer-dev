/** @type {import('next').NextConfig} */

// Pulled at build time. The sidebar's CSP `connect-src` must allow the backend
// origin or browser will block its fetch calls.
const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "";

const nextConfig = {
  reactStrictMode: true,

  // Zoom's in-client browser requires these security headers when serving
  // pages embedded via Home URL.
  async headers() {
    const connectSrc = [
      "'self'",
      "https://appssdk.zoom.us",
      "https://*.zoom.us",
      "wss://*.zoom.us",
      backendUrl,
    ]
      .filter(Boolean)
      .join(" ");

    return [
      {
        source: "/zoom-home",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://appssdk.zoom.us",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' data: https://fonts.gstatic.com",
              `connect-src ${connectSrc}`,
              "img-src 'self' data: https://*.zoom.us",
              "frame-ancestors https://*.zoom.us",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
