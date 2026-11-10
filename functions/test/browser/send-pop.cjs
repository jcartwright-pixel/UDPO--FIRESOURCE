'use strict';
/*
 * Joe 11-10-26: the schedule texts pop-up on Daily and Weekly Dispatch no longer comes up by itself. This stays as a safety:
 * a test that goes on to use the screen closes it first (Esc) if it is open.
 */
module.exports = async function closeSendPop(page) {
  await page.waitForSelector('#send-texts:not([hidden])', { timeout: 15000 });
  await page.waitForTimeout(300);
  if (await page.isVisible('#send-texts-pop')) {
    await page.keyboard.press('Escape');
    await page.waitForSelector('#send-texts-pop', { state: 'hidden' });
  }
};
