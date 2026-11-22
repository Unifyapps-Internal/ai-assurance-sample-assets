/** Folds case, compatibility forms, Arabic diacritics, tatweel and letter variants so one phrase list covers them. */
export declare function normaliseText(text: string): string;
/** Returns the name of the first heuristic the text trips, or null. */
export declare function detectInjection(text: string): string | null;
