import {pref, App, Meta} from './app.js';
import {RemoteUpdate} from './remote-update.js';
import {Match} from './match.js';

// ----------------- Process Preference --------------------
class ProcessPref {

  async process() {
    await Sync.get();                                       // storage sync ➜ local update

    await Migrate.run();                                    // migrate after storage sync check

    browser.storage.onChanged.addListener((changes, area) => { // Change Listener, after migrate
      switch (true) {
        case Sync.noUpdate:                                 // prevent loop from sync update
          Sync.noUpdate = false;
          break;

        case area === 'local':
          Object.keys(changes).forEach(item => pref[item] = changes[item].newValue); // update pref with the saved version
          this.processPrefUpdate(changes, area);            // apply changes
          Sync.set(changes);                                // set changes to sync
          break;

        case area === 'sync':                               // from sync
          Sync.apply(changes);                              // apply changes to local
          break;
      }
    });

    await scriptReg.init();                                 // await data initialization
    App.getIds().forEach(item => scriptReg.process(item));

    // --- Script Counter
    counter.init();
  }

  processPrefUpdate(changes, area) {
    // check counter preference has changed
    if (changes.counter && changes.counter.newValue !== changes.counter.oldValue) {
      counter.init();
    }

    // global change
    if (changes.globalScriptExcludeMatches &&
      changes.globalScriptExcludeMatches.newValue !== changes.globalScriptExcludeMatches.oldValue) {
      App.getIds().forEach(scriptReg.process);              // re-register all
    }
    // find changed scripts
    else {
      const relevant = ['name', 'enabled', 'injectInto', 'require', 'requireRemote', 'resource',
      'allFrames', 'js', 'css', 'style', 'container', 'grant',
      'matches', 'excludeMatches', 'includeGlobs', 'excludeGlobs', 'includes', 'excludes', 'matchAboutBlank', 'runAt'];

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

          // apply userCSS changes to tabs
          switch (true) {
            case !newValue.css:                             // not userCSS
              break;

            case !oldValue.enabled && newValue.enabled:     // enabled
              this.updateTabs(id);
              break;

            case newValue.enabled && oldValue.css !== newValue.css: // enabled & CSS change
            case oldValue.enabled && !newValue.enabled:     // disabled
              this.updateTabs(id, oldValue.css);
              break;
          }
        }
      });
    }
  }

  equal(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  updateTabs(id, oldCSS) {
    const {name, css, allFrames, enabled} = pref[id];
    const gExclude = pref.globalScriptExcludeMatches?.split(/\s+/) || [];

    browser.tabs.query({}).then(tabs => {
      tabs.forEach(async tab => {
        if (tab.discarded)  { return; }
        if (!Match.supported(tab.url)) { return; }

        let urls;
        if (allFrames) {
          const frames = await browser.webNavigation.getAllFrames({tabId: tab.id});
          urls = [...new Set(frames.map(Match.cleanUrl).filter(Match.supported))];
        }
        else {
          urls = [Match.cleanUrl(tab.url)];
        }

        const containerId = tab.cookieStoreId.substring(8);
        if (!Match.get(pref[id], tab.url, urls, gExclude, containerId)) { return; }

        oldCSS && browser.tabs.removeCSS(tab.id, {code: Meta.prepare(oldCSS), allFrames});
        enabled && browser.tabs.insertCSS(tab.id, {code: Meta.prepare(css), allFrames});
      });
    });
  }
}
const processPref = new ProcessPref();
// ----------------- /Process Preference -------------------

// ----------------- Storage Sync --------------------------
class Sync {

  static allowed() {
    if (!pref.sync) { return; }

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
    return true;
  }

  // --- storage sync ➜ local update (must be async)
  static async get() {
    if (!this.allowed()) { return; }

    const result = await browser.storage.sync.get();
    if (!Object.keys(result)[0]) { return; }

    Object.keys(result).forEach(item => pref[item] = result[item]); // update pref with the saved version

    const deleted = [];
    App.getIds().forEach(item => {
      if (!result[item]) {                                  // remove deleted in sync from pref
        delete pref[item];
        deleted.push(item);
      }
    });
    deleted[0] && await browser.storage.local.remove(deleted); // delete scripts from storage local
    browser.storage.local.set(pref);                        // update local saved pref, no storage.onChanged.addListener() yet
  }

  // --- storage sync ➜ local update
  static async apply(changes) {
    if (!this.allowed()) { return; }

    const [keep, deleted] = this.sortChanges(changes);
    this.noUpdate = false;
    deleted[0] && await browser.storage.local.remove(deleted); // delete scripts from storage local
    browser.storage.local.set(keep)
    .catch(error => App.log('local', error.message, 'error'));
  }

  // --- storage local ➜ sync update
  static set(changes) {
    if (!this.allowed()) { return; }

    const [keep, deleted] = this.sortChanges(changes);
    this.noUpdate = true;
    browser.storage.sync.set(keep)
    .then(() => deleted[0] && browser.storage.sync.remove(deleted)) // delete scripts from storage sync
    .catch(error => {
      this.noUpdate = false;
      App.log('Sync', error.message, 'error');
    });
  }

  static sortChanges(changes) {
    const keep = {};
    const deleted = [];
    Object.keys(changes).forEach(item => {
      item.startsWith('_') && !changes[item].newValue ? deleted.push(item) :
          keep[item] = changes[item].newValue;              // or pref[item]
    });
    return [keep, deleted];
  }
}
Sync.noUpdate = false;
// ----------------- /Storage Sync -------------------------

// ----------------- Context Menu --------------------------
class ContextMenu {

  constructor() {
    const contextMenus = [
      {id: 'options', contexts: ['browser_action'], icons: {16: '/image/gear.svg'}},
      {id: 'newJS', contexts: ['browser_action'], icons: {16: '/image/js.svg'}},
      {id: 'newCSS', contexts: ['browser_action'], icons: {16: '/image/css.svg'}},
      {id: 'help', contexts: ['browser_action'], icons: {16: '/image/help.svg'}},
      {id: 'log',  contexts: ['browser_action'], icons: {16: '/image/document.svg'}},
      {id: 'localeMaker', contexts: ['browser_action'], icons: {16: '/locale-maker/locale-maker.svg'}, title: 'Locale Maker'},

      {id: 'stylish', contexts: ['all'], documentUrlPatterns: ['https://userstyles.org/styles/*/*']}
    ];

    contextMenus.forEach(item => {
      if (item.id) {
        !item.title && (item.title = browser.i18n.getMessage(item.id));  // always use the same ID for i18n
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
// menus not supported on Android
!App.android && new ContextMenu();
// ----------------- /Context Menu -------------------------

// ----------------- Script Counter ------------------------
class Counter {

  constructor() {
    browser.browserAction.setBadgeBackgroundColor({color: '#cd853f'});
    browser.browserAction.setBadgeTextColor({color: '#fff'});
  }

  init() {
    if (!pref.counter) {
      browser.tabs.onUpdated.removeListener(this.process);
      return;
    }

    // extraParameters not supported on Android
    App.android ?
      browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) =>
          /^(http|file:)/i.test(tab.url) && this.process(tabId, changeInfo, tab)) :
      browser.tabs.onUpdated.addListener(this.process, {
        urls: ['*://*/*', 'file:///*'],
        properties: ['status']
      });
  }

  process(tabId, changeInfo, tab) {
    if (changeInfo.status !== 'complete') { return; }

    Match.process(tab, App.getIds(), pref, true)
    .then(count => {
      browser.browserAction.setBadgeText({tabId, text: count[0] ? count.length + '' : ''});
      browser.browserAction.setTitle({tabId, title: count[0] ? count.join('\n') : ''});
    });
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
//    this.process = this.process.bind(this);
    this.platformInfo = await browser.runtime.getPlatformInfo();
    this.browserInfo = await browser.runtime.getBrowserInfo();
    this.containerSupport = {
      css: false,
      js: false
    };
    this.checkContainerSupport();
  }

  checkContainerSupport() {
    const options = {
      matches: ['*://example.com/*'],
      js: [{code: ''}],
      cookieStoreId: 'invalid-cookieStoreId'
    };

    // firefox97 https://bugzilla.mozilla.org/show_bug.cgi?id=1470651
    try {
      browser.contentScripts.register(options)
      .catch(e => {});
      this.containerSupport.css = true;
    } catch {}

    // firefox98 https://bugzilla.mozilla.org/show_bug.cgi?id=1738567
    try {
      browser.userScripts.register(options)
     .catch(e => {});
      this.containerSupport.js = true;
    } catch {}
  }

  async process(id) {
    const script = JSON.parse(JSON.stringify(pref[id]));    // deep clone to prevent changes to the original
    script.style || (script.style = []);

    // --- reset previous registers  (UserStyle Multi-segment Process)
    script.style[0] ? script.style.forEach((item, i) => this.unregister(id + 'style' + i)) : this.unregister(id);

    // --- stop if script is not enabled or no mandatory matches
    if (!script.enabled || (!script.matches[0] && !script.includes[0] && !script.includeGlobs[0] && !script.style[0])) { return; }

    // --- prepare script options
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
    !script.matches[0] && (script.includes[0] || script.excludes[0] || script.includeGlobs[0] || script.excludeGlobs[0]) &&
        (options.matches = ['*://*/*', 'file:///*']);
    options.matches = [...new Set(options.matches)];        // remove duplicates

    // --- remove empty arrays (causes error)
    ['excludeMatches', 'includeGlobs', 'excludeGlobs'].forEach(item => !options[item][0] && delete options[item]);

    // --- add CSS & JS
    const {name, require, requireRemote, userVar = {}} = script;
    const target = script.js ? 'js' : 'css';
    const js = target === 'js';
    const page = js && script.injectInto === 'page';
    const pageURL = page ? '%20(page-context)' : '';
    const encodeId = encodeURI(name);
    const sourceURL = `\n\n//# sourceURL=user-script:FireMonkey/${encodeId}${pageURL}/`;
    options[target] = [];

    // --- contextual identity container
    script.container?.[0] && this.containerSupport[target] &&
        (options.cookieStoreId = script.container.map(item => `firefox-${item}`));

    // ----- CSS only
    let userVarCode = '';                                   // for script.style
    if (!js) {
      // --- add @require
      require.forEach(item =>
        pref[`_${item}`]?.css && options.css.push({code: Meta.prepare(pref[`_${item}`].css)})
      );

      // --- add @requireRemote
      requireRemote[0] && options.css.push({code:
        `/* --- ${name}.user.css --- */\n\n` + requireRemote.map(item => `@import '${item}';`).join('\n')});

      // --- add @var
      const uv = Object.entries(userVar).map(([key, value]) => {
        let val = value.user;
        ['number', 'range'].includes(value.type) && value.value[4] && (val + value.value[4]);
        value.type === 'select' && Array.isArray(value.value) && (val = val.replace(/\*$/, ''));
        return  `  --${key}: ${val};`;
      }).join('\n');
      if (uv) {
        const code = `/* --- ${name}.user.css --- */\n/* --- User Variables --- */\n\n:root {\n${uv}\n}`;
        script.style[0] ? userVarCode = code : options.css.push({code});
      }

      // --- add code
      !script.style[0] && options.css.push({code: Meta.prepare(script.css)});
    }

    // ----- script only
    else if (js) {
      const {includes, excludes, grant = []} = script;

      // --- Regex include/exclude workaround
      (includes[0] || excludes[0]) && options.js.push({code: `if (!matchURL()) { throw ''; }`});

      // --- unsafeWindow implementation
      // Mapping to window object as a temporary workaround for
      // https://bugzilla.mozilla.org/show_bug.cgi?id=1715249
      !page && options.js.push({file: '/content/api-plus.js'});

      // --- add @require
      require.forEach(item => {
        const id = `_${item}`;
        if (item.startsWith('lib/')) {
          requireRemote.push('/' + item);
        }
        else if (pref[id]?.js) {                            // same type only
          let code = Meta.prepare(pref[id].js);
          code += sourceURL + encodeURI(item) + '.user.js';
          page && (code = `GM.addScript(${JSON.stringify(code)})`);
          options.js.push({code});
        }
        else if (pref[id]?.css) {                           // useCSS in userScript
          let code = Meta.prepare(pref[id].css);
          code = `GM.addStyle(${JSON.stringify(code)})`;
          options.js.push({code});
        }
      });

      // --- add @requireRemote
      if (requireRemote[0]) {
        // css @require injects via api
        const res = [];                                     // keep order of @require
        await Promise.all(requireRemote.map((url, index) => !/^(http|\/\/).+(\.css\b|\/css\d*\?)/i.test(url) &&
          fetch(url)
          .then(response => response.text())
          .then(code => {
            url.startsWith('/lib/') && (url = url.slice(1, -1));
            code += sourceURL + encodeURI(url);
            page && (code = `GM.addScript(${JSON.stringify(code)})`);
            res[index] = {code};
          })
          .catch(() => {})
        ));
        res.forEach(item => options.js.push(item));
      }

      // --- add @var
      const uv = Object.entries(userVar).map(([key, value]) => {
        let val = value.user;
        ['number', 'range'].includes(value.type) && value.value[4] && (val + value.value[4]);
        value.type === 'select' && Array.isArray(value.value) && (val = val.replace(/\*$/, ''));
        val = typeof val === 'string' ? JSON.stringify(val) : val;
        return `const ${key} = ${val};`;
      }).join('\n');
      if (uv) {
        let code = '/* --- User Variables --- */\n\n' + uv + sourceURL + encodeId + '.var.user.js';
        page && (code = `GM.addScript(${JSON.stringify(code)})`);
        options.js.push({code});
      }

      // --- process grant
      const grantKeep = [];
      const grantRemove = [];
      // case-altered GM API
      grant.includes('GM.xmlHttpRequest') && grant.push('GM.xmlhttpRequest');
      grant.includes('GM.getResourceUrl') && grant.push('GM.getResourceURL');
      grant.forEach(item =>
        item.startsWith('GM_') && grant.includes(`GM.${item.substring(3)}`) ? grantRemove.push(item) :
        !['GM.xmlhttpRequest', 'GM.getResourceURL'].includes(item) && grantKeep.push(item) );

      const registerMenuCommand = ['GM_registerMenuCommand', 'GM.registerMenuCommand'].some(item => grant.includes(item));

      options.scriptMetadata = {
        name,
        resource: script.resource,
        storage: script.storage,
        injectInto: script.injectInto,
//        grant: grantKeep,
        grantRemove,
        registerMenuCommand,
        requireRemote: script.requireRemote,
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

      // --- add sourceURL
      script.js += sourceURL + encodeId + '.user.js';

      // --- process inject-into page context
      if (page) {
        const str =
`((unsafeWindow, GM, GM_info = GM.info) => {(() => { ${script.js}
})();})(window, ${JSON.stringify({info:options.scriptMetadata.info})});`;

        script.js = `GM.addScript(${JSON.stringify(str)});`;
      }
      else if (['GM_getValue', 'GM_setValue', 'GM_listValues', 'GM_deleteValue'].some(item => grantKeep.includes(item))) {
        //script.js = `(async() => {await setStorage(); ${script.js}\n})();`;
        script.js = `setStorage().then(() => { ${script.js}\n});`;
      }

      // --- add code
      options.js.push({code: Meta.prepare(script.js)});
    }

    // ---
    if (script.style[0]) {
      // --- UserStyle Multi-segment Process
      script.style.forEach((item, i) => {
        options.matches = item.matches;
        userVarCode && options.css.push({code: userVarCode});
        options.css.push({code: item.css});
        this.register(id + 'style' + i, options, id);
      });
    }
    else { this.register(id, options); }
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

// ----------------- Web/Direct Installer & Remote Update --
class Installer {

  constructor() {
    // class RemoteUpdate in app.js
    RemoteUpdate.callback = this.processResponse.bind(this);

    // --- Web/Direct Installer
    this.webInstall = this.webInstall.bind(this);
    this.directInstall = this.directInstall.bind(this);

    browser.webRequest.onBeforeRequest.addListener(this.webInstall, {
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
      browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) =>
           /\.user\.(js|css)$/i.test(tab.url) && this.directInstall(tabId, changeInfo, tab)) :
      browser.tabs.onUpdated.addListener(this.directInstall, {
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
    browser.idle.onStateChanged.addListener(state => this.onIdle(state));
  }

  // --------------- Web/Direct Installer ------------------
  webInstall(e) {
    if (!e.originUrl) { return; }

    let q;
    switch (true) {
      // --- GreasyFork & sleazyfork
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

  directInstall(tabId, changeInfo, tab) {
    if (changeInfo.status !== 'complete') { return; }
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
    .then((result = []) => result[0] && this.processResponse(...result[0], tab.url))
    .catch(error => {
      App.log('directInstall', `${tab.url} ➜ ${error.message}`, 'error');
      this.installConfirm(tab);
    });
  }

  async installConfirm(tab) {
    const text = await fetch(tab.url)
    .then(response => response.text())
    .catch(error => App.log('installConfirm', `${tab.url} ➜ ${error.message}`, 'error'));

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
      result[0] && this.processResponse(text, name, tab.url);
      browser.tabs.remove(id);
    })
    .catch(error => App.log('installConfirm', `${tab.url} ➜ ${error.message}`, 'error'));
  }

  async stylish(url) {
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
    .then(text =>  {
      if (text.includes('@-moz-document')) {
        this.processResponse(metaData + '\n\n' + text, name, updateURL);
        App.notify(`${name}\nInstalled version ${version}`);
      }
      else {
        App.notify(browser.i18n.getMessage('error'));       // <head><title>504 Gateway Time-out</title></head>
      }
    })
    .catch(error => App.log(item.name, `stylish ${updateURL} ➜ ${error.message}`, 'error'));
  }
  // --------------- /Web|Direct Installer -----------------

  // --------------- Remote Update -------------------------
  onIdle(state) {
    if (state !== 'idle') { return; }

    const now = Date.now();
    const days = pref.autoUpdateInterval *1;
    if (!days || now <= pref.autoUpdateLast + (days * 86400000)) { return; } // 86400 * 1000 = 24hr

    if (!this.cache[0]) {                                   // rebuild the cache if empty
      this.cache = App.getIds().filter(item => pref[item].autoUpdate && pref[item].updateURL && pref[item].version);
    }

    // --- do 10 updates at a time & check if script wasn't deleted
    this.cache.splice(0, 10).forEach(item => pref.hasOwnProperty(item) && RemoteUpdate.getUpdate(pref[item]));

    // --- set autoUpdateLast after updates are finished
    !this.cache[0] && browser.storage.local.set({autoUpdateLast: now}); // update saved pref
  }

  processResponse(text, name, updateURL) {                  // from class RemoteUpdate.callback in app.js

    const data = Meta.get(text);
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

      scriptReg.unregister(oldId);                          // unregister old id
      pref[id] = pref[oldId];                               // copy to new id
      delete pref[oldId];                                   // delete old id
      browser.storage.local.remove(oldId);                  // remove old data
    }

    // --- check version, if update existing, not for local files
    if (!updateURL.startsWith('file:///') && pref[id] &&
          !RemoteUpdate.higherVersion(data.version, pref[id].version)) { return; }

    // --- check for Web Install, set install URL
    if (!data.updateURL && !updateURL.startsWith('file:///')) {
      data.updateURL = updateURL;
      data.autoUpdate = true;
    }

    // ---  log message to display in Options -> Log
    App.log(data.name, pref[id] ? `Updated version ${pref[id].version} ➜ ${data.version}` : `Installed version ${data.version}`);

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
    if(!e.originUrl?.startsWith(this.FMUrl)) { return; }    // not from FireMonkey

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
      // --- internal use only (not GM API)
      case 'log':
        return App.log(name, e.message, e.type);

      case 'install':
        RemoteUpdate.getScript({updateURL: e.updateURL, name});
        return;

      // --- from script api
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
        // Promise with tabs.Tab OR reject with error message
        return browser.tabs.create({url: e.url, active: e.active, openerTabId: sender.tab.id})
          .catch(error => App.log(name, `${message.api} ➜ ${error.message}`, 'error'));

      case 'setClipboard':
        // TM|VM compatibility
        let type = e.type && (typeof e.type === 'string' ? e.type : e.type?.mimetype || e.type?.type);
        if (type === 'text') {
          type = 'text/plain';
        }
        else if (type === 'html') {
          type = 'text/html';
        }

        // text
        if (!type || type === 'text/plain') {
          return navigator.clipboard.writeText(e.data)      // Promise with ? OR reject with error message
            .catch(error => App.log(name, `${message.api} ➜ ${error.message}`, 'error'));
        }

        const blob = new Blob([e.data], {type});
        const data = [new ClipboardItem({[type]: blob})];
        return navigator.clipboard.write(data)              // Promise with ? OR reject with error message
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
        return this.fetch(e, storeId, name);

      case 'xmlHttpRequest':
        return this.xmlHttpRequest(e, storeId);
    }
  }

  async addCookie(url, headers, storeId) {
    // add contextual cookies, only in container/incognito
    // https://bugzilla.mozilla.org/show_bug.cgi?id=1670278
    // if privacy.firstparty.isolate = true
    // Error: First-Party Isolation is enabled, but the required 'firstPartyDomain' attribute was not set.
    const cookies = await browser.cookies.getAll({url, storeId});
    const str = cookies && cookies.map(item => `${item.name}=${item.value}`).join('; ');
    str && (headers['FM-Contextual-Cookie'] = str);
  }

  async fetch(e, storeId, name) {
    if (e.init.credentials !== 'omit' && storeId) {         // not anonymous AND in container/incognito
      e.init.credentials = 'omit';
      await this.addCookie(e.url, e.init.headers, storeId);
    }
    Object.keys(e.init.headers || {})[0] || delete e.init.headers; // clean up

    return fetch(e.url, e.init)
      .then(async response => {
        // --- build response object
        const res = {headers: {}};
        response.headers.forEach((value, name) => res.headers[name] = value);
        ['bodyUsed', 'ok', 'redirected', 'status', 'statusText', 'type', 'url'].forEach(item => res[item] = response[item]);

        if (e.init.method === 'HEAD') { return res; }       // end here

        try {
          switch (e.init.responseType) {
            case 'json': res['json'] = await response.json(); break;
            case 'blob': res['blob'] = await response.blob(); break;
            case 'arrayBuffer': res['arrayBuffer'] = await response.arrayBuffer(); break;
            case 'formData': res['formData'] = await response.formData(); break;
            default: res['text'] = await response.text();
          }
          return res;
        } catch (error) {
          App.log(name, `fetch ${e.url} ➜ ${error.message}`, 'error');
          return error.message;
        }
      })
      .catch(error => App.log(name, `fetch ${e.url} ➜ ${error.message}`, 'error'));
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
      // responseText is only available if responseType is '' or 'text'.
      responseText:     ['', 'text'].includes(xhr.responseType) ? xhr.responseText : null,
      responseType:     xhr.responseType,
      responseURL:      xhr.responseURL,
      // responseXML is only available if responseType is '' or 'document'.
      // cant pass XMLDocument ➜ Error: An unexpected apiScript error occurred
      responseXML:      ['', 'document'].includes(xhr.responseType) ? xhr.responseText : null,
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
    const m = 2.42;
    if (localStorage.getItem('migrate')*1 >= m) { return; }

    // --- 2.42 2022-02-02
    if (pref.hasOwnProperty('customCSS')) {
      pref.customOptionsCSS = pref.customCSS;
      delete pref.customCSS;
      await browser.storage.local.remove('customCSS');
    }

    // --- 2.35 2021-11-09
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

// ----------------- User Preference -----------------------
App.getPref().then(() => processPref.process());

// ----------------- /User Preference ----------------------
