import { ScrollViewStyleReset } from 'expo-router/html';

export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <title>Cannect - Cannabis Social Network</title>
        {/* Viewport: disable zoom for native app feel */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
        />

        {/* ================================
            PWA Configuration
        ================================ */}
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#10B981" />
        <meta name="mobile-web-app-capable" content="yes" />

        {/* ================================
            iOS/Safari Support
        ================================ */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black" />
        <meta name="apple-mobile-web-app-title" content="Cannect" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon.png" />
        <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png" />

        {/* ================================
            SEO & Social
        ================================ */}
        <meta
          name="description"
          content="Cannect is the cannabis social network. Connect with enthusiasts, share experiences, and discover your community on the decentralized Bluesky network."
        />
        <meta property="og:title" content="Cannect - Cannabis Social Network" />
        <meta
          property="og:description"
          content="Connect with cannabis enthusiasts, share experiences, and discover your community on the decentralized Bluesky network."
        />
        <meta property="og:type" content="website" />
        <meta property="og:image" content="/icon-512.png" />
        <meta name="twitter:card" content="summary_large_image" />

        {/* ================================
            Styles
        ================================ */}
        <ScrollViewStyleReset />
        <style
          dangerouslySetInnerHTML={{
            __html: `
          html, body, #root {
            -webkit-text-size-adjust: 100%;
            background-color: #0A0A0A;
            color: #FAFAFA;
            margin: 0;
            padding: 0;
            height: 100%;
            width: 100%;
            overflow: hidden;
          }
          /* PWA Full Screen - Use safe area insets properly */
          body {
            overscroll-behavior: none;
            overscroll-behavior-y: none;
            /* Fill entire viewport including notch area */
            min-height: 100vh;
            min-height: -webkit-fill-available;
            /* iOS PWA: Remove any automatic padding */
            padding: env(safe-area-inset-top, 0) env(safe-area-inset-right, 0) env(safe-area-inset-bottom, 0) env(safe-area-inset-left, 0);
            padding: 0 !important;
            box-sizing: border-box;
          }
          /* Ensure #root fills the screen */
          #root {
            min-height: 100vh;
            min-height: -webkit-fill-available;
            display: flex;
            flex-direction: column;
          }
          /* Hide scrollbar but keep functionality */
          ::-webkit-scrollbar {
            display: none;
          }
          /* Fix iOS PWA input zoom */
          input, textarea, select {
            font-size: 16px;
          }
        `,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
