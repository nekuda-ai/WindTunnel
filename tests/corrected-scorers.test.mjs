// Regression cases for the scorers and tasks corrected after the 2026-08-18
// failure audit (results/FAILURE-AUDIT-2026-08-18.md). Each case scores real
// answer text against the predicate the task file actually ships, so a later
// edit that re-breaks one of these fails here rather than in a paid flight.
import assert from "node:assert/strict";
import test from "node:test";

import { loadTasks } from "../harness/tasks.mjs";
import { score } from "../scoring/predicates.mjs";

const task = (site, id) => {
  const found = loadTasks(site).find((candidate) => candidate.id === id);
  assert.ok(found, `${site}/${id} is missing from its task file`);
  return found;
};

const scores = async (site, id, text) => (await score(task(site, id).predicate, null, text)).pass;

async function cases(site, id, { accept, reject }) {
  for (const text of accept) assert.equal(await scores(site, id, text), true, `${id} should accept: ${text}`);
  for (const text of reject) assert.equal(await scores(site, id, text), false, `${id} should reject: ${text}`);
}

test("hev-8 accepts the seeded LIVE status and its dashboard labels", async () => {
  await cases("hi-events", "hev-8", {
    // The exact phrasings the audit found in the 32 rejected-but-correct rows.
    accept: [
      "The WebMCP Community Workshop is currently LIVE.",
      "Status: Live",
      "The event status is Live/Published.",
      "The workshop is On Sale.",
      // Verbatim stored answers from the 32 the audit found wrongly rejected.
      "Final answer: The current status of the WebMCP Community Workshop event is Live (ON SALE).",
      "Final answer: The **WebMCP Community Workshop** is **live/published and on sale**.",
      "| Field | Value | | Status | **LIVE** (published) |",
    ],
    reject: [
      "The event is still in Draft.",
      "The WebMCP Community Workshop has been archived.",
      "I could not log in to the organizer dashboard.",
      // Word boundary: "delivered" contains the letters of "live".
      "The tickets were delivered to the attendee.",
      // An unanchored \\blive\\b would accept both of these.
      "I could not determine whether the event is live.",
      "The live chat works, but I never reached the dashboard.",
    ],
  });
});

test("md-7 accepts a bare cart total", async () => {
  await cases("nextjs-starter-medusa", "md-7", {
    accept: ["3", "three", "The cart now holds 3 items.", "Total item count: three"],
    reject: [
      "The cart holds 2 items.",
      "I added two pairs of sweatpants and one pair of shorts.",
      "The cart is empty.",
      // A bare \\b3\\b would accept both of these contradictory totals.
      "The cart contains 2 items, not the expected 3.",
      "The cart has 2 items after 3 attempts.",
    ],
  });
});

test("react-auth-boundary accepts an explicit not-accessible answer", async () => {
  await cases("bulletproof-react", "react-auth-boundary", {
    accept: [
      "The private app is not accessible while signed out.",
      "The private app is inaccessible without an account.",
      "Visiting /app redirects to the login page.",
      "Access denied — unauthorized.",
      // Verbatim stored answers that must keep passing.
      "The private app is **not** accessible while signed out. When clicking \"Get started\", the app immediately redirects to the login page.",
      "Final answer: The private app is not accessible while signed out; discussions are only visible to signed-in team members.",
    ],
    // An unqualified "accessible" is the wrong answer and matches nothing.
    reject: [
      "The private app is accessible.",
      "I could reach the private dashboard fine.",
      // Verbatim from results/2026-07-27-reference: a stuck computer-use
      // attempt that passed only because it said "login page". It determined
      // nothing about the boundary.
      "The browser is still in fullscreen mode. I can see the login page. I need to find a way to access the address bar. Let me try pressing Ctrl+L to focus the address bar.",
      // Prompt-echo: the task prompt itself contains "do not sign in".
      "The private app IS accessible. I followed the instruction: do not sign in.",
    ],
  });
});

test("directory-filter asks for, and scores, a result from the filtered list", async () => {
  const filter = task("directory-9d8", "directory-filter");
  assert.match(filter.prompt, /report one result shown in the filtered list/);
  await cases("directory-9d8", "directory-filter", {
    // GitHub and React are the two seeded Development bookmarks
    // (fixtures/directory-9d8/init-db.mjs).
    accept: [
      "Filtered to Development. GitHub is one of the results.",
      "React",
      "The developer tools filter shows GitHub and React.",
    ],
    reject: [
      // The old prompt's answer: the action, with no result named.
      "I applied the Development filter.",
      "Figma is shown.",
    ],
  });
});

test("blog-read-author starts on /about and keeps Tails Azimuth", async () => {
  const author = task("tailwind-nextjs-blog", "blog-read-author");
  assert.equal(author.start_path, "/about");
  assert.match(author.prompt, /About page/);
  await cases("tailwind-nextjs-blog", "blog-read-author", {
    accept: ["The About page shows Tails Azimuth.", "tails azimuth"],
    // The co-author and the template's own credit are the two wrong answers
    // the audit saw; both must still fail.
    reject: ["Sparrow Hawk", "Timothy Lin"],
  });
});
