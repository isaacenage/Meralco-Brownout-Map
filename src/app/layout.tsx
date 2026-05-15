import type { Metadata, Viewport } from "next";
import "./globals.css";

const siteTitle = "Meralco Rotational Brownout Map";
const siteDescription =
  "Daily-scraped, barangay-level view of Meralco's rotational brownout schedule.";

export const metadata: Metadata = {
  title: siteTitle,
  description: siteDescription,
  applicationName: "Meralco Brownout Map",
  formatDetection: {
    telephone: false,
    email: false,
    address: false,
  },
  appleWebApp: {
    capable: true,
    title: "Brownout Map",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/logo/favicon.ico", sizes: "any" },
      { url: "/logo/favicon-16x16.png", type: "image/png", sizes: "16x16" },
      { url: "/logo/favicon-32x32.png", type: "image/png", sizes: "32x32" },
      { url: "/logo/favicon-96x96.png", type: "image/png", sizes: "96x96" },
      { url: "/logo/favicon-128.png", type: "image/png", sizes: "128x128" },
      { url: "/logo/favicon-196x196.png", type: "image/png", sizes: "196x196" },
    ],
    shortcut: ["/logo/favicon.ico"],
    apple: [
      { url: "/logo/apple-touch-icon-57x57.png", sizes: "57x57" },
      { url: "/logo/apple-touch-icon-60x60.png", sizes: "60x60" },
      { url: "/logo/apple-touch-icon-72x72.png", sizes: "72x72" },
      { url: "/logo/apple-touch-icon-76x76.png", sizes: "76x76" },
      { url: "/logo/apple-touch-icon-114x114.png", sizes: "114x114" },
      { url: "/logo/apple-touch-icon-120x120.png", sizes: "120x120" },
      { url: "/logo/apple-touch-icon-144x144.png", sizes: "144x144" },
      { url: "/logo/apple-touch-icon-152x152.png", sizes: "152x152" },
    ],
  },
  openGraph: {
    type: "website",
    title: siteTitle,
    description: siteDescription,
    siteName: "Meralco Brownout Map",
    images: [
      {
        url: "/logo/mstile-310x310.png",
        width: 310,
        height: 310,
        alt: siteTitle,
      },
    ],
  },
  twitter: {
    card: "summary",
    title: siteTitle,
    description: siteDescription,
    images: ["/logo/mstile-310x310.png"],
  },
  other: {
    "mobile-web-app-capable": "yes",
    "msapplication-TileColor": "#FFFFFF",
    "msapplication-TileImage": "/logo/mstile-144x144.png",
    "msapplication-square70x70logo": "/logo/mstile-70x70.png",
    "msapplication-square150x150logo": "/logo/mstile-150x150.png",
    "msapplication-wide310x150logo": "/logo/mstile-310x150.png",
    "msapplication-square310x310logo": "/logo/mstile-310x310.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ea580c" },
    { media: "(prefers-color-scheme: dark)", color: "#ea580c" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="app-body">{children}</body>
    </html>
  );
}
