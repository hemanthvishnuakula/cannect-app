import { ScrollViewStyleReset } from 'expo-router/html';

export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        {/* 💎 Diamond Move: viewport-fit=cover for the Notch */}
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
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Cannect" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        
        {/* ================================
            SEO & Social
        ================================ */}
        <meta name="description" content="A Diamond Standard social network with Bluesky federation" />
        <meta property="og:title" content="Cannect" />
        <meta property="og:description" content="Connect with your community" />
        <meta property="og:type" content="website" />
        <meta property="og:image" content="/icon-512.png" />
        <meta name="twitter:card" content="summary_large_image" />
        
        {/* ================================
            Styles
        ================================ */}
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: `
          html, body {
            -webkit-text-size-adjust: 100%;
            background-color: #0A0A0A;
            color: #FAFAFA;
          }
          /* Prevent overscroll bounce on iOS */
          body {
            overscroll-behavior: none;
            overscroll-behavior-y: none;
          }
          /* Hide scrollbar but keep functionality */
          ::-webkit-scrollbar {
            display: none;
          }
          /* Safe area padding for notch devices */
          body {
            padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
          }
        `}} />
      </head>
      <body>{children}</body>
    </html>
  );
}
