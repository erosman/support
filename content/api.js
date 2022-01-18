browser.userScripts.onBeforeScript.addListener(script => {
  // --- globals
  const {name, resource, info, id = `_${name}`} = script.metadata; // set id as _name
  const cache = {};
  const valueChange = {};
  const scriptCommand = {};
  let storage = script.metadata.storage;                    // storage at the time of registration

  class API {

    constructor() {
      // ----- Script Storage
     browser.storage.local.get(id).then((result = {}) => storage = result[id].storage);

      // ----- Script Command registerMenuCommand
      browser.runtime.onMessage.addListener(message => {
        switch (true) {
          case message.hasOwnProperty('listCommand'):       // to popup.js
            const command = Object.keys(scriptCommand);
            command[0] && browser.runtime.sendMessage({name, command});
            break;

          case message.name === name && message.hasOwnProperty('command'): // from popup.js
            (scriptCommand[message.command])();
            break;
        }
      });
    }

    // ----- Script Storage
    storageChange(changes) {
      if (!changes[id]) { return; }                         // not this userscript
      const oldValue = changes[id].oldValue.storage;
      const newValue = changes[id].newValue.storage;
      // process addValueChangeListener (only for remote) (key, oldValue, newValue, remote)
      Object.keys(valueChange).forEach(item =>
         !api.equal(oldValue[item], newValue[item]) &&
          (valueChange[item])(item, oldValue[item], newValue[item], !api.equal(newValue[item], cache[item]))
      );
    }

    equal(a, b) {
      return JSON.stringify(a) === JSON.stringify(b);
    }

    // ----- synch APIs
    GM_getValue(key, defaultValue) {
      const response = cache.hasOwnProperty(key) ? cache[key] :
                          storage.hasOwnProperty(key) ? storage[key] : defaultValue;
      return api.prepare(response);
    }

    GM_listValues() {
      return script.export([...new Set([...Object.keys(storage), ...Object.keys(cache)])]);
    }

    // ----- prepare return value
    prepare(value) {
      return ['object', 'function'].includes(typeof value) && value !== null ? script.export(value) : value;
    }

    // ----- auxiliary regex include/exclude test function
    matchURL() {
      const {includes, excludes} = info.script;
      return (!includes[0] || api.arrayTest(includes)) && (!excludes[0] || !api.arrayTest(excludes));
    }

    arrayTest(arr, url = location.href) {
      return arr.some(item => new RegExp(item.slice(1, -1), 'i').test(url));
    }

    // ----- cloneInto wrapper for object methods
    cloneIntoFM(obj, target, options = {}) {
      return cloneInto(options.cloneFunctions ? obj.wrappedJSObject : obj, target, options);
    }

    // ----- log from background
    log(message, type) {
      browser.runtime.sendMessage({
        name,
        api: 'log',
        data: {message, type}
      });
    }

    checkURL(url) {
      try { url = new URL(url, location.href); }
      catch (error) {
        this.log(name, `checkURL ${url} ➜ ${error.message}`, 'error');
        return;
      }

      // --- check protocol
      if (!['http:', 'https:'].includes(url.protocol)) {
        this.log(name, `checkURL ${url} ➜ Unsupported Protocol ${url.protocol}`, 'error');
        return;
      }
      return url.href;
    }

    // --- prepare request headers
    async prepareInit(url, init) {
      // --- remove forbidden headers (Attempt to set a forbidden header was denied: Referer), allow specialHeader
      const specialHeader = ['cookie', 'host', 'origin', 'referer'];
      const forbiddenHeader = ['accept-charset', 'accept-encoding', 'access-control-request-headers',
        'access-control-request-method', 'connection', 'content-length', 'cookie2', 'date', 'dnt', 'expect',
        'keep-alive', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'via'];

      Object.keys(init.headers).forEach(item =>  {
        const LC = item.toLowerCase();
        if (LC.startsWith('proxy-') || LC.startsWith('sec-') || forbiddenHeader.includes(LC)) {
          delete init.headers[item];
        }
        else if (specialHeader.includes(LC)) {
          const name = LC.charAt(0).toUpperCase() + LC.substring(1); // fix case
          init.headers[item] && (init.headers[`FM-${name}`] = init.headers[item]); // set a new FM header
          delete init.headers[item];                        // delete original header
        }
      });

      delete init.anonymous;                                // clean up
    }

    // --------------- xmlHttpRequest callback ---------------
    /*
      Ref: robwu (Rob Wu)
      In order to make callback functions visible
      ONLY for GM.xmlHttpRequest(GM_xmlhttpRequest)
    */
    callUserScriptCallback(object, name, ...args) {
      try {
        const cb = object.wrappedJSObject[name];
        typeof cb === 'function' && cb(...args);
      } catch(error) { api.log(`callUserScriptCallback ➜ ${error.message}`, 'error'); }
    }
  }
  const api = new API();


  // --------------- GM4 Object based functions ------------
  const GM = {

    async getValue(key, defaultValue) {
      const response =  await browser.runtime.sendMessage({
        name,
        api: 'getValue',
        data: {key, defaultValue}
      });
      return api.prepare(response);
    },

    async listValues() {
      const response = await browser.runtime.sendMessage({
        name,
        api: 'listValues',
        data: {}
      });
      return script.export(response);
    },

    setValue(key, value) {
      cache[key] = value;
      return browser.runtime.sendMessage({
        name,
        api: 'setValue',
        data: {key, value}
      });
    },

    deleteValue(key) {
      delete cache[key];
      return browser.runtime.sendMessage({
        name,
        api: 'deleteValue',
        data: {key}
      });
    },

    addValueChangeListener(key, callback) {
      browser.storage.onChanged.hasListener(api.storageChange) || browser.storage.onChanged.addListener(api.storageChange)
      valueChange[key] = callback;
      return key;
    },

    removeValueChangeListener(key) {
      delete valueChange[key];
    },

    openInTab(url, open_in_background) {
      return browser.runtime.sendMessage({
        name,
        api: 'openInTab',
        data: {url, active: !open_in_background}
      });
    },

    setClipboard(text) {
      return browser.runtime.sendMessage({
        name,
        api: 'setClipboard',
        data: {text}
      });
    },

    notification(text, title, image, onclick) {
      // (text, title, image, onclick) | ({text, title, image, onclick})
      const txt = typeof text === 'string' ? text : text.text;
      if (typeof txt !== 'string' || !txt.trim()) { return; }
      return browser.runtime.sendMessage({
        name,
        api: 'notification',
        data: typeof text === 'string' ? {text, title, image, onclick} : text
      });
    },

    async fetch(url, init = {}) {
      // --- check url
      url = url && api.checkURL(url);
      if (!url) { return Promise.reject(); }

      const data = {
        url,
        init: {
          headers: {}
        }
      };

      ['method', 'headers', 'body', 'mode', 'credentials', 'cache', 'redirect', 'referrer', 'referrerPolicy', 'integrity',
          'keepalive', 'signal', 'responseType'].forEach(item => init.hasOwnProperty(item) && (data.init[item] = init[item]));

      // exclude credentials in request, ignore credentials sent back in response (e.g. Set-Cookie header)
      init.anonymous && (data.init.credentials = 'omit');

      await api.prepareInit(url, data.init);

      const response = await browser.runtime.sendMessage({
        name,
        api: 'fetch',
        data
      });
      // cloneInto() work around for https://bugzilla.mozilla.org/show_bug.cgi?id=1583159
      return response ? cloneInto(response, window) : null;
    },

    async xmlHttpRequest(init = {}) {
      // --- check url
      const url = init.url && api.checkURL(init.url);
      if (!url) { return Promise.reject(); }

      const data = {
        method: 'GET',
        url,
        data: null,
        user: null,
        password: null,
        responseType: '',
        headers: {},
        mozAnon: !!init.anonymous
      };

      // not processing withCredentials as it has no effect from bg script
      ['method', 'headers', 'data', 'overrideMimeType', 'user', 'password', 'timeout',
        'responseType'].forEach(item => init.hasOwnProperty(item) && (data[item] = init[item]));

      await api.prepareInit(url, data);

      const response = await browser.runtime.sendMessage({
        name,
        api: 'xmlHttpRequest',
        data
      });
      if (!response) { throw 'There was an error with the xmlHttpRequest request.'; }

      // only these 4 callback functions are processed
      // cloneInto() work around for https://bugzilla.mozilla.org/show_bug.cgi?id=1583159
      const type = response.type;
      delete response.type;
      api.callUserScriptCallback(init, type,
         typeof response.response === 'string' ? script.export(response) : cloneInto(response, window));
    },

    async getResourceText(resourceName) {
      const response = await browser.runtime.sendMessage({
        name,
        api: 'fetch',
        data: {url: resource[resourceName], init: {}}
      });
      return response ? script.export(response.text) : null;
    },

    getResourceUrl(resourceName) {                          // GreaseMonkey | TamperMonkey
      return resource[resourceName];
    },

    getResourceURL(resourceName) {                          // ViolentMonkey
      return resource[resourceName];
    },

    registerMenuCommand(text, onclick, accessKey) {
      scriptCommand[text] = onclick;
    },

    unregisterMenuCommand(text) {
      delete scriptCommand[text];
    },

    download(url, filename) {
      // --- check url
      url = api.checkURL(url);
      if (!url) { return Promise.reject(); }

      return browser.runtime.sendMessage({
        name,
        api: 'download',
        data: {url, filename}
      });
    },

    addStyle(css) {
      if (!css) { return; }
      try {
        const node = document.createElement('style');
        node.textContent = css;
        node.dataset.src = name + '.user.js';
        (document.head || document.body || document.documentElement || document).appendChild(node);
      } catch(error) { api.log(`addStyle ➜ ${error.message}`, 'error'); }
    },

    addScript(js) {
      if (!js) { return; }
      try {
        const node = document.createElement('script');
        node.textContent = js;
        if (script.metadata.injectInto !== 'page') {
          node.textContent +=
            `\n\n//# sourceURL=user-script:FireMonkey/${encodeURI(name)}/GM.addScript_${Math.random().toString(36).substring(2)}.js`;
        }
        (document.body || document.head || document.documentElement || document).appendChild(node);
        node.remove();
      } catch(error) { api.log(`addScript ➜ ${error.message}`, 'error'); }
    },

    popup({type = 'center', modal = true} = {}) {
      const host = document.createElement('gm-popup');    // shadow DOM host
      const shadow = host.attachShadow({mode: 'closed'});

      const style = document.createElement('style');
      shadow.appendChild(style);

      const content = document.createElement('div');      // main content
      content.className = 'content';
      shadow.appendChild(content);

      const close = document.createElement('span');       // close button
      close.className = 'close';
      close.textContent = '✖';
      content.appendChild(close);

      [host, content].forEach(item => item.classList.add(type)); // process options
      host.classList.toggle('modal', type.startsWith('panel-') ? modal : true); // process modal

      style.textContent = `
        :host, *, ::before, ::after {
          box-sizing: border-box;
        }

        :host {
          display: none;
          align-items: center;
          justify-content: center;
          background: transparent;
          margin: 0;
          position: fixed;
          z-index: 10000;
          transition: all 0.5s ease-in-out;
        }

        :host(.on) { display: flex; }
        .content { background: #fff; }
        .content.center, .content[class*="slide-"] {
          min-width: 10em;
          min-height: 10em;
        }

        .close {
          color: #ccc;
          margin: 0.1em 0.3em;
          float: right;
          font-size: 1.5em;
          border: 0px solid #ddd;
          border-radius: 2em;
          cursor: pointer;
        }
        .close:hover { color: #f70; }
        .panel-right .close { float: left; }
        .panel-top .close, .panel-bottom .close { margin-right: 0.5em; }

        :host(.panel-left), :host(.panel-right), .panel-left, .panel-right { min-width: 14em;  height: 100%; }
        :host(.panel-top), :host(.panel-bottom), .panel-top, .panel-bottom { width: 100%; min-height: 4em; }

        :host(.panel-left)        { top: 0; left: 0; justify-content: start; }
        :host(.panel-right)       { top: 0; right: 0; justify-content: end; }
        :host(.panel-top)         { top: 0; left: 0; align-items: start; }
        :host(.panel-bottom)      { bottom: 0; left: 0; align-items: end; }

        :host(.on) .center        { animation: center 0.5s ease-in-out; }
        :host(.on) .slide-top     { animation: slide-top 0.5s ease-in-out; }
        :host(.on) .slide-bottom  { animation: slide-bottom 0.5s ease-in-out; }
        :host(.on) .slide-left    { animation: slide-left 0.5s ease-in-out; }
        :host(.on) .slide-right   { animation: slide-right 0.5s ease-in-out; }

        :host(.on) .panel-top     { animation: panel-top 0.5s ease-in-out; }
        :host(.on) .panel-bottom  { animation: panel-bottom 0.5s ease-in-out; }
        :host(.on) .panel-left    { animation: panel-left 0.5s ease-in-out; }
        :host(.on) .panel-right   { animation: panel-right 0.5s ease-in-out; }

        :host(.modal) { width: 100%; height: 100%; top: 0; left: 0; background: rgba(0, 0, 0, 0.4); }

        @keyframes center {
            0%  { transform: scale(0.8); }
          100%  { transform: scale(1); }
        }

        @keyframes slide-top {
            0%  { transform: translateY(-200%) scale(0.8); }
          100%  { transform: translateY(0) scale(1); }
        }

        @keyframes slide-bottom {
            0%  { transform: translateY(200%) scale(0.8); }
          100%  { transform: translateY(0) scale(1); }
        }

        @keyframes slide-left {
            0%  { transform: translateX(-200%) scale(0.8); }
          100%  { transform: translateX(0) scale(1); }
        }

        @keyframes slide-right {
            0%  { transform: translateX(200%) scale(0.8); }
          100%  { transform: translateX(0) scale(1); }
        }

        @keyframes panel-top {
            0%  { transform: translateY(-100%); }
          100%  { transform: translateY(0); }
        }

        @keyframes panel-bottom {
            0%  { transform: translateY(100%); }
          100%  { transform: translateY(0); }
        }

        @keyframes panel-left {
            0%  { transform: translateX(-100%); }
          100%  { transform: translateX(0); }
        }

        @keyframes panel-right {
            0%  { transform: translateX(100%); }
          100%  { transform: translateX(0); }
        }
      `;

      document.body.appendChild(host);

      const obj = {
        host,
        style,
        content,
        close,

        addStyle(css) {
          style.textContent += '\n\n' + css;
        },

        append(...arg) {
          typeof arg[0] === 'string' && /^<.+>$/.test(arg[0].trim()) ?
            content.append(document.createRange().createContextualFragment(arg[0].trim())) :
              content.append(...arg);
        },

        show() {
          host.style.opacity = 1;
          host.classList.toggle('on', true);
        },

        hide(e) {
          if (!e || [host, close].includes(e.originalTarget)) {
            host.style.opacity = 0;
            setTimeout(() => host.classList.toggle('on', false), 500);
          }
        },

        remove() {
          host.remove();
        }
      };

      host.addEventListener('click', obj.hide);

      return script.export(obj);
    },

    log(...text) { console.log(`${name}:`, ...text); },
    info
  };

  const globals = {
    GM,
    GM_getValue:                  api.GM_getValue,
    GM_listValues:                api.GM_listValues,
    GM_deleteValue:               GM.deleteValue,
    GM_setValue:                  GM.setValue,
    GM_addValueChangeListener:    GM.addValueChangeListener,
    GM_removeValueChangeListener: GM.removeValueChangeListener,

    GM_openInTab:                 GM.openInTab,
    GM_setClipboard:              GM.setClipboard,
    GM_notification:              GM.notification,
    GM_xmlhttpRequest:            GM.xmlHttpRequest,
    GM_fetch:                     GM.fetch,
    GM_download:                  GM.download,
    GM_getResourceText:           GM.getResourceText,
    GM_getResourceUrl:            GM.getResourceUrl,        // GreaseMonkey | TamperMonkey
    GM_getResourceURL:            GM.getResourceURL,        // ViolentMonkey
    GM_registerMenuCommand:       GM.registerMenuCommand,
    GM_unregisterMenuCommand:     GM.unregisterMenuCommand,

    GM_addStyle:                  GM.addStyle,
    GM_addScript:                 GM.addScript,
    GM_popup:                     GM.popup,

    GM_log:                       GM.log,
    GM_info:                      GM.info,

    exportFunction,
    cloneInto:                    api.cloneIntoFM,
    matchURL:                     api.matchURL
  };

  script.metadata.disableSyncGM && Object.keys(globals).forEach(item => item.startsWith('GM_') && delete globals[item]);

  script.defineGlobals(globals);
});
