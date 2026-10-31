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
// SQLite normalizes impossible days and hour 24; check local components before offset conversion.
const YEAR = "CAST(substr(sent_at,1,4) AS INTEGER)";
const LAST_DAY =
  "CASE WHEN substr(sent_at,6,2)='02' THEN 28 + (" +
  YEAR +
  "%4=0 AND (" +
  YEAR +
  "%100<>0 OR " +
  YEAR +
  "%400=0)) WHEN substr(sent_at,6,2) IN ('04','06','09','11') THEN 30 ELSE 31 END";
const CALENDAR =
  "substr(sent_at,6,2) BETWEEN '01' AND '12' AND CAST(substr(sent_at,9,2) AS INTEGER) BETWEEN 1 AND (" +
  LAST_DAY +
  ") AND " +
  "substr(sent_at,12,2) BETWEEN '00' AND '23' AND substr(sent_at,15,2) BETWEEN '00' AND '59' AND " +
  "substr(sent_at,18,2) BETWEEN '00' AND '59'";
export const overviewTime =
  "CASE WHEN typeof(sent_at)='text' AND substr(sent_at,1,19) GLOB '" +
  DATE_TIME +
  "' AND " +
  CALENDAR +
  " AND (" +
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
