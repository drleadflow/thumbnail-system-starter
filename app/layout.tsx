import "./globals.css";
import Link from "next/link";

export const metadata = { title: "Thumbnail & Script System" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <nav className="border-b border-neutral-800 px-5 py-3 flex items-center gap-5">
          <span className="font-bold text-[15px]">🎬 Thumbnail &amp; Script System</span>
          <Link href="/ideas" className="text-[13px] text-neutral-300 hover:text-white">Ideas</Link>
          <Link href="/" className="text-[13px] text-neutral-300 hover:text-white">Thumbnails</Link>
          <Link href="/scripts" className="text-[13px] text-neutral-300 hover:text-white">Scripts</Link>
          <Link href="/performance" className="text-[13px] text-neutral-300 hover:text-white">My Videos</Link>
          <Link href="/profile" className="text-[13px] text-neutral-300 hover:text-white">Profile</Link>
        </nav>
        <main className="max-w-5xl mx-auto p-5">{children}</main>
      </body>
    </html>
  );
}
