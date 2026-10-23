/** Runtime text for children and the pause menu. Short and pictorial (design doc §7.7). */
export const runtimeStrings = {
  en: {
    play: "Play",
    practice: "Practice",
    practiceDone: "Great! Now let's play.",
    pause: "Pause",
    paused: "Paused",
    resume: "Keep playing",
    tapToContinue: "Tap to continue",
    ready: "Ready?",
    howToPlay: "How to play",
    holdToQuit: "Hold to stop",
    timeLeft: "{time} left",
    timeTotal: "{time} to play",
    hearts: "{n} hearts left",
    great: "Great effort!",
    good: "Well done!",
    amazing: "Amazing!",
    stars: "{n} of 3 stars",
    bestStreak: "Best streak: {n}",
    done: "Done",
    demo: "Preview: nothing is saved",
  },
  he: {
    play: "משחקים!",
    practice: "אימון",
    practiceDone: "מצוין! עכשיו משחקים.",
    pause: "השהיה",
    paused: "המשחק מושהה",
    resume: "ממשיכים לשחק",
    tapToContinue: "נוגעים כדי להמשיך",
    ready: "מוכנים?",
    howToPlay: "איך משחקים",
    holdToQuit: "לחיצה ארוכה לעצירה",
    timeLeft: "נותרו {time}",
    timeTotal: "{time} למשחק",
    hearts: "נותרו {n} לבבות",
    great: "כל הכבוד על המאמץ!",
    good: "עבודה טובה!",
    amazing: "מדהים!",
    stars: "{n} מתוך 3 כוכבים",
    bestStreak: "רצף הכי ארוך: {n}",
    done: "סיום",
    demo: "תצוגה מקדימה: שום דבר לא נשמר",
  },
} as const;

export type RuntimeKey = keyof (typeof runtimeStrings)["en"];

export function fill(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
}
