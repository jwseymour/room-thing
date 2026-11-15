import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";

/** The room is the app, so that's where it opens. */
export default async function HomePage() {
  await requireSession();
  redirect("/room");
}
