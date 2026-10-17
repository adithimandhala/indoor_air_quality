const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('BROWSER_ERROR:', msg.text());
    }
  });
  page.on('pageerror', error => {
    console.log('PAGE_ERROR:', error.message);
  });
  await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle0' });
  await browser.close();
})();
