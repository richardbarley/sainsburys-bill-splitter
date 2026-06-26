# Suggestion Engine

How the bill splitter suggests assignments for items on a new receipt.

> This replaces an earlier localStorage-based "last assignment wins" prototype.
> That prototype no longer exists in the code. The current engine reads from the
> shared **Supabase bill history**, not browser localStorage.

## Summary

When a receipt is uploaded, the engine looks across **all** past bills (not just
the most recent one) and proposes an assignment for each item, weighting recent
bills more heavily than old ones. Suggestions are surfaced, never auto-applied —
the user still confirms each assignment.

## How it works

The logic lives in `computeSuggestions(pastBills, currentBill)` in `index.html`.

For each item on the current bill:

1. **Scan every past bill.** The current bill itself is skipped (`past.id === currentBill.id`).
2. **Fuzzy-match item names.** Names rarely match exactly between shops, so
   `normalizeForMatch()` strips quantities, units and punctuation
   (e.g. "Whole Milk 4 Pints" ≈ "Whole Milk 6 Pints") and `itemSimilarity()`
   scores the overlap with a **Jaccard index**. Matches below
   `MATCH_THRESHOLD = 0.35` are ignored.
3. **Weight by recency.** Each matching past assignment contributes
   `similarity × recency`, where `recency = 1 / (age + 1)`. The most recent bill
   counts at weight 1, the next at 0.5, then 0.33, and so on. Old bills still
   count, just progressively less.
4. **Skip manual splits.** Past items that used a custom/quantity split
   (`getManualSplit`) don't suggest a flat assignment.
5. **Pick the winner.** The highest-scoring assignee combination is chosen, and
   is only surfaced if its weighted score clears `MIN_CONFIDENCE = 0.25`.

The result is a map of `{ [itemIndex]: assignees[] }` for confidently matched items.

## Behaviour notes

- **All receipts contribute, but recent ones dominate.** A one-off oddity from
  months ago won't override a consistent recent pattern; a long, consistent
  history reinforces itself.
- **Suggestions are advisory.** Nothing is auto-assigned — the user reviews and
  confirms.
- **Data source is Supabase.** Suggestions are computed from the synced
  `bill_history` table, so they work across devices, not just the browser that
  created them.

## Key constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `MATCH_THRESHOLD` | 0.35 | Minimum per-item name similarity to consider a past item a match |
| `MIN_CONFIDENCE` | 0.25 | Minimum weighted score before a suggestion is surfaced |
| `recency` | `1 / (age + 1)` | Down-weights older bills |
