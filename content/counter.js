import {App} from './app.js';
import {Match} from './match.js';

// ---------- Script Counter -------------------------------
export class Counter {

  static {
    // default colors
    browser.browserAction.setBadgeBackgroundColor({color: '#cd853f'});
    browser.browserAction.setBadgeTextColor({color: '#fff'});
  }

  static init(pref) {                                       // pref from background.js
    // this.pref = await browser.storage.local.get();       // self-contained module, runs on background.js start & storage.onChanged
    if (!pref.counter) {
      browser.tabs.onUpdated.removeListener(this.#process);
      return;
    }

    this.pref = pref;

    // extraParameters not supported on Android
    App.android ?
      browser.tabs.onUpdated.addListener(this.#process) :
      browser.tabs.onUpdated.addListener(this.#process, {
        urls: ['*://*/*', 'file:///*'],
        properties: ['status']
      });
  }

  static #process(tabId, changeInfo, tab) {
    if (changeInfo.status !== 'complete') { return; }
    if (App.android && !/^(http|file:)/i.test(tab.url)) { return; }

    Match.process(tab, Counter.pref, 'bg')
    .then(count => {
      browser.browserAction.setBadgeText({tabId, text: count[0] ? count.length + '' : ''});
      browser.browserAction.setTitle({tabId, title: count[0] ? count.join('\n') : ''});
    });
  }
}