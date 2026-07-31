import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { BottomNav } from "./components/ui/BottomNav";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Antrenör Ajanı",
  description: "Kişisel hipertrofi antrenörü — program, beslenme ve takip",
  // Lets iOS Safari's "Add to Home Screen" run the app full-screen.
  appleWebApp: {
    capable: true,
    title: "Antrenör",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0b0b",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
        <BottomNav />
      </body>
    </html>
  );
}
