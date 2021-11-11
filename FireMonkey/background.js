import {pref, App, Meta, RemoteUpdate, CheckMatches} from './app.js';
const RU = new RemoteUpdate();

// ----------------- Context Menu --------------------------
class ContextMenu {

  constructor() {
    const contextMenus = [
      { id: 'options', contexts: ['browser_action'], icons: {16: '/image/gear.svg'} },
      { id: 'newJS', contexts: ['browser_action'], icons: {16: '/image/js.svg'} },
      { id: 'newCSS', contexts: ['browser_action'], icons: {16: '/image/css.svg'} },
      { id: 'help', contexts: ['browser_action'], icons: {16: '/image/help.svg'} },
      { id: 'log', contexts: ['browser_action'], icons: {16: '/image/document.svg'} },
      { id: 'localeMaker', title: 'Locale Maker', contexts: ['browser_action'], icons: {16: '/locale-maker/locale-maker.svg'} },

      { id: 'stylish', contexts: ['all'], documentUrlPatterns: ['https://userstyles.org/styles/*/*'] }
    ];

    contextMenus.forEach(item => {
      if (item.id) {
        item.title = item.title || browser.i18n.getMessage(item.id);  // always use the same ID for i18n
        item.onclick = this.process;
      }
      browser.menus.create(item);
    });
  }

  process(info, tab, command) {
    switch (info.menuItemId) {
      case 'options': break;
      case 'newJS': localStorage.setItem('nav', 'js'); break;
      case 'newCSS': localStorage.setItem('nav', 'css'); break;
      case 'help': localStorage.setItem('nav', 'help'); break;
      case 'log': localStorage.setItem('nav', 'log'); break;
      case 'localeMaker': browser.tabs.create({url: '/locale-maker/locale-maker.html'}); return;
      case 'stylish': installer.stylish(tab.url); return;
    }
    browser.runtime.openOptionsPage();
  }
}
!App.android && new ContextMenu();                              // prepare for Android
// ----------------- /Context Menu -------------------------

// ----------------- Script Counter ------------------------
class Counter {

  constructor() {
    browser.browserAction.setBadgeBackgroundColor({color: '#cd853f'});
    browser.browserAction.setBadgeTextColor({color: '#fff'}); // FF63+
    this.process = this.process.bind(this);
  }

  init() {
    browser.tabs.onUpdated.addListener(this.process, {urls: ['http://*/*', 'https://*/*', 'file:///*']});
  }

  terminate() {
    browser.tabs.onUpdated.removeListener(this.process);
  }

  async process(tabId, changeInfo, tab) {
    if (changeInfo.status !== 'complete') { return; }

    const count = await CheckMatches.process(tabId, tab.url, true);
    browser.browserAction.setBadgeText({tabId, text: (count[0] ? count.length.toString() : '')});
    browser.browserAction.setTitle({tabId, title: (count[0] ? count.join('\n') : '')});
  }
}
const counter = new Counter();
// ----------------- /Script Counter -----------------------

// ----------------- Register Content Script|CSS -----------
class ScriptRegister {

  constructor() {
    this.registered = {};
    this.FMV = browser.runtime.getManifest().version;       // FireMonkey version
  }

  async init() {
    this.process = this.process.bind(this);
    this.platformInfo = await browser.runtime.getPlatformInfo();
    this.browserInfo = await browser.runtime.getBrowserInfo();
  }

  async process(id) {
    const script = JSON.parse(JSON.stringify(pref[id]));    // deep clone pref object
    script.style || (script.style = []);

    // --- reset previous registers  (UserStyle Multi-segment Process)
    script.style[0] ? script.style.forEach((item, i) => this.unregister(id + 'style' + i)) : this.unregister(id);

    // --- stop if script is not enabled or no mandatory matches
    if (!script.enabled || (!script.matches[0] && !script.style[0])) { return; }

    // --- preppare script options
    const options = {
      matches: script.matches,
      excludeMatches: script.excludeMatches,
      includeGlobs: script.includeGlobs,
      excludeGlobs: script.excludeGlobs,
      matchAboutBlank: script.matchAboutBlank,
      allFrames: script.allFrames,
      runAt: script.runAt
    };

    // --- add Global Script Exclude Matches
    script.js && pref.globalScriptExcludeMatches && options.excludeMatches.push(...pref.globalScriptExcludeMatches.split(/\s+/));

    // --- prepare for include/exclude
    (script.includes[0] || script.excludes[0] || script.includeGlobs[0] || script.excludeGlobs[0]) &&
          options.matches.push('*://*/*', 'file:///*');
    options.matches = [...new Set(options.matches)];        // remove duplicates

    // --- remove empty arrays (causes error)
    ['excludeMatches', 'includeGlobs', 'excludeGlobs'].forEach(item => !options[item][0] && delete options[item]);

    // --- add CSS & JS
    const {name, require, requireRemote} = script;
    const target = script.js ? 'js' : 'css';
    const js = target === 'js';
    const page = js && script.injectInto === 'page';
    const pageURL = page ? '%20(page-context)'  : '';
    const encodeId = encodeURI(name);
    const sourceURL = `\n\n//# sourceURL=user-script:FireMonkey/${encodeId}${pageURL}/`;
    options[target] = [];

    // --- add @require
    require.forEach(item => {
      const id = `_${item}`;
      if (item.startsWith('lib/')) {
        requireRemote.push('/' + item);
      }
      else if (pref[id] && pref[id][target]) {              // same type only
        let code = this.prepareMeta(pref[id][target]);
        js && (code += sourceURL + encodeURI(item) + '.user.js');
        page && (code = `GM_addScript(${JSON.stringify(code)})`);
        options[target].push({code});
      }
    });

    // --- add @requireRemote
    if (requireRemote[0]) {
      await Promise.all(requireRemote.map(url =>
        fetch(url)
        .then(response => response.text())
        .then(code => {
          url.startsWith('/lib/') && (url = url.slice(1, -1));
          js && (code += sourceURL + encodeURI(url));
          page && (code = `GM_addScript(${JSON.stringify(code)})`);
          options[target].push({code});
        })
        .catch(() => null)
      ));
    }


    // --- script only
    if (js) {
      const {includes, excludes} = script;
      options.scriptMetadata = {
        name,
        resource: script.resource,
        storage: script.storage,
        injectInto: script.injectInto,
        info: {                                             // GM.info data
          scriptHandler: 'FireMonkey',
          version: this.FMV,
          scriptMetaStr: null,
          platform: this.platformInfo,
          browser: this.browserInfo,
          script: {
            name,
            version: script.version,
            description: script.description,
            includes,
            excludes,
            matches: script.matches,
            excludeMatches: script.excludeMatches,
            includeGlobs: script.includeGlobs,
            excludeGlobs: script.excludeGlobs,
            'run-at': script.runAt.replace('_', '-'),
            namespace: null,
            resources: script.resource
          }
        }
      };

      // --- add debug
      script.js += sourceURL + encodeId + '.user.js';

      // --- process inject-into page context
      if (page) {
        const str = `((unsafeWindow, GM, GM_info = GM.info) => {(() => { ${script.js}
})();})(window, ${JSON.stringify({info:options.scriptMetadata.info})});`;
        script.js = `GM_addScript(${JSON.stringify(str)});`;
      }

      // --- unsafeWindow implementation & Regex include/exclude workaround
      const code = (includes[0] || excludes[0] ? `if (!matchURL()) { throw ''; } ` : '') +
                    (page ? '' : 'const unsafeWindow = window.wrappedJSObject;');

      code.trim() && options.js.push({code});
    }

    // --- add code
    options[target].push({code: this.prepareMeta(script[target])});

    if (script.style[0]) {
      // --- UserStyle Multi-segment Process
      script.style.forEach((item, i) => {
        options.matches = item.matches;
        options.css = [{code: item.css}];
        this.register(id + 'style' + i, options, id);
      });
    }
    else { this.register(id, options); }
  }

  // fixing metaBlock since there would be an error with /* ... *://*/* ... */
  prepareMeta(str) {
    return str.replace(Meta.regEx, (m) => m.replace(/\*\//g, '* /'));
  }

  register(id, options, originId) {
    const API = options.js ? browser.userScripts : browser.contentScripts;
    // --- register page script
    try {                                                   // catches error throws before the Promise
      API.register(options)
      .then(reg => this.registered[id] = reg)               // contentScripts.RegisteredContentScript object
      .catch(error => App.log((originId || id).substring(1), `Register ➜ ${error.message}`, 'error'));
    } catch(error) { this.processError(originId || id, error.message); }
  }

  async unregister(id) {
    if (!this.registered[id]) { return; }
    await this.registered[id].unregister();
    delete this.registered[id];
  }

  processError(id, error) {
    pref[id].error = error;                                 // store error message
    browser.storage.local.set({[id]: pref[id]});            // update saved pref
    App.log(id.substring(1), `Register ➜ ${error}`, 'error'); // log message to display in Options -> Log
  }
}
const scriptReg = new ScriptRegister();
// ----------------- /Register Content Script|CSS ----------

// ----------------- User Preference -----------------------
App.getPref().then(() => new ProcessPref());

class ProcessPref {

  constructor() {
    this.process();
  }

  async process() {
    pref.sync && await Sync.get();                          // storage sync ➜ local update

    await Migrate.run();                                    // migrate after storage sync check

    browser.storage.onChanged.addListener((changes, area) => { // Change Listener, after migrate
      switch (true) {
        case Sync.noUpdate:                                 // prevent loop from sync update
          Sync.noUpdate = false;
          break;

        case area === 'local':
          Object.keys(changes).forEach(item => pref[item] = changes[item].newValue); // update pref with the saved version
          this.processPrefUpdate(changes, area);            // apply changes
          pref.sync && Sync.set(changes);                   // set changes to sync
          break;

        case area === 'sync':                               // from sync
          pref.sync && Sync.apply(changes);                 // apply changes to local
          break;
      }
    });

    await scriptReg.init();                                 // await data initialization
    App.getIds().forEach(item => scriptReg.process(item));

    // --- Script Counter
    pref.counter && counter.init();
  }

  async processPrefUpdate(changes, area) {
    // check counter preference has changed
    if (changes.counter && changes.counter.newValue !== changes.counter.oldValue) {
      changes.counter.newValue ? counter.init() : counter.terminate();
    }

    // global change
    if (changes.globalScriptExcludeMatches &&
      changes.globalScriptExcludeMatches.oldValue !== changes.globalScriptExcludeMatches.newValue) {
      App.getIds().forEach(scriptReg.process);              // re-register all
    }
    // find changed scripts
    else {
      const relevant = ['name', 'enabled', 'injectInto', 'require', 'requireRemote', 'resource',
      'allFrames', 'js', 'css', 'style', 'matches',
      'excludeMatches', 'includeGlobs', 'excludeGlobs', 'includes', 'excludes', 'matchAboutBlank', 'runAt'];

      Object.keys(changes).forEach(item => {
        if (!item.startsWith('_')) { return; }              // skip

        const oldValue = changes[item].oldValue;
        const newValue = changes[item].newValue;
        const id = item;

        // if deleted, unregister
        if(!newValue) {
          delete pref[id];
          oldValue.style[0] ? oldValue.style.forEach((item, i) => scriptReg.unregister(id + 'style' + i)) : scriptReg.unregister(id);
        }
        // if added or relevant data changed
        else if (!oldValue || relevant.some(i => !this.equal(oldValue[i], newValue[i]))) {
          scriptReg.process(id);
        }
      });
    }
  }

  equal(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
}

// ----- Storage Sync
class Sync {

  // --- storage sync ➜ local update
  static async get() {
    const deleted = [];
    await browser.storage.sync.get(null, result => {
      Object.keys(result).forEach(item => pref[item] = result[item]); // update pref with the saved version
      App.getIds().forEach(item => {
        if (!result[item]) {                                // remove deleted in sync from pref
          delete pref[item];
          deleted.push(item);
        }
      });
    });
    deleted[0] && await browser.storage.local.remove(deleted); // delete scripts from storage local
    await browser.storage.local.set(pref);                  // update local saved pref, no storage.onChanged.addListener() yet
  }

  // --- storage sync ➜ local update
  static async apply(changes) {
    const [keep, deleted] = this.sortChanges(changes);
    this.noUpdate = false;
    deleted[0] && await browser.storage.local.remove(deleted); // delete scripts from storage local
    browser.storage.local.set(keep)
    .catch(error => App.log('local', error.message, 'error'));
  }

  // --- storage local ➜ sync update
  static async set(changes) {
    const size = JSON.stringify(pref).length;
    if (size > 102400) {
      const text = browser.i18n.getMessage('syncError', (size/1024).toFixed(1));
      App.notify(text);
      App.log('Sync', text, 'error');
      pref.sync = false;
      this.noUpdate = true;
      browser.storage.local.set({sync: false});
      return;
    }

    const [keep, deleted] = this.sortChanges(changes);
    this.noUpdate = true;
    deleted[0] && await browser.storage.sync.remove(deleted); // delete scripts from storage sync
    this.noUpdate = true;
    browser.storage.sync.set(keep)
    .catch(error => {
      this.noUpdate = false;
      App.log('Sync', error.message, 'error');
    });
  }


  static sortChanges(changes) {
    const keep = {};
    const deleted = [];
    Object.keys(changes).forEach(item => {
      item.startsWith('_') && !changes[item].newValue ? deleted.push(item) : keep[item] = changes[item].newValue; // or pref[item]
    });
    return [keep, deleted];
  }
}
Sync.noUpdate = false;
// ----------------- /User Preference ----------------------

// ----------------- Web/Direct Installer & Remote Update --
class Installer {

  constructor() {
    // class RemoteUpdate in app.js
    RU.callback = this.processResponse.bind(this);

    // --- Web/Direct Installer
    this.webInstall = this.webInstall.bind(this);
    this.directInstall = this.directInstall.bind(this);

    browser.webRequest.onBeforeRequest.addListener(this.webInstall, {
        urls: [ 'https://greasyfork.org/scripts/*.user.js',
                'https://greasyfork.org/scripts/*.user.css',
                'https://sleazyfork.org/scripts/*.user.js',
                'https://sleazyfork.org/scripts/*.user.css',
                'https://openuserjs.org/install/*.user.js'],
        types: ['main_frame']
      },
      ['blocking']
    );

    // extraParameters not supported on Android
    App.android ?
      browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) =>
        /\.user\.(js|css)$/i.test(tab.url) && this.directInstall(tabId, changeInfo, tab)) :
      browser.tabs.onUpdated.addListener(this.directInstall, {
        urls: ['*://*/*.user.js', '*://*/*.user.css', 'file:///*.user.js', 'file:///*.user.css']
      });

    // --- Remote Update
    this.cache = [];
    browser.idle.onStateChanged.addListener(state => this.onIdle(state));
  }

  // --------------- Web/Direct Installer ------------------
  webInstall(e) {
    let q;
    switch (true) {
      case !e.originUrl: return;                            // end execution if not Web Install

      // --- GreasyFork & sleazyfork
      case e.originUrl.startsWith('https://greasyfork.org/') && e.url.startsWith('https://greasyfork.org/'):
      case e.originUrl.startsWith('https://sleazyfork.org/') && e.url.startsWith('https://sleazyfork.org/'):
        q = 'header h2';
        break;

      // --- OpenUserJS
      case e.originUrl.startsWith('https://openuserjs.org/') && e.url.startsWith('https://openuserjs.org/'):
        q = 'a[class="script-name"]';
        break;
    }

    if (q) {
      const code = `(() => {
        let title = document.querySelector('${q}');
        title = title ? title.textContent : document.title;
        return confirm(browser.i18n.getMessage('installConfirm', title)) ? title : null;
      })();`;

      browser.tabs.executeScript({code})
      .then((result = []) => result[0] && RU.getScript({updateURL: e.url, name: result[0]}))
      .catch(error => App.log('webInstall', `${e.url} ➜ ${error.message}`, 'error'));

      return {cancel: true};
    }
  }

  directInstall(tabId, changeInfo, tab) {
    if (changeInfo.status !== 'complete') { return; }       // end execution if not found
    if (tab.url.startsWith('https://github.com/')) { return; } // not on https://github.com/*/*.user.js

    // work-around for https://bugzilla.mozilla.org/show_bug.cgi?id=1411641
    // using https://cdn.jsdelivr.net mirror
    if (tab.url.startsWith('https://raw.githubusercontent.com/')) {
      // https://raw.githubusercontent.com/<username>/<repo>/<branch>/path/to/file.js
      const p = tab.url.split(/:?\/+/);
      browser.tabs.update({url: `https://cdn.jsdelivr.net/gh/${p[2]}/${p[3]}@${p[4]}/${p.slice(5).join('/')}` });
      return;
    }

    const code = String.raw`(() => {
      const pre = document.body;
      if (!pre || !pre.textContent.trim()) { alert(browser.i18n.getMessage('metaError')); return; }
      const name = pre.textContent.match(/(?:\/\/)?\s*@name\s+([^\r\n]+)/);
      if (!name) { alert(browser.i18n.getMessage('metaError')); return; }
      return confirm(browser.i18n.getMessage('installConfirm', name[1])) ? [pre.textContent, name[1]] : null;
    })();`;

    browser.tabs.executeScript({code})
    .then((result = []) => result[0] && this.processResponse(result[0][0], result[0][1], tab.url))
    .catch(error => App.log('directInstall', `${tab.url} ➜ ${error.message}`, 'error'));
  }

  async stylish(url) {                                      // userstyles.org

    if (!/^https:\/\/userstyles\.org\/styles\/\d+/.test(url)) { return; }

    const code = `(() => {
      const name = document.querySelector('meta[property="og:title"]').content.trim();
      const description = document.querySelector('meta[name="twitter:description"]').content.trim().replace(/\s*<br>\s*/g, '').replace(/\s\s+/g, ' ');
      const author = document.querySelector('#style_author a').textContent.trim();
      const lastUpdate = document.querySelector('#left_information > div:last-of-type > div:last-of-type').textContent.trim();
      const updateURL = (document.querySelector('link[rel="stylish-update-url"]') || {href: ''}).href;
      return {name, description, author, lastUpdate, updateURL};
    })();`;

    const [{name, description, author, lastUpdate, updateURL}] = await browser.tabs.executeScript({code});
    if (!name || !updateURL) { App.notify(browser.i18n.getMessage('error')); return; }

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
    .then(text =>  {
      if (text.includes('@-moz-document')) {
        this.processResponse(metaData + '\n\n' + text, name, updateURL);
        App.notify(`${name}\nInstalled version ${version}`);
      }
      else { App.notify(browser.i18n.getMessage('error')); } // <head><title>504 Gateway Time-out</title></head>
    })
    .catch(error => App.log(item.name, `stylish ${updateURL} ➜ ${error.message}`, 'error'));
  }
  // --------------- /Web|Direct Installer -----------------

  // --------------- Remote Update -------------------------
  onIdle(state) {
    if (state !== 'idle') { return; }

    const now = Date.now();
    const days = pref.autoUpdateInterval *1;
    const doUpdate =  days && now > pref.autoUpdateLast + (days * 86400000); // 86400 * 1000 = 24hr
    if (!doUpdate) { return; }

    if (!this.cache[0]) {                                   // rebuild the cache if empty
      this.cache = App.getIds().filter(item => pref[item].autoUpdate && pref[item].updateURL && pref[item].version);
    }

    // --- do 10 updates at a time & check if script wasn't deleted
    this.cache.splice(0, 10).forEach(item => pref.hasOwnProperty(item) && RU.getUpdate(pref[item]));

    // --- set autoUpdateLast after updates are finished
    !this.cache[0] && browser.storage.local.set({autoUpdateLast: now}); // update saved pref
  }

  processResponse(text, name, updateURL) {                  // from class RU.callback in app.js

    const data = Meta.get(text);
    if (!data) { throw `${name}: Meta Data error`; }

    const id = `_${data.name}`;                             // set id as _name
    const oldId = `_${name}`;

    // --- check name, if update existing
    if (pref[oldId] && data.name !== name) {                // name has changed
      if (pref[id]) { throw `${name}: Update new name already exists`; } // name already exists

      scriptReg.unregister(oldId);                          // unregister old id
      pref[id] = pref[oldId];                               // copy to new id
      delete pref[oldId];                                   // delete old id
      browser.storage.local.remove(oldId);                  // remove old data
    }

    // --- revert https://cdn.jsdelivr.net/gh/ URL to https://raw.githubusercontent.com/
    if (updateURL.startsWith('https://cdn.jsdelivr.net/gh/')) {
      updateURL = 'https://raw.githubusercontent.com/' + updateURL.substring(28).replace('@', '/');
    }

    // --- check version, if update existing, not for local files
    if (!updateURL.startsWith('file:///') && pref[id] &&
          !RU.higherVersion(data.version, pref[id].version)) { return; }

    // --- check for Web Install, set install URL
    if (App.allowedHost(updateURL)) {
      data.updateURL = updateURL;
      data.autoUpdate = true;
    }

    // --- update from previous version
    pref[id] && ['enabled', 'autoUpdate', 'storage', 'userMeta'].forEach(item => data[item] = pref[id][item]);

    // ---  log message to display in Options -> Log
    App.log(data.name, pref[id] ? `Updated version ${pref[id].version} to ${data.version}` : `Installed version ${data.version}`);

    pref[id] = data;                                        // save to pref
    browser.storage.local.set({[id]: pref[id]});            // update saved pref
  }
  // --------------- /Remote Update ------------------------
}
const installer = new Installer();
// ----------------- /Web|Direct Installer & Remote Update -

// ----------------- Content Message Handler ---------------
class API {

  constructor() {
    this.FMUrl = browser.runtime.getURL('');

    browser.webRequest.onBeforeSendHeaders.addListener(e => this.onBeforeSendHeaders(e),
      {urls: ['<all_urls>'], types: ['xmlhttprequest']},
      ['blocking', 'requestHeaders']
    );

    browser.runtime.onMessage.addListener((message, sender) => this.process(message, sender));
  }

  onBeforeSendHeaders(e) {
    if(!e.originUrl || !e.originUrl.startsWith(this.FMUrl)) { return; } // not from FireMonkey

    const cookies = [];
    const idx = [];
    e.requestHeaders.forEach((item, index) => {             // userscript + contextual cookies
      if (item.name.startsWith('FM-')) {
        item.name = item.name.substring(3);
        if (['Cookie', 'Contextual-Cookie'].includes(item.name)) {
           item.value && cookies.push(item.value);
           idx.push(index);
        }
      }
      else if (item.name === 'Cookie') {                    // original Firefox cookie
        cookies.push(item.value);
        idx.push(index);
      }
      // Webextension UUID leak via Fetch requests
      // https://bugzilla.mozilla.org/show_bug.cgi?id=1405971
      else if (item.name === 'Origin' && item.value.includes('moz-extension://')) {
        item.value = '';
      }
    });

    idx[0] && (e.requestHeaders = e.requestHeaders.filter((item, index) => !idx.includes(index))); // remove entries
    cookies[0] && e.requestHeaders.push({name: 'Cookie', value: cookies.join('; ')}); // merge all Cookie headers

    return {requestHeaders: e.requestHeaders};
  }

  process(message, sender) {
    const {name, api, data: e, id = `_${name}`} = message;
    if (!api) { return; }
    // only set if in container/incognito
    const storeId = sender.tab.cookieStoreId !== 'firefox-default' && sender.tab.cookieStoreId;

    switch (api) {
      case 'log':                                           // internal use only (not GM API)
        return App.log(name, e.message, e.type);

      case 'getValue':
        return Promise.resolve(pref[id].storage.hasOwnProperty(e.key) ? pref[id].storage[e.key] : e.defaultValue);

      case 'listValues':
        return Promise.resolve(Object.keys(pref[id].storage));

      case 'setValue':
        if (JSON.stringify(pref[id].storage[e.key]) === JSON.stringify(e.value)) {
          return Promise.resolve();                         // return if value hasn't changed
        }
        pref[id].storage[e.key] = e.value;
        return browser.storage.local.set({[id]: pref[id]}); // Promise with no arguments OR reject with error message

      case 'deleteValue':
        if (!pref[id].storage.hasOwnProperty(e.key)) {
          return Promise.resolve();                         // return if nothing to delete
        }
        delete pref[id].storage[e.key];
        return browser.storage.local.set({[id]: pref[id]}); // Promise with no arguments OR reject with error message

      case 'openInTab':
        return browser.tabs.create({url: e.url, active: e.active}) // Promise with tabs.Tab OR reject with error message
          .catch(error => App.log(name, `${message.api} ➜ ${error.message}`, 'error'));

      case 'setClipboard':
        return navigator.clipboard.writeText(e.text)        // Promise with ? OR reject with error message
          .catch(error => App.log(name, `${message.api} ➜ ${error.message}`, 'error'));

      case 'notification':                                  // Promise with notification's ID
        return browser.notifications.create('', {
          type: 'basic',
          iconUrl: e.image || 'image/icon.svg',
          title: name,
          message: e.text
        });

      case 'download':
        return browser.downloads.download({                 // Promise with id OR reject with error message
          url: e.url,
          filename: e.filename ? e.filename : null,
          saveAs: true,
          conflictAction: 'uniquify',
          cookieStoreId: storeId && storeId !== 'firefox-private' ? storeId : 'firefox-default',
          incognito: sender.tab.incognito
        })
        .catch(error => App.log(name, `${message.api} ➜ ${error.message}`, 'error'));  // failed notification

      case 'fetch':
        return this.fetch(e, storeId);

      case 'xmlHttpRequest':
        return this.xmlHttpRequest(e, storeId);
    }
  }

  async addCookie(url, headers, storeId) {
    // add contexual cookies, only in container/incognito
    const cookies = await browser.cookies.getAll({url, storeId});
    const str = cookies && cookies.map(item => `${item.name}=${item.value}`).join('; ');
    str && (headers['FM-Contextual-Cookie'] = str);
  }

  async fetch(e, storeId) {
    if (e.init.credentials !== 'omit' && storeId) {         // not anonymous AND in container/incognito
      e.init.credentials = 'omit';
      await this.addCookie(e.url, e.init.headers, storeId);
    }
    Object.keys(e.init.headers)[0] || delete e.init.headers; // clean up

    return fetch(e.url, e.init)
      .then(async response => {
        // --- build response object
        const res = {headers: {}};
        response.headers.forEach((value, name) => res.headers[name] = value);
        ['bodyUsed', 'ok', 'redirected', 'status', 'statusText', 'type', 'url'].forEach(item => res[item] = response[item]);

        if (e.init.method === 'HEAD') { return res; }   // end here

        switch (e.init.responseType) {
          case 'json': res['json'] = await response.json(); break;
          case 'blob': res['blob'] = await response.blob(); break;
          case 'arrayBuffer': res['arrayBuffer'] = await response.arrayBuffer(); break;
          case 'formData': res['formData'] = await response.formData(); break;
          default: res['text'] = await response.text();
        }
        return res;
      })
      .catch(error => App.log(name, `${message.api} ${url} ➜ ${error.message}`, 'error'));
  }

  async xmlHttpRequest(e, storeId) {
    if (!e.mozAnon && storeId) {                            // not anonymous AND in container/incognito
      e.mozAnon = true;
      await this.addCookie(e.url, e.headers, storeId);
    }
    Object.keys(e.headers)[0] || delete e.headers;          // clean up

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest({mozAnon: e.mozAnon});
      xhr.open(e.method, e.url, true, e.user, e.password);
      e.overrideMimeType && xhr.overrideMimeType(e.overrideMimeType);
      xhr.responseType = e.responseType;
      e.timeout && (xhr.timeout = e.timeout);
      e.hasOwnProperty('withCredentials') && (xhr.withCredentials = e.withCredentials);
      e.headers && Object.keys(e.headers).forEach(item => xhr.setRequestHeader(item, e.headers[item]));
      xhr.send(e.data);

      xhr.onload =      () => resolve(this.makeResponse(xhr, 'onload'));
      xhr.onerror =     () => resolve(this.makeResponse(xhr, 'onerror'));
      xhr.ontimeout =   () => resolve(this.makeResponse(xhr, 'ontimeout'));
      xhr.onabort =     () => resolve(this.makeResponse(xhr, 'onabort'));
      xhr.onprogress =  () => {};
    });
  }

  makeResponse(xhr, type) {
    return {
      type,
      readyState:       xhr.readyState,
      response:         xhr.response,
      responseHeaders:  xhr.getAllResponseHeaders(),
      responseText:     ['', 'text'].includes(xhr.responseType) ? xhr.responseText : '', // responseText is only available if responseType is '' or 'text'.
      responseType:     xhr.responseType,
      responseURL:      xhr.responseURL,
      responseXML:      ['', 'document'].includes(xhr.responseType) ? xhr.responseXML : '', // responseXML is only available if responseType is '' or 'document'.
      status:           xhr.status,
      statusText:       xhr.statusText,
      timeout:          xhr.timeout,
      withCredentials:  xhr.withCredentials,
      finalUrl:         xhr.responseURL
    };
  }
}
new API();
// ----------------- /Content Message Handler --------------

// ----------------- Migrate -------------------------------
class Migrate {

  static async run() {
    const m = 2.35;
    const version = localStorage.getItem('migrate') || 0;
    if (version*1 >= m) { return; } // double check for v2.25 migrate backward compatibility

    // --- v1.31 migrate 2020-03-13
    if (pref.hasOwnProperty('disableHighlight')) {
      delete pref.disableHighlight;
      await browser.storage.local.remove('disableHighlight');
    }

    // --- v2.0 migrate 2020-12-08
    !localStorage.getItem('theme') && localStorage.getItem('dark') === 'true' && localStorage.setItem('theme', 'darcula');
    localStorage.removeItem('syntax');

    // --- v2.25 migrate 2021-05-08
    if (pref.hasOwnProperty('content')) {
      localStorage.removeItem('pinMenu');

      // --- combined migration
      // --- v2.25  migrate 2021-05-08
      // --- v2.5   migrate 2020-12-14
      // --- v2.0   migrate 2020-12-08
      // --- v1.36  migrate 2020-05-25
      const data = {
        // --- extension related data
        name: '',
        author: '',
        description: '',
        updateURL: '',
        enabled: true,
        autoUpdate: false,
        version: '',
        antifeatures: [],
        injectInto: '',

        require: [],
        requireRemote: [],
        resource: {},
        userMatches: '',
        userExcludeMatches: '',
        userRunAt: '',
        i18n: {name: {}, description: {}},
        error: '',
        storage: {},

        // --- API related data
        allFrames: false,
        js: '',
        css: '',
        style: [],
        matches: [],
        excludeMatches: [],
        includeGlobs: [],
        excludeGlobs: [],
        includes: [],
        excludes: [],
        matchAboutBlank: false,
        runAt: 'document_idle'
      };

      Object.keys(pref.content).forEach(item => {

        // add & set to default if missing
        Object.keys(data).forEach(key => pref.content[item].hasOwnProperty(key) || (pref.content[item][key] = data[key]));

        // --- v1.36 migrate 2020-05-25
        pref.content[item].require.forEach((lib, i) => {

          switch (lib) {
            case 'lib/jquery-1.12.4.min.jsm':     pref.content[item].require[i] = 'lib/jquery-1.jsm'; break;
            case 'lib/jquery-2.2.4.min.jsm':      pref.content[item].require[i] = 'lib/jquery-2.jsm'; break;
            case 'lib/jquery-3.4.1.min.jsm':      pref.content[item].require[i] = 'lib/jquery-3.jsm'; break;
            case 'lib/jquery-ui-1.12.1.min.jsm':  pref.content[item].require[i] = 'lib/jquery-ui-1.jsm'; break;
            case 'lib/bootstrap-4.4.1.min.jsm':   pref.content[item].require[i] = 'lib/bootstrap-4.jsm'; break;
            case 'lib/moment-2.24.0.min.jsm':     pref.content[item].require[i] = 'lib/moment-2.jsm'; break;
            case 'lib/underscore-1.9.2.min.jsm':  pref.content[item].require[i] = 'lib/underscore-1.jsm'; break;
          }
        });

        // --- v2.25 move script & storage
        pref.content[item].storage = pref[`_${item}`] || {};  // combine with  script storage
        pref[`_${item}`] = pref.content[item];                // move to pref from  pref.content
      });
      delete pref.content;
      await browser.storage.local.remove('content');
    }

    // --- v2.35 migrate 2021-11-09
    App.getIds().forEach(id => {
      const item = pref[id];
      const meta = [];
      if (item.userMatches) {
        const arr = item.userMatches.split(/\s+/);
        meta.push(...arr.map(m => `@match           ${m}`));
        item.matches.push(...arr);
      }

      if (item.userExcludeMatches) {
        const arr = item.userMatches.split(/\s+/);
        meta.push(...arr.map(m => `@exclude-match   ${m}`));
        item.excludeMatches.push(...arr);
      }

      if (item.userRunAt) {
        meta.push(`@run-at          ${item.userRunAt}`);
        item.runAt = item.userRunAt;
      }

      item.userMeta = meta.join('\n');
      delete item.userMatches;
      delete item.userExcludeMatches;
      delete item.userRunAt;
    });

    // --- update database
    await browser.storage.local.set(pref);
    localStorage.setItem('migrate', m);                     // store migrate version locally
  }
}
// ----------------- /Migrate ------------------------------