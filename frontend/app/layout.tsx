import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MZ ThinkCircle - AI Group Discussion Platform",
  description: "AI-powered Group Discussion assessment platform"
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              window.addEventListener('error', function(e) {
                console.error("GLOBAL ERROR CAPTURED:", e.error);
                var div = document.createElement('div');
                div.style.position = 'fixed';
                div.style.top = '10px';
                div.style.left = '10px';
                div.style.right = '10px';
                div.style.background = '#fee2e2';
                div.style.border = '2px solid #ef4444';
                div.style.color = '#991b1b';
                div.style.padding = '15px';
                div.style.borderRadius = '8px';
                div.style.zIndex = 999999;
                div.style.fontFamily = 'monospace';
                div.style.fontSize = '12px';
                div.style.whiteSpace = 'pre-wrap';
                div.style.boxShadow = '0 10px 15px -3px rgba(0,0,0,0.3)';
                div.innerHTML = '<strong>Client-side Hydration/Runtime Crash Captured:</strong><br/>' + 
                  e.message + '<br/><br/><strong>Stack Trace:</strong><br/>' + (e.error?.stack || 'No stack trace available');
                if (document.body) {
                  document.body.appendChild(div);
                } else {
                  document.documentElement.appendChild(div);
                }
              });
              window.addEventListener('unhandledrejection', function(e) {
                console.error("UNHANDLED REJECTION:", e.reason);
                var div = document.createElement('div');
                div.style.position = 'fixed';
                div.style.top = '10px';
                div.style.left = '10px';
                div.style.right = '10px';
                div.style.background = '#fef3c7';
                div.style.border = '2px solid #f59e0b';
                div.style.color = '#78350f';
                div.style.padding = '15px';
                div.style.borderRadius = '8px';
                div.style.zIndex = 999999;
                div.style.fontFamily = 'monospace';
                div.style.fontSize = '12px';
                div.style.whiteSpace = 'pre-wrap';
                div.innerHTML = '<strong>Unhandled Promise Rejection:</strong><br/>' + 
                  (e.reason?.message || e.reason || 'No details available') + '<br/><br/><strong>Stack Trace:</strong><br/>' + (e.reason?.stack || 'No stack trace available');
                if (document.body) {
                  document.body.appendChild(div);
                } else {
                  document.documentElement.appendChild(div);
                }
              });
            `
          }}
        />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
