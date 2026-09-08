/*
 * today.html — стара адреса «Сьогодні». Сторінка існує лише щоб перевести
 * на index.html, зберігши фрагмент (у ньому можуть їхати токени з листа).
 *
 * Раніше цей рядок був inline-скриптом; винесено заради CSP без
 * script-src 'unsafe-inline' (WEB-006).
 */
location.replace('index.html' + location.hash);
