browser.userScripts.onBeforeScript.addListener(script => {
  // --- globals
  const {grantRemove, registerMenuCommand, remoteCSS, resourceData, info} = script.metadata;
  const {name, id = `_${name}`, injectInto, resource} = info.script; // set id as _name
  let {storage} = script.metadata;                          // storage at the time of registration
  const valueChange = {};
  const scriptCommand = {};
  const FMUrl = browser.runtime.getURL('');                 // used for sourceURL & import

  // --- check @require CSS
  remoteCSS.forEach(item => GM.addElement('link', {href: item, rel: 'stylesheet'}));

  const popupCSS =
`:host, *, ::before, ::after {
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

:host(.on) {
  display: grid;
}

.content {
  background: #f9f9fb;
  padding: 0.5em;
}

.content.center,
.content[class*="slide-"] {
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

:host(.panel-left), :host(.panel-right), .panel-left, .panel-right { min-width: 14em; height: 100%; }
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

:host(.modal) {
  width: 100%;
  height: 100%;
  top: 0;
  left: 0;
  background: rgba(0, 0, 0, 0.4);
}

@keyframes center {
    0% { transform: scale(0.8); }
  100% { transform: scale(1); }
}

@keyframes slide-top {
    0% { transform: translateY(-200%) scale(0.8); }
  100% { transform: translateY(0) scale(1); }
}

@keyframes slide-bottom {
    0% { transform: translateY(200%) scale(0.8); }
  100% { transform: translateY(0) scale(1); }
}

@keyframes slide-left {
    0% { transform: translateX(-200%) scale(0.8); }
  100% { transform: translateX(0) scale(1); }
}

@keyframes slide-right {
    0% { transform: translateX(200%) scale(0.8); }
  100% { transform: translateX(0) scale(1); }
}

@keyframes panel-top {
    0% { transform: translateY(-100%); }
  100% { transform: translateY(0); }
}

@keyframes panel-bottom {
    0% { transform: translateY(100%); }
  100% { transform: translateY(0); }
}

@keyframes panel-left {
    0% { transform: translateX(-100%); }
  100% { transform: translateX(0); }
}

@keyframes panel-right {
    0% { transform: translateX(100%); }
  100% { transform: translateX(0); }
}`;

  class API {

    static {
      // Script Command registerMenuCommand
      registerMenuCommand && browser.runtime.onMessage.addListener(message => {
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

    // --- Script Storage: direct operation
    static async getData() {
      return (await browser.storage.local.get(id))[id];
    }

    static async setStorage() {
      const data = await API.getData();
      storage = data.storage;
    }

    static onChanged(changes) {
      if (!changes[id]) { return; }                         // not this userscript
      const oldValue = changes[id].oldValue.storage;
      const newValue = changes[id].newValue.storage;
      // process addValueChangeListener (only for remote) (key, oldValue, newValue, remote)
      Object.keys(valueChange).forEach(item =>
         !API.equal(oldValue[item], newValue[item]) &&
          (valueChange[item])(item, oldValue[item], newValue[item], !API.equal(newValue[item], storage[item]))
      );
    }

    static equal(a, b) {
      return JSON.stringify(a) === JSON.stringify(b);
    }

    // --- synch APIs
    static GM_getValue(key, defaultValue) {
      const value = storage.hasOwnProperty(key) ? storage[key] : defaultValue;
      return API.prepare(value);                            // object or string
    }

    static GM_listValues() {
      return script.export(Object.keys(storage));
    }

    static GM_getValues(array) {
      const obj = {};
      array.forEach(key => obj[key] = storage[key]);
      return script.export(obj);
    }

    static GM_getResourceText(resourceName) {
      return resourceData[resourceName] || '';
    }

    // --- sync return GM_getResourceURL
    static getResourceUrl(resourceName) {
      return resource[resourceName];
    }

    // --- prepare return value, check if it is primitive value
    static prepare(value) {
      return ['object', 'function'].includes(typeof value) && value !== null ? script.export(value) : value;
    }

    // --- auxiliary regex include/exclude test function
    static matchURL() {
      const {includes, excludes} = info.script;
      return (!includes[0] || API.arrayTest(includes)) && (!excludes[0] || !API.arrayTest(excludes));
    }

    static arrayTest(arr, url = location.href) {
      return arr.some(item => new RegExp(item.slice(1, -1), 'i').test(url));
    }

    // --- cloneInto wrapper for object methods
    static cloneIntoBridge(obj, target, options = {}) {
      return cloneInto(options.cloneFunctions ? obj.wrappedJSObject : obj, target, options);
    }

    // --- log from background
    static log(message, type = 'error') {
      browser.runtime.sendMessage({
        name,
        api: 'log',
        data: {message, type}
      });
    }

    static checkURL(url) {
      try { url = new URL(url, location.href); }
      catch (error) {
        API.log(`checkURL ${url} ➜ ${error.message}`);
        return;
      }

      // check protocol
      if (!['http:', 'https:'].includes(url.protocol)) {
        API.log(`checkURL ${url} ➜ Unsupported Protocol ${url.protocol}`);
        return;
      }
      return url.href;
    }

    // --- prepare request headers
    static prepareInit(init) {
      // --- remove forbidden headers (Attempt to set a forbidden header was denied: Referer), allow specialHeader
      const specialHeader = ['cookie', 'host', 'origin', 'referer'];
      const forbiddenHeader = ['accept-charset', 'accept-encoding', 'access-control-request-headers',
        'access-control-request-method', 'connection', 'content-length', 'cookie2', 'date', 'dnt', 'expect',
        'keep-alive', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'via'];

      Object.keys(init.headers).forEach(item => {
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

    // ---------- import -----------------------------------
    // Support loading content scripts as ES6 modules
    // https://bugzilla.mozilla.org/show_bug.cgi?id=1451545
    // GM.import() -> importBridge()
    // internal modules && images
    // get response.blob() with original type
    static async importBridge(url) {
      // --- internal module
      const mod = {
        PSL: `${FMUrl}content/psl.js`
      };
      if (mod[url]) {
        return fetch(mod[url])
        .then(response => response.blob())
        .then(blob => URL.createObjectURL(blob));
      }

      // --- remote import
      url = API.checkURL(url);
      if (!url) { return; }

      return GM.fetch(url, {responseType: 'blob'})
      .then(response => response?.blob && URL.createObjectURL(response.blob));
    }
    // ---------- /import ----------------------------------

    // ---------- xmlHttpRequest callback ------------------
    /*
      Ref: Rob Wu (robwu)
      In order to make callback functions visible
      ONLY for GM.xmlHttpRequest(GM_xmlhttpRequest)
    */
    static callUserScriptCallback(object, name, ...args) {
      try {
        const cb = object.wrappedJSObject[name];
        typeof cb === 'function' && cb(...args);
      }
      catch(error) {
        API.log(`callUserScriptCallback ➜ ${error.message}`);
      }
    }
  }

  // ---------- GM4 Object based functions -----------------
  const GM = {

    // ---------- background functions ---------------------
    download(url, filename) {
      // --- check url
      url = API.checkURL(url);
      if (!url) { return Promise.reject(); }

      return browser.runtime.sendMessage({
        name,
        api: 'download',
        data: {url, filename}
      });
    },

    notification(text, title, image, onclick) {
      // GM|TM|VM: (text, title, image, onclick)
      // TM|VM: {text, title, image, onclick}
      const txt = text?.text || text;
      if (typeof txt !== 'string' || !txt.trim()) { return; }
      return browser.runtime.sendMessage({
        name,
        api: 'notification',
        data: typeof text === 'string' ? {text, title, image, onclick} : text
      });
    },

    // opt = open_in_background
    async openInTab(url, opt) {
      // GM opt: boolean
      // TM|VM opt: boolean OR object {active: true/false}
      const active = typeof opt === 'object' ? !!opt.active : !opt;
      // Error: Return value not accessible to the userScript
      // resolve -> tab object | reject -> undefined
      const tab = await browser.runtime.sendMessage({
        name,
        api: 'openInTab',
        data: {url, active}
      });
      return !!tab; // true/false
    },

    // As the API is only available to Secure Contexts, it cannot be used from
    // a content script running on http:-pages, only https:-pages.
    // See also: https://github.com/w3c/webextensions/issues/378
    setClipboard(data, type) {
      // VM type: string MIME type e.g. 'text/plain'
      // TM type: string e.g. 'text' or 'html'
      // TM type: object e.g. {type: 'text', mimetype: 'text/plain'}
      type = type?.mimetype || type?.type || type || 'text/plain'; // defaults to 'text/plain'

      // fix short type
      if (type === 'text') { type = 'text/plain'; }
      else if (type === 'html') { type = 'text/html'; }

      return browser.runtime.sendMessage({
        name,
        api: 'setClipboard',
        data: {data, type}
      });
    },

    async fetch(url, init = {}) {
      // check url
      url = url && API.checkURL(url);
      if (!url) { return; }

      const data = {
        url,
        init: {headers: {}}
      };

      ['method', 'headers', 'body', 'mode', 'credentials', 'cache', 'redirect',
        'referrer', 'referrerPolicy', 'integrity', 'keepalive', 'signal',
        'responseType'].forEach(item => init.hasOwnProperty(item) && (data.init[item] = init[item]));

      // exclude credentials in request, ignore credentials sent back in response (e.g. Set-Cookie header)
      init.anonymous && (data.init.credentials = 'omit');

      API.prepareInit(data.init);

      const response = await browser.runtime.sendMessage({
        name,
        api: 'fetch',
        data
      });

      // cloneInto() work around for https://bugzilla.mozilla.org/show_bug.cgi?id=1583159
      return response ? cloneInto(response, window) : undefined;
    },

    async xmlHttpRequest(init = {}) {
      // check url
      const url = init.url && API.checkURL(init.url);
      if (!url) { return; }

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

      API.prepareInit(data);

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
      // convert text responseXML to XML DocumentFragment
      response.responseXML &&
        (response.responseXML = document.createRange().createContextualFragment(response.responseXML.trim()));
      API.callUserScriptCallback(init, type,
         typeof response.response === 'string' ? script.export(response) : cloneInto(response, window));
    },
    // ---------- /background functions --------------------

    // ---------- storage ----------------------------------
    async getValue(key, defaultValue) {
      const data = await API.getData();
      const value = data.storage.hasOwnProperty(key) ? data.storage[key] : defaultValue;
      return API.prepare(value);                            // object or string
    },

    async setValue(key, value) {
      storage[key] = value;                                 // update sync storage
      const data = await API.getData();
      data.storage[key] = value;
      return browser.storage.local.set({[id]: data});
    },

    async deleteValue(key) {
      delete storage[key];                                  // update sync storage
      const data = await API.getData();
      delete data.storage[key];
      return browser.storage.local.set({[id]: data});
    },

    async listValues() {
      const data = await API.getData();
      const value = Object.keys(data.storage);
      return script.export(value);
    },

    addValueChangeListener(key, callback) {
      browser.storage.onChanged.addListener(API.onChanged);
      valueChange[key] = callback;
      return key;
    },

    removeValueChangeListener(key) {
      delete valueChange[key];
    },

    // --- multi-operation
    async getValues(array) {
      const data = await API.getData();
      const obj = {};
      array.forEach(key => obj[key] = data.storage[key]);
      return script.export(obj);
    },

    async setValues(obj) {
      Object.entries(obj).forEach(([key, value]) => storage[key] = value); // update sync storage
      const data = await API.getData();
      Object.entries(obj).forEach(([key, value]) => data.storage[key] = value);
      return browser.storage.local.set({[id]: data});
    },

    async deleteValues(array) {
      array.forEach(key => delete storage[key]);            // update sync storage
      const data = await API.getData();
      array.forEach(key => delete data.storage[key]);
      return browser.storage.local.set({[id]: data});
    },
    // ---------- /storage ---------------------------------

    // ---------- DOM functions ----------------------------
    addStyle(str) {
      str.trim() && GM.addElement('style', {textContent: str});
    },

    addScript(str) {
      str.trim() && GM.addElement('script', {textContent: str});
    },

    addElement(parent, tag, attr) {
      if (!parent || !tag) { return; }
      // mapping (tagName, attributes) vs (parentElement, tagName, attributes)
      let parentElement = attr && parent;
      const tagName = (attr ? tag : parent).toLowerCase();
      const attributes = attr || tag;
      const script = tagName === 'script';

      switch (true) {
        case !!parentElement:
          break;

        case ['link', 'meta'].includes(tagName):
          parentElement = document.head || document.body;
          break;

        case ['script', 'style'].includes(tagName):
          parentElement = document.head || document.body || document.documentElement || document;
          break;

        default:
          parentElement = document.body || document.documentElement || document;
      }

      const elem = document.createElement(tagName);
      elem.dataset.src = `${name}.user.js`;
      Object.entries(attributes)?.forEach(([key, value]) =>
        key === 'textContent' ? elem.append(value) : elem.setAttribute(key, value));


      if (script && attributes.textContent && injectInto !== 'page') {
        elem.textContent +=
          `\n\n//# sourceURL=${FMUrl}userscript/${encodeURI(name)}/inject-into-page/${Math.random().toString(36).substring(2)}.js`;
      }

      try {
        const el = parentElement.appendChild(elem);
        script && el.remove();
        // userscript may record UUID in element's textContent
        return script ? undefined : elem;
      }
      catch(error) { API.log(`addElement ➜ ${tagName} ${error.message}`); }
    },

    popup({type = 'center', modal = true} = {}) {
      const host = document.createElement('gm-popup');      // shadow DOM host
      const shadow = host.attachShadow({mode: 'closed'});   // closed: inaccessible from the outside

      const style = document.createElement('style');
      // support use_dynamic_url in web_accessible_resources
      // https://bugzilla.mozilla.org/show_bug.cgi?id=1713196
      // userscript can access UUID in element's textContent
      // style.textContent = `@import "${FMUrl}content/api-popup.css";`;
      style.textContent = popupCSS;
      shadow.appendChild(style);

      const content = document.createElement('div');        // main content
      content.className = 'content';
      shadow.appendChild(content);

      const close = document.createElement('span');         // close button
      close.className = 'close';
      close.textContent = '✖';
      content.appendChild(close);

      [host, content].forEach(item => item.classList.add(type)); // process options
      host.classList.toggle('modal', type.startsWith('panel-') ? modal : true); // process modal
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
    // ---------- /DOM functions ---------------------------

    // ---------- import -----------------------------------
    createObjectURL(val, option = {type: 'text/javascript'}) {
      const blob = new Blob([val], {type: option.type});
      return URL.createObjectURL(blob);
    },
    // ---------- /import ----------------------------------

    // --- async promise return GM.getResourceText
    async getResourceText(resourceName) {
      return resourceData[resourceName] || '';
    },

    // --- async Promise return GM.getResourceUrl
    async getResourceUrl(resourceName) {
      return resource[resourceName];
    },

    registerMenuCommand(text, onclick, accessKey) {
      scriptCommand[text] = onclick;
    },

    unregisterMenuCommand(text) {
      delete scriptCommand[text];
    },

    log(...text) {
      console.log(`${name}:`, ...text);
    },

    info,
  };

  const globals = {
    GM,

    // background functions
    GM_download:                  GM.download,
    GM_fetch:                     GM.fetch,
    GM_notification:              GM.notification,
    GM_openInTab:                 GM.openInTab,
    GM_setClipboard:              GM.setClipboard,
    GM_xmlhttpRequest:            GM.xmlHttpRequest,        // http -> Http

    // Storage
    GM_getValue:                  API.GM_getValue,
    GM_setValue:                  GM.setValue,
    GM_deleteValue:               GM.deleteValue,
    GM_listValues:                API.GM_listValues,

    GM_getValues:                 API.GM_getValues,
    GM_setValues:                 GM.setValues,
    GM_deleteValues:              GM.deleteValues,

    // DOM functions
    GM_addElement:                GM.addElement,
    GM_addScript:                 GM.addScript,
    GM_addStyle:                  GM.addStyle,
    GM_popup:                     GM.popup,

    // other
    GM_getResourceText:           API.GM_getResourceText,
    GM_getResourceURL:            API.getResourceUrl,       // URL -> Url
    GM_addValueChangeListener:    GM.addValueChangeListener,
    GM_removeValueChangeListener: GM.removeValueChangeListener,
    GM_registerMenuCommand:       GM.registerMenuCommand,
    GM_unregisterMenuCommand:     GM.unregisterMenuCommand,
    GM_createObjectURL:           GM.createObjectURL,
    GM_info:                      GM.info,
    GM_log:                       GM.log,

    // Firefox functions
    cloneInto:                    API.cloneIntoBridge,
    exportFunction,

    // internal use
    matchURL:                     API.matchURL,
    setStorage:                   API.setStorage,
    importBridge:                 API.importBridge,
  };

  // auto-disable sync GM API if async GM API are granted
  grantRemove.forEach(i => delete globals[i]);

  script.defineGlobals(globals);
});