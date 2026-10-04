import type {
  ActivityClassification,
  Foreground,
  RecordedActivity,
} from '@trueiris/schemas';

export interface ActivityInput {
  application: Foreground['application'];
  windowTitle: string | null;
  previousActivity: RecordedActivity | null;
  timeOfDay: string;
}
/** Conservative, replaceable rules. Time of day/previous labels alone are not evidence. */
export function classifyActivity(
  input: ActivityInput,
): ActivityClassification | null {
  if (!input.application) return null;
  const app = `${input.application.id} ${input.application.name}`.toLowerCase();
  if (
    /(visual studio|vs ?code|\bcode(?:\.exe)?\b|vscodium|xcode|intellij|pycharm|webstorm|jetbrains|sublime|neovim|\bvim\b|android studio)/.test(
      app,
    )
  )
    return {
      activity: 'Coding',
      confidence: 0.9,
      reason: 'A code editor is the foreground application.',
    };
  if (/(zoom|microsoft teams|ms-teams|facetime|webex)/.test(app))
    return {
      activity: 'Meeting',
      confidence: 0.75,
      reason: 'A meeting application is foreground; a call is not confirmed.',
    };
  if (/(preview|acrobat|adobe reader|kindle|calibre|books)/.test(app))
    return {
      activity: 'Reading',
      confidence: 0.75,
      reason: 'A document reader is the foreground application.',
    };
  if (/(anki|quizlet)/.test(app))
    return {
      activity: 'Studying',
      confidence: 0.8,
      reason: 'A study application is foreground.',
    };
  if (
    input.windowTitle &&
    /(chrome|firefox|safari|edge|brave|browser)/.test(app)
  ) {
    if (/(google meet|microsoft teams|zoom meeting)/i.test(input.windowTitle))
      return {
        activity: 'Meeting',
        confidence: 0.65,
        reason: 'The opted-in window title suggests a meeting.',
      };
    if (/(quizlet|anki|coursera|khan academy)/i.test(input.windowTitle))
      return {
        activity: 'Studying',
        confidence: 0.65,
        reason: 'The opted-in window title suggests study material.',
      };
  }
  return {
    activity: 'Other',
    confidence: 0.2,
    reason: 'Application alone is ambiguous. Select an activity to override.',
  };
}
export function effectiveActivity(
  input: ActivityInput,
  manual: RecordedActivity | null,
  idleSeconds: number,
): ActivityClassification | null {
  if (!input.application) return null;
  if (manual)
    return { activity: manual, confidence: 1, reason: 'Selected by you.' };
  if (idleSeconds >= 60)
    return {
      activity: 'Break',
      confidence: 0.8,
      reason:
        'No computer input for at least 60 seconds; a break is not confirmed.',
    };
  return classifyActivity(input);
}
