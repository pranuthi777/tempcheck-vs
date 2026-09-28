import "./globals.css";

export const metadata = {
  title: "TempCheck — Voice Food Safety Logger",
  description:
    "Hands-free HACCP temperature logging for kitchens, built on AssemblyAI's Voice Agent API. Real FDA rule checks, real measured accuracy, no invented numbers.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="h-full antialiased dark">
      <body className="min-h-full flex flex-col bg-slate-950 text-slate-100 font-sans">
        {children}
      </body>
    </html>
  );
}
