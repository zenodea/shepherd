import { useSyncExternalStore } from "react";
import { loadPref, savePref } from "../connection/prefs";

// Reviewing an agent's changes, per computer and agent: which files you've
// looked at (until they change again) and comments on lines, sent to the agent
// together as one message.

import type { ReviewComment } from "./review-message";

export type { ReviewComment };
export type Review = { viewed: Record<string, string>; comments: ReviewComment[] };

const PREF = "reviews";
const MAX_REVIEWS = 30;
const EMPTY: Review = { viewed: {}, comments: [] };

let reviews = new Map<string, Review>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

void loadPref(PREF)
  .then((saved) => {
    if (saved) reviews = new Map(Object.entries(JSON.parse(saved) as Record<string, Review>));
  })
  .catch(() => {})
  .finally(notify);

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function update(key: string, change: (review: Review) => Review): void {
  const next = change(reviews.get(key) ?? EMPTY);
  reviews.delete(key);
  if (Object.keys(next.viewed).length || next.comments.length) reviews.set(key, next);
  while (reviews.size > MAX_REVIEWS) reviews.delete(reviews.keys().next().value!);
  notify();
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void savePref(PREF, JSON.stringify(Object.fromEntries(reviews))), 400);
}

export function useReview(key: string): Review {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => reviews.get(key) ?? EMPTY,
  );
}

/** A file counts as viewed while it still looks the way it did: same changes, same mode. */
export const viewedKey = (mode: string, path: string) => `${mode}:${path}`;
export const fingerprint = (file: { additions: number; deletions: number; status: string }) => `${file.status}:${file.additions}:${file.deletions}`;

export function setViewed(key: string, file: string, print: string | null): void {
  update(key, (r) => {
    const viewed = { ...r.viewed };
    if (print) viewed[file] = print;
    else delete viewed[file];
    return { ...r, viewed };
  });
}

export function saveComment(key: string, comment: Omit<ReviewComment, "id"> & { id?: string }): void {
  const text = comment.text.trim();
  update(key, (r) => {
    const others = r.comments.filter((c) => c.id !== comment.id);
    return { ...r, comments: text ? [...others, { ...comment, text, id: comment.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 6)}` }] : others };
  });
}

export function removeComment(key: string, id: string): void {
  update(key, (r) => ({ ...r, comments: r.comments.filter((c) => c.id !== id) }));
}

export function clearComments(key: string): void {
  update(key, (r) => ({ ...r, comments: [] }));
}
