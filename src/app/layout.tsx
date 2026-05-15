import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Meralco Rotational Brownout Map",
  description:
    "Daily-scraped, barangay-level view of Meralco's rotational brownout schedule.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="h-full">{children}</body>
    </html>
  );
}
