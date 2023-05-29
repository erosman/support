import {App} from './app.js';
import {Meta} from './meta.js';
import {RemoteUpdate} from './remote-update.js'

// ----------------- Web/Direct Installer & Remote Update (Side Effect)
class Installer {

  static {
    RemoteUpdate.callback = this.#processResponse.bind(this);

    // --- Web/Direct Installer
    browser.webRequest.onBeforeRequest.addListener(e => this.#webInstall(e), {
        urls: [
          'https://greasyfork.org/scripts/*.user.js',
          'https://greasyfork.org/scripts/*.user.css',
          'https://sleazyfork.org/scripts/*.user.js',
          'https://sleazyfork.org/scripts/*.user.css',
          'https://openuserjs.org/install/*.user.js',
        ],
        types: ['main_frame']
      },
      ['blocking']
    );

    // extraParameters not supported on Android
    App.android ?
      browser.tabs.onUpdated.addListener((...e) => /^(http|file:)/i.test(tab.url) && this.#directInstall(...e)) :
      browser.tabs.onUpdated.addListener((...e) => this.#directInstall(...e), {
        urls: [
          '*://*/*.user.js',
          '*://*/*.user.css',
          'file:///*.user.js',
          'file:///*.user.css'
       ],
       properties: ['status']
      });

    // --- Remote Update
    this.cache = [];
    browser.idle.onStateChanged.addListener(state => this.#onIdle(state));


    // --- Stylish context-menu
    if (browser.menus) {                                    // menus not supported on Android
      const contextMenus = [
        {id: 'stylish', contexts: ['all'], documentUrlPatterns: ['https://userstyles.org/styles/*/*']}
      ];
      contextMenus.forEach(item => {
        if (item.id) {
          !item.title && (item.title = browser.i18n.getMessage(item.id)); // always use the same ID for i18n
        }
        browser.menus.create(item);
      });

      // prepare for manifest v3
      browser.menus.onClicked.addListener((info, tab) =>
        info.menuItemId === 'stylish' && this.stylish(tab.url));
    }
  }

  // ---------- Web/Direct Installer -----------------------
  static #webInstall(e) {
    if (!e.originUrl) { return; }

    let q;
    switch (true) {
      // --- GreasyFork & SleazyFork
      case [e.originUrl, e.url].every(item => item.startsWith('https://greasyfork.org/')):
      case [e.originUrl, e.url].every(item => item.startsWith('https://sleazyfork.org/')):
        q = 'header h2';
        break;

      // --- OpenUserJS
      case [e.originUrl, e.url].every(item => item.startsWith('https://openuserjs.org/')):
        q = 'a[class="script-name"]';
        break;
    }
    if (!q) { return; }

    const code = `(() => {
      const name = document.querySelector('${q}')?.textContent || document.title;
      return confirm(browser.i18n.getMessage('installConfirm', name)) && name;
    })();`;

    browser.tabs.executeScript({code})
    .then((result = []) => result[0] && RemoteUpdate.getScript({updateURL: e.url, name: result[0]}))
    .catch(error => App.log('webInstall', `${e.url} ➜ ${error.message}`, 'error'));

    return {cancel: true};
  }

  static #directInstall(tabId, changeInfo, tab) {
    if (changeInfo.status !== 'complete') { return; }
    if (App.android && !/^(http|file:)/i.test(tab.url)) { return; }

    // not on these URLs
    if (tab.url.startsWith('https://github.com/')) { return; }
    if (tab.url.startsWith('https://gitee.com/') && !tab.url.includes('/raw/')) { return; }
    if (tab.url.startsWith('https://gitlab.com/') && !tab.url.includes('/raw/')) { return; }
    if (tab.url.startsWith('https://codeberg.org/') && !tab.url.includes('/raw/')) { return; }

    const code = String.raw`(() => {
      const text = document.body?.textContent;
      if (!text?.trim()) {
        alert(browser.i18n.getMessage('metaError'));
        return;
      }
      const name = text.match(/(?:\/\/)?\s*@name\s+([^\r\n]+)/)?.[1];
      if (!name) {
        alert(browser.i18n.getMessage('metaError'));
        return;
      }
      return confirm(browser.i18n.getMessage('installConfirm', name)) && [text, name];
    })();`;

    browser.tabs.executeScript(tabId, {code})
    .then((result = []) => result[0] && this.#processResponse(...result[0], tab.url))
    .catch(error => {
      App.log('directInstall', `${tab.url} ➜ ${error.message}`, 'error');
      this.#installConfirm(tab);
    });
  }

  static async #installConfirm(tab) {
    const text = await fetch(tab.url)
    .then(response => response.text())
    .catch(error => App.log('installConfirm fetch error', `${tab.url} ➜ ${error.message}`, 'error'));

    const name = text?.match(/(?:\/\/)?\s*@name\s+([^\r\n]+)/)?.[1];
    if (!name) {
      App.log('installConfirm', `${tab.url} ➜ ${browser.i18n.getMessage('metaError')}`, 'error');
      App.notify(`installConfirm fetch error\n${tab.url}`);
      return;
    }

    // workaround for
    // https://bugzilla.mozilla.org/show_bug.cgi?id=1411641
    // https://bugzilla.mozilla.org/show_bug.cgi?id=1267027
    const {id} = await browser.tabs.create({url: '/content/install.html'});

    const code = `(() => {
      document.querySelector('pre').textContent = ${JSON.stringify(text)};
      return confirm(browser.i18n.getMessage('installConfirm', ${JSON.stringify(name)}));
    })();`;

    browser.tabs.executeScript(id, {code})
    .then((result = []) => {
      result[0] && this.#processResponse(text, name, tab.url);
      browser.tabs.remove(id);
      browser.tabs.update(tab.id, {active: true});
    });
  }

  static async stylish(url) {
    // userstyles.org
    if (!/^https:\/\/userstyles\.org\/styles\/\d+/.test(url)) { return; }

    const code = `(() => {
      const name = document.querySelector('meta[property="og:title"]').content.trim();
      const description = document.querySelector('meta[name="twitter:description"]').content.trim()
          .replace(/\s*<br>\s*/g, '').replace(/\s\s+/g, ' ');
      const author = document.querySelector('#style_author a').textContent.trim();
      const lastUpdate = document.querySelector('#left_information > div:last-of-type > div:last-of-type').textContent.trim();
      const updateURL = (document.querySelector('link[rel="stylish-update-url"]') || {href: ''}).href;
      return {name, description, author, lastUpdate, updateURL};
    })();`;

    const [{name, description, author, lastUpdate, updateURL}] = await browser.tabs.executeScript({code});
    if (!name || !updateURL) {
      App.notify(browser.i18n.getMessage('error'));
      return;
    }

    const version = lastUpdate ? new Date(lastUpdate).toLocaleDateString("en-GB").split('/').reverse().join('') : '';

    const metaData =
`/*
==UserStyle==
@name           ${name}
@description    ${description}
@author         ${author}
@version        ${version}
@homepage       ${url}
==/UserStyle==
*/`;

    fetch(updateURL)
    .then(response => response.text())
    .then(text => {
      if (text.includes('@-moz-document')) {
        this.#processResponse(metaData + '\n\n' + text, name, updateURL);
        App.notify(`${name}\nInstalled version ${version}`);
      }
      else {
        App.notify(browser.i18n.getMessage('error'));       // <head><title>504 Gateway Time-out</title></head>
      }
    })
    .catch(error => App.log(item.name, `stylish ${updateURL} ➜ ${error.message}`, 'error'));
  }
  // ---------- /Web|Direct Installer ----------------------

  // ---------- Remote Update ------------------------------
  static async #onIdle(state) {
    if (state !== 'idle') { return; }

    const pref = await browser.storage.local.get();
    const now = Date.now();
    const days = pref.autoUpdateInterval *1;
    if (!days || now <= pref.autoUpdateLast + (days * 86400000)) { return; } // 86400 * 1000 = 24hr

    if (!this.cache[0]) {                                   // rebuild the cache if empty
      this.cache = App.getIds(pref).filter(id => pref[id].autoUpdate && pref[id].updateURL && pref[id].version);
    }

    // do 10 updates at a time & check if script wasn't deleted
    this.cache.splice(0, 10).forEach(item => pref.hasOwnProperty(item) && RemoteUpdate.getUpdate(pref[item]));

    // set autoUpdateLast after updates are finished
    !this.cache[0] && browser.storage.local.set({autoUpdateLast: now}); // update saved pref
  }

  static async #processResponse(text, name, updateURL) {            // from class RemoteUpdate.callback
    const pref = await browser.storage.local.get();
    const data = Meta.get(text, pref);
    if (!data) {
      throw `${name}: Meta Data error`;
    }

    const id = `_${data.name}`;                             // set id as _name
    const oldId = `_${name}`;

    // --- check name, if update existing
    if (pref[oldId] && data.name !== name) {                // name has changed
      if (pref[id]) {                                       // name already exists
        throw `${name}: Update new name already exists`;
      }

      pref[id] = pref[oldId];                               // copy to new id
      delete pref[oldId];                                   // delete old id
      browser.storage.local.remove(oldId);                  // remove old data (will get unregistered in processPrefUpdate)
    }

    // --- check version, if update existing, not for local files
    if (!updateURL.startsWith('file:///') && pref[id] &&
          !RemoteUpdate.higherVersion(data.version, pref[id].version)) { return; }

    // --- check for Web Install, set install URL
    if (!data.updateURL && !updateURL.startsWith('file:///')) {
      data.updateURL = updateURL;
      data.autoUpdate = true;
    }

    // --- log message to display in Options -> Log
    const message = pref[id] ? `Updated version ${pref[id].version} ➜ ${data.version}` : `Installed version ${data.version}`
    App.log(data.name, message, '', data.updateURL);

    pref[id] = data;                                        // save to pref
    browser.storage.local.set({[id]: pref[id]});            // update saved pref
  }
  // ---------- /Remote Update -----------------------------
}