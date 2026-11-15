import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
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
    .where(eq(content.status, "inbox"))
    .orderBy(asc(content.createdAt))
    .limit(limit)
    .all();
}

export function listContent(status?: ContentStatus): ContentItem[] {
  return getDb()
    .select()
    .from(content)
    .where(status ? eq(content.status, status) : undefined)
    .orderBy(desc(content.createdAt))
    .all();
}

export function getContent(id: string): ContentItem | undefined {
  return getDb().select().from(content).where(eq(content.id, id)).get();
}

export function statusCounts(): Record<ContentStatus, number> {
  const rows = getDb()
    .select({ status: content.status, n: count() })
    .from(content)
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
  source: "upload" | "shortcut";
}): string {
  const id = randomUUID();
  getDb().insert(content).values({ id, ...input }).run();
  return id;
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
