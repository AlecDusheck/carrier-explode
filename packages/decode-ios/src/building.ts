/** A readonly result while its parser fills it in. */
export type Building<T> = { -readonly [K in keyof T]: T[K] };
