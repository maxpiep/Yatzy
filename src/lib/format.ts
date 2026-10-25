const dateTime = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
const dateOnly = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' });
const weekday = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
const pct = new Intl.NumberFormat('de-DE', { style: 'percent', maximumFractionDigits: 0 });
const dec1 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1, minimumFractionDigits: 0 });

export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
export const formatDate = (iso: string) => dateOnly.format(new Date(iso));
export const formatWeekday = (iso: string) => weekday.format(new Date(iso));
export const formatPercent = (v: number | null) => (v === null ? '–' : pct.format(v));
export const formatDecimal = (v: number | null) => (v === null ? '–' : dec1.format(v));
export const formatInt = (v: number | null) => (v === null ? '–' : String(v));
