'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = fs.realpathSync(path.join(__dirname, '..'));
const pages = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/assets/data/location-catalog.js', 'assets/data/location-catalog.js'],
  ['/assets/announcements/donation-qr.jpg', 'assets/announcements/donation-qr.jpg'],
  ['/assets/announcements/etiquette.svg', 'assets/announcements/etiquette.svg'],
  ['/assets/fonts/NotoSansArabic-Arabic.woff2', 'assets/fonts/NotoSansArabic-Arabic.woff2'],
  ['/assets/fonts/NotoSansArabic-Latin.woff2', 'assets/fonts/NotoSansArabic-Latin.woff2']
]);

module.exports = function previewFile(request) {
  const port = request.socket.localPort;
  if (!['127.0.0.1:' + port, 'localhost:' + port].includes(request.headers.host)) return null;
  try {
    const name = pages.get(new URL(request.url, 'http://127.0.0.1').pathname);
    if (!name) return null;
    const file = path.join(root, name);
    return fs.realpathSync(file) === file && fs.statSync(file).isFile() ? file : null;
  } catch {
    return null;
  }
};
