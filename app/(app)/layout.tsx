import { AppNav } from "@/components/AppNav";

/**
 * The layout itself reads nothing, so the nav appears at once. Each page checks
 * the session and reads its data at request time. The proxy has already turned
 * away anyone who isn't signed in.
 */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="min-h-dvh pb-24 sm:pb-8">
      <AppNav />
      <main className="mx-auto max-w-5xl px-4 pt-6">{children}</main>
    </div>
  );
}
