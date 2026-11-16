import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { getDb } from "../db";
import {
  content,
  signals,
  wallPlacements,
  type ContentStatus,
} from "../db/schema";

export type ContentItem = typeof content.$inferSelect;
export type Decision = "keep" | "maybe" | "no" | "more_like_this";

const STATUS_FOR: Record<Decision, ContentStatus> = {
  keep: "keep",
  maybe: "maybe",
  no: "no",
  more_like_this: "keep",
};

export function inboxBatch(limit: number): ContentItem[] {
  return getDb()
    .select()
    .from(content)
    .where(and(eq(content.status, "inbox"), ne(content.kind, "thing")))
    .orderBy(asc(content.createdAt))
    .limit(limit)
    .all();
}

/** Photos, quotes and reminders: what the library and the sorting deck hold. */
export function listContent(status?: ContentStatus): ContentItem[] {
  return getDb()
    .select()
    .from(content)
    .where(and(ne(content.kind, "thing"), status ? eq(content.status, status) : undefined))
    .orderBy(desc(content.createdAt))
    .all();
}

/** Physical things you own, newest first. */
export function listThings(): ContentItem[] {
  return getDb()
    .select()
    .from(content)
    .where(eq(content.kind, "thing"))
    .orderBy(desc(content.createdAt))
    .all();
}

export function updateThing(
  id: string,
  patch: Partial<{ title: string | null; widthMm: number | null; heightMm: number | null }>,
): void {
  getDb().update(content).set(patch).where(eq(content.id, id)).run();
}

export function getContent(id: string): ContentItem | undefined {
  return getDb().select().from(content).where(eq(content.id, id)).get();
}

export function statusCounts(): Record<ContentStatus, number> {
  const rows = getDb()
    .select({ status: content.status, n: count() })
    .from(content)
    .where(ne(content.kind, "thing"))
    .groupBy(content.status)
    .all();
  const counts = { inbox: 0, keep: 0, maybe: 0, no: 0 };
  for (const { status, n } of rows) counts[status] = n;
  return counts;
}

export function addText(input: {
  kind: "quote" | "reminder";
  body: string;
  attribution: string | null;
  source: "upload" | "shortcut" | "find";
  sourceUrl?: string | null;
}): string {
  const id = randomUUID();
  getDb().insert(content).values({ id, ...input }).run();
  return id;
}

/** A quote or reminder with exactly these words, if there is one already. */
export function findText(body: string): ContentItem | undefined {
  return getDb()
    .select()
    .from(content)
    .where(and(eq(content.body, body), ne(content.kind, "thing"), ne(content.kind, "photo")))
    .get();
}

/** Records what a found picture is and where it came from. */
export function describeFound(
  id: string,
  details: { title: string; attribution: string | null; sourceUrl: string; foundRef?: string | null },
): void {
  getDb()
    .update(content)
    .set({ ...details, source: "find" })
    .where(eq(content.id, id))
    .run();
}

/** Which of these found pictures and lines are in the library already, and under what id. */
export function alreadyKept(refs: string[], bodies: string[]): Record<string, string> {
  const db = getDb();
  const found: Record<string, string> = {};
  if (refs.length) {
    const rows = db
      .select({ id: content.id, ref: content.foundRef })
      .from(content)
      .where(inArray(content.foundRef, refs))
      .all();
    for (const row of rows) if (row.ref) found[row.ref] = row.id;
  }
  if (bodies.length) {
    const rows = db
      .select({ id: content.id, body: content.body })
      .from(content)
      .where(and(inArray(content.body, bodies), inArray(content.kind, ["quote", "reminder"])))
      .all();
    for (const row of rows) if (row.body) found[row.body] = row.id;
  }
  return found;
}

/** Kept and not printed yet: what's waiting to go on paper. */
export function listTray(): ContentItem[] {
  return getDb()
    .select()
    .from(content)
    .where(and(eq(content.status, "keep"), ne(content.kind, "thing"), isNull(content.printedAt)))
    .orderBy(desc(content.decidedAt))
    .all();
}

export function setPrinted(ids: string[], printed: boolean): void {
  if (ids.length === 0) return;
  getDb()
    .update(content)
    .set({ printedAt: printed ? new Date() : null })
    .where(inArray(content.id, ids))
    .run();
}

export function decide(
  contentId: string,
  decision: Decision,
  dwellMs?: number,
): void {
  const db = getDb();
  db.transaction((tx) => {
    tx.update(content)
      .set({ status: STATUS_FOR[decision], decidedAt: new Date() })
      .where(eq(content.id, contentId))
      .run();
    tx.insert(signals)
      .values({ id: randomUUID(), contentId, type: decision, dwellMs })
      .run();
  });
}

const DECISION_TYPES = ["keep", "maybe", "no", "more_like_this"] as const;

/** Takes the last reaction back out of the log, so a slip doesn't teach the taste profile. */
export function undoDecision(contentId: string): void {
  const db = getDb();
  db.transaction((tx) => {
    const last = tx
      .select({ id: signals.id })
      .from(signals)
      .where(
        and(
          eq(signals.contentId, contentId),
          inArray(signals.type, DECISION_TYPES),
        ),
      )
      .orderBy(desc(signals.createdAt))
      .limit(1)
      .get();
    if (last) tx.delete(signals).where(eq(signals.id, last.id)).run();
    tx.update(content)
      .set({ status: "inbox", decidedAt: null })
      .where(eq(content.id, contentId))
      .run();
  });
}

export function placementCount(contentId: string): number {
  const [row] = getDb()
    .select({ n: count() })
    .from(wallPlacements)
    .where(eq(wallPlacements.contentId, contentId))
    .all();
  return row.n;
}

export function deleteContent(contentId: string): void {
  getDb().delete(content).where(eq(content.id, contentId)).run();
}
