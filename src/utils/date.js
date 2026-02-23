// utils/date.js

export function getUTCDateTime() {
  return new Date()
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}

export function getUTCDate() {
  return new Date().toISOString().slice(0, 10);
}