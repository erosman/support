import {App} from './app.js';
import {Meta} from './meta.js';

// ---------- Register Content Script|CSS ------------------
export class Script {

  static #FMUrl = browser.runtime.getURL('');               // used for sourceURL
  static #FMV = browser.runtime.getManifest().version;      // FireMonkey version
  static registered = {};                                   // not needed in MV3 scripting.registerContentScripts()

  static async init() {
    this.platformInfo = await browser.runtime.getPlatformInfo();
    this.browserInfo = await browser.runtime.getBrowserInfo();
    const FFV = parseInt(this.browserInfo.version);         // Firefox versions number
    this.containerSupport = {
      css: FFV >= 97,                                       // firefox97 (2022-02-08) https://bugzilla.mozilla.org/show_bug.cgi?id=1470651
      js: FFV >= 98                                         // firefox98 (2022-03-08) https://bugzilla.mozilla.org/show_bug.cgi?id=1738567
    };
  }

  static update(pref, ids = App.getIds(pref)) {
    ids.forEach(id => this.process(pref, id));
  }

  static remove(script) {
    // --- unregister previously registered script & UserStyle Multi-segment CSS
    const id = `_${script.name}`;
    script.style?.[0] ? script.style.forEach((item, i) => this.#unregister(id + 'style' + i)) : this.#unregister(id);
  }

  static async process(pref, id) {                          // need complete pref for pref.globalScriptExcludeMatches && @require
    const script = {...pref[id]};                           // shallow clone

    // --- reset previously registered UserStyle Multi-segment CSS
    // script.style?.[0] ? script.style.forEach((item, i) => this.#unregister(id + 'style' + i)) : this.#unregister(id);
    this.remove(script);

    // --- stop if script is not enabled or no mandatory matches
    if (!script.enabled || (!script.matches[0] && !script.includes[0] && !script.includeGlobs[0] && !script.style?.[0])) { return; }

    script.js ? this.#prepareUserScript(pref, id) : this.#prepareUserCSS(pref, id);
  }

  // cloneScript(script) {
  //   return JSON.parse(JSON.stringify(script));              // deep clone to prevent changes to the original
  // }

  static #getOptions(script, globalScriptExcludeMatches) {
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

    // --- add CSS & JS
    const type = script.js ? 'js' : 'css';
    options[type] = [];

    // --- prepare for include/exclude
    !script.matches[0] && (script.includes[0] || script.excludes[0] || script.includeGlobs[0] || script.excludeGlobs[0]) &&
    (options.matches = ['*://*/*', 'file:///*']);
    options.matches = [...new Set(options.matches)];        // remove duplicates

    // --- contextual identity container
    script.container?.[0] && this.containerSupport[type] &&
        (options.cookieStoreId = script.container.map(i => `firefox-${i}`));

    // --- add Global Script Exclude Matches
    globalScriptExcludeMatches && options.excludeMatches.push(...globalScriptExcludeMatches.split(/\s+/));

    // --- remove empty arrays (causes error)
    ['excludeMatches', 'includeGlobs', 'excludeGlobs'].forEach(item => !options[item][0] && delete options[item]);

    return options;
  }

  static #getVar(userVar, js) {
    // --- add @var
    const uv = Object.entries(userVar).map(([key, value]) => {
      let val = value.user;
      ['number', 'range'].includes(value.type) && value.value[4] && (val + value.value[4]);
      value.type === 'select' && Array.isArray(value.value) && (val = val.replace(/\*$/, ''));
      js && typeof val === 'string' && (val = JSON.stringify(val));
      return `const ${key} = ${val};`;
    }).join('\n');
    return uv;
  }

  static async #prepareUserScript(pref, id) {
    const script = pref[id];
    const options = this.#getOptions(script, pref.globalScriptExcludeMatches);
    const {name, require, requireRemote, userVar = {}, includes, excludes, grant = []} = script;
    const page = script.injectInto === 'page';
    const pageURL = page ? 'inject-into-page/' : '';
    const encodeName = encodeURI(name);

    // re UUID when inject-into page
    // https://bugzilla.mozilla.org/show_bug.cgi?id=1717671
    // Display inconsistency of sourceURL folder & file
    // https://bugzilla.mozilla.org/show_bug.cgi?id=1824910
    // const sourceURL = `\n\n//# sourceURL=user-script:FireMonkey/${pageURL}${encodeName}/`; // before v2.68
    const sourceURL = `\n\n//# sourceURL=${this.#FMUrl}userscript/${pageURL}${encodeName}`;

    // --- Regex include/exclude workaround
    (includes[0] || excludes[0]) && options.js.push({code: `if (!matchURL()) { throw ''; }`});

    // --- unsafeWindow implementation
    // Mapping to window object as a temporary workaround for
    // https://bugzilla.mozilla.org/show_bug.cgi?id=1715249
    !page && options.js.push({file: '/content/api-plus.js'});

    // --- process grant
    const [grantKeep, grantRemove] = App.sortGrant(grant);  // FM 2.42
    const registerMenuCommand = ['GM_registerMenuCommand', 'GM.registerMenuCommand'].some(i => grant.includes(i)); // FM 2.45

    // --- add @require
    require.forEach(item => {
      const id = `_${item}`;

      if (pref[id]?.js) {                                   // require another userScript
        let code = Meta.prepare(pref[id].js);
        code += `${sourceURL}/@require/${encodeURI(item)}.user.js`;
        page && (code = `GM.addScript(${JSON.stringify(code)})`);
        options.js.push({code});
      }
      else if (pref[id]?.css) {                             // require another userCSS
        let code = Meta.prepare(pref[id].css);
        code = `GM.addStyle(${JSON.stringify(code)})`;
        options.js.push({code});
      }
    });

    // --- sort into JS & CSS, CSS @require injects via api
    const remoteJS = [];
    const remoteCSS = [];
    const cssRegex = /^(https?:)?\/\/.+(\.css\b|\/css\d*\?)/i;
    requireRemote.forEach(i => cssRegex.test(i) ? remoteCSS.push(i) : remoteJS.push(i));

    // --- add @requireRemote
    if (remoteJS[0]) {
      const res = [];                                       // keep the order of @require
      // Array.forEach: Uncaught (in promise) TypeError: can't convert undefined to object
      // using Array.map to return a Promise
      await Promise.all(remoteJS.map((url, index) =>
        fetch(url)
        .then(response => response.text())
        .then(code => {
          code += `${sourceURL}/@require/${encodeURI(url)}`;
          page && (code = `GM.addScript(${JSON.stringify(code)})`);
          res[index] = {code};
        })
        .catch(() => {})
      ));
      res.forEach(item => options.js.push(item));
    }

    // --- add @resource for GM getResourceText
    const getResourceText = ['GM_getResourceText', 'GM.getResourceText'].some(i => grant.includes(i)); // FM 2.68
    const resourceData = {};
    if(getResourceText) {
       // not for image
      const array = Object.entries(script.resource).filter(([key, url]) => !/\.(jpe?g|png|gif|webp|svg|ico)\b/i.test(url));
      // using Array.map to return a Promise
      await Promise.all(array.map(([key, url]) =>
        fetch(url)
        .then(response => response.text())
        .then(text =>  resourceData[key] = text)
        .catch(() => {})
      ));
    }

    // --- add @var
    const uv = this.#getVar(userVar, true);
    if (uv) {
      let code = '/* --- User Variables --- */\n\n' + uv;
      code += `${sourceURL}/${encodeName}.var.user.js`;
      page && (code = `GM.addScript(${JSON.stringify(code)})`);
      options.js.push({code});
    }

    const runAt = script.runAt.replace('_', '-');
    const metadata = script.js.match(Meta.regEx)[2].replace(/[/\s]+$/, '');

    // --- scriptMetadata
    options.scriptMetadata = {
      grantRemove,
      registerMenuCommand,
      remoteCSS,                                            // css @require to inject by api.js
      resourceData,                                         // resource text data for getResourceText
      storage: script.storage,                              // script storage at the time of registration
      // name,                                                 // also in info.script.name
      // resource: script.resource,                            // resource object {name, url}, also in info.script.resources
      // injectInto: script.injectInto,                        // also in info.script.injectInto
      // grant: grantKeep,                                     // also in info.script.grant

      // GM info data
      info: {
        // application data
        scriptHandler: 'FireMonkey',
        version: this.#FMV,
        platform: this.platformInfo,                        // FM|VM, VM: includes browserName, browserVersion
        browser: this.browserInfo,                          // FM only

        // script data
        scriptMetaStr: metadata,                            // FM|GM|VM without start/end strings, TM with
        script: {
          name,
          version: script.version,                          // FM|TM|VM: string, GM: string|null
          description: script.description,
          includes,
          excludes,
          matches: script.matches,
          excludeMatches: script.excludeMatches,            // FM|VM
          includeGlobs: script.includeGlobs,                // FM only
          excludeGlobs: script.excludeGlobs,                // FM only
          grant: grantKeep,                                 // FM|TM|VM
          require: script.require,                          // FM|VM
          resources: script.resource,                       // GM: { {...} }, TM: {...}, VM: [ {...} ]
          'run-at': runAt,                                  // FM|TM
          runAt,                                            // VM: runAt, GM: runAt: "end"
          injectInto: script.injectInto,                    // FM|VM, VM: info.injectInto
          namespace: '',                                    // FM|TM|VM: string, GM: string|null
          metadata,
        }
      }
    };

    // --- add sourceURL
    let js = script.js + `${sourceURL}/${encodeName}.user.js`;

    // --- process inject-into page context
    if (page) {
      const str =
`((unsafeWindow, GM, GM_info = GM.info) => {(() => { ${js}
})();})(window, ${JSON.stringify({info:options.scriptMetadata.info})});`;

      js = `GM.addScript(${JSON.stringify(str)});`;
    }
    else if (['GM_getValue', 'GM_setValue', 'GM_deleteValue', 'GM_listValues',
              'GM_getValues', 'GM_setValues', 'GM_deleteValues'].some(item => grantKeep.includes(item))) {
      js = `setStorage().then(() => { ${js}\n});`;
    }

    // --- add code
    options.js.push({code: Meta.prepare(js)});

    // --- register
    this.#register(pref, id, options);
  }

  static #prepareUserCSS(pref, id) {
    const script = pref[id];
    const options = this.#getOptions(script);
    const {name, require, requireRemote, userVar = {}, style = []} = script;

    // --- add @require
    require.forEach(item =>
      pref[`_${item}`]?.css && options.css.push({code: Meta.prepare(pref[`_${item}`].css)})
    );

    // --- add @requireRemote
    requireRemote[0] && options.css.push({code:
      `/* --- ${name}.user.css --- */\n\n` + requireRemote.map(i => `@import '${i}';`).join('\n')});

    // --- add @var
    let userVarCode = '';                                   // for script.style
    const uv = this.#getVar(userVar);
    if (uv) {
      const code = `/* --- ${name}.user.css --- */\n/* --- User Variables --- */\n\n:root {\n${uv}\n}`;
      style[0] ? userVarCode = code : options.css.push({code});
    }

    // --- add code
    !style[0] && options.css.push({code: Meta.prepare(script.css)});

    // --- register
    if (style[0]) {
      // --- UserStyle Multi-segment CSS
      style.forEach((item, i) => {
        options.matches = item.matches;
        userVarCode && options.css.push({code: userVarCode});
        options.css.push({code: item.css});
        this.#register(pref, id + 'style' + i, options, id);
      });
    }
    else {
      this.#register(pref, id, options);
    }
  }

  static #register(pref, id, options, originId) {
    const API = options.js ? browser.userScripts : browser.contentScripts;
    // --- register script
    try {                                                   // catches error throws before the Promise
      API.register(options)
      .then(reg => this.registered[id] = reg)               // contentScripts.RegisteredContentScript object
      .catch(error => App.log((originId || id).substring(1), `Register ➜ ${error.message}`, 'error'));
    }
    catch(error) {
      this.#processError(pref, originId || id, error.message);
    }
  }

  static async #unregister(id) {
    if (!this.registered[id]) { return; }
    await this.registered[id].unregister();
    delete this.registered[id];
  }

  static #processError(pref, id, error) {
    pref[id].error = error;                                 // store error message
    browser.storage.local.set({[id]: pref[id]});            // update saved pref
    App.log(id.substring(1), `Register ➜ ${error}`, 'error'); // log message to display in Options -> Log
  }
}