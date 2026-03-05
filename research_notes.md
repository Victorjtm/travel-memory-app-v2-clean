# Research Notes: Filename Date Extraction

The "Corregir Fechas Auto" functionality is failing (400 Bad Request) because the server cannot extract dates from many common filename formats.

## Current Supported Formats (Regex)
1. `(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})` -> Matches `IMG_20220129_134353.jpg`
2. `^(\d{13})` -> Matches `1767698649281_archivo.jpg` (Timestamp)

## New Formats to Support
Based on activity 213:
1. **WhatsApp Style**: `IMG-20141115-WA0014.jpeg`
   - Pattern: `/IMG-(\d{4})(\d{2})(\d{2})-WA/`
   - Data: Year, Month, Day (No time, default to 12:00:00 or previous)
2. **Space/Dot Style**: `2014-11-15 12.25.30.jpg`
   - Pattern: `/(\d{4})-(\d{2})-(\d{2}) (\d{2})\.(\d{2})\.(\d{2})/`
   - Data: Year, Month, Day, Hour, Minute, Second
3. **Hyphenated Date Only**: `2014-11-15.jpg` or `IMG-2014-11-15.jpg`
   - Pattern: `/(\d{4})-(\d{2})-(\d{2})/`

## Proposed Fix
Update `src/app/server.js` to test multiple regexes in a loop or ordered logic.
Ensure that if only the date is found, the time defaults to `12:00:00` (or `00:00:00`) unless `ultimaFechaExtraida` can provide a sensible time for that day.

## UI Update
Update `src/app/paginas/viajes-previstos/archivos-actividades-itinerario.component.ts` to include these formats in the confirmation dialog so the user knows they are supported.
