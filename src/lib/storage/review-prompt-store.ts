/**
 * Storage module for the Chrome Web Store review prompt.
 *
 * Tracks engagement milestones (generation count, film clicks) and
 * dismiss/completion state so the popup can decide whether to show
 * a non-intrusive review banner.
 *
 * Direct chrome.storage.local access — no service-worker routing needed
 * because only the popup reads/writes this state.
 */

export interface ReviewPromptState {
  /** Number of successful forceRefresh recommendation generations. */
  generationCount: number;
  /** Number of times the user clicked through to a recommended film. */
  filmClickCount: number;
  /** Total number of dismiss clicks on the review banner. */
  dismissCount: number;
  /** Timestamp of the most recent dismiss, or null if never dismissed. */
  lastDismissedAt: number | null;
  /** When true the banner is permanently hidden. */
  completed: boolean;
}

const REVIEW_KEY = 'lb_rec_review_prompt';

function defaults(): ReviewPromptState {
  return {
    generationCount: 0,
    filmClickCount: 0,
    dismissCount: 0,
    lastDismissedAt: null,
    completed: false,
  };
}

export async function getReviewPromptState(): Promise<ReviewPromptState> {
  const result = await chrome.storage.local.get(REVIEW_KEY);
  const stored = result[REVIEW_KEY] as Partial<ReviewPromptState> | undefined;
  if (!stored) return defaults();
  return { ...defaults(), ...stored };
}

async function update(patch: Partial<ReviewPromptState>): Promise<void> {
  const current = await getReviewPromptState();
  await chrome.storage.local.set({ [REVIEW_KEY]: { ...current, ...patch } });
}

export async function incrementGenerationCount(): Promise<void> {
  const state = await getReviewPromptState();
  await update({ generationCount: state.generationCount + 1 });
}

export async function incrementFilmClickCount(): Promise<void> {
  const state = await getReviewPromptState();
  await update({ filmClickCount: state.filmClickCount + 1 });
}

export async function dismissReviewPrompt(): Promise<void> {
  const state = await getReviewPromptState();
  const newDismissCount = state.dismissCount + 1;
  await update({
    dismissCount: newDismissCount,
    lastDismissedAt: Date.now(),
    completed: newDismissCount >= 3,
  });
}

export async function completeReviewPrompt(): Promise<void> {
  await update({ completed: true });
}
