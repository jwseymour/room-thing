import { TrayProvider } from "@/components/find/Tray";

/** Everything under Find shares the tray of things waiting to be printed. */
export default function FindLayout({ children }: { children: React.ReactNode }) {
  // The space at the bottom keeps the last row clear of the tray.
  return (
    <TrayProvider>
      <div className="pb-16">{children}</div>
    </TrayProvider>
  );
}
