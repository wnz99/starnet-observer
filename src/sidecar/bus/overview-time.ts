// Bus timestamps are absolute ISO date-times, never SQLite's relative or numeric forms.
// Accept UTC or explicit offsets, with optional fractional seconds.
const DIGIT = "[0-9]";
const DATE_TIME = "dddd-dd-dd[T ]dd:dd:dd".replaceAll("d", DIGIT);
const OFFSET = "[+-]dd:dd".replaceAll("d", DIGIT);
const ZONE =
  "CASE WHEN substr(sent_at,-1)='Z' THEN 1 WHEN substr(sent_at,-6) GLOB '" +
  OFFSET +
  "' THEN 6 ELSE 0 END";
const FRACTION = "substr(sent_at,20,length(sent_at)-19-(" + ZONE + "))";
export const overviewTime =
  "CASE WHEN typeof(sent_at)='text' AND substr(sent_at,1,19) GLOB '" +
  DATE_TIME +
  "' AND (" +
  ZONE +
  ")>0 AND (" +
  FRACTION +
  "='' OR (substr(" +
  FRACTION +
  ",1,1)='.' AND length(" +
  FRACTION +
  ")>1 AND substr(" +
  FRACTION +
  ",2) NOT GLOB '*[^0-9]*')) THEN ROUND((julianday(sent_at)-2440587.5)*86400000) END";
