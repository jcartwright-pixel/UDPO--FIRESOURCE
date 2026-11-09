'use strict';
/*
 * Joe 11-9-26: on Daily and Weekly Dispatch the schedule texts warnings come up in a pop-up by themselves for an
 * administrator. A test that goes on to use the screen closes it first (Esc), the way a person would.
 */
module.exports = async function closeSendPop(page) {
  await page.waitForSelector('#send-texts:not([hidden])', { timeout: 15000 });
  await page.waitForTimeout(300);
  if (await page.isVisible('#send-texts-pop')) {
    await page.keyboard.press('Escape');
    await page.waitForSelector('#send-texts-pop', { state: 'hidden' });
  }
};
