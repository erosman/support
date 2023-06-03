import {App} from './app.js';

// ---------- API Message Handler (Side Effect) ------------
export class OnMessage {

  static {
    // message from api.js
    browser.runtime.onMessage.addListener((...e) => this.process(...e));
    this.pref = {};
  }

  static async process(message, sender) {
    const {name, api, data: e} = message;
    if (!api) { return; }

    const id = `_${name}`;
    const pref = this.pref;

    // only set if in container/incognito
    const storeId = sender.tab.cookieStoreId !== 'firefox-default' && sender.tab.cookieStoreId;
    const logError = (error) => App.log(name, `${message.api} ➜ ${error.message}`, 'error');
    let needUpdate = false;

    switch (api) {
      // ---------- internal use only (not GM API) ---------
      case 'log':
        return App.log(name, e.message, e.type);

      // ---------- GM API ---------------------------------

      // ---------- storage --------------------------------
      case 'setValue':
        // e is an object of key/value
        Object.entries(e).forEach(([key, value]) => {
          if (pref[id].storage[key] !== value) {
            pref[id].storage[key] = value;
            needUpdate = true;
          }
        });

        if (!needUpdate) { return; }                        // return if storage hasn't changed

        return browser.storage.local.set({[id]: pref[id]}); // Promise with no arguments OR reject with error message

      case 'deleteValue':
        // e is an array
        e.forEach(item => {
          if (pref[id].storage.hasOwnProperty(item)) {
            delete pref[id].storage[item];
            needUpdate = true;
          }
        });

        if (!needUpdate) { return; }                        // return if storage hasn't changed

        return browser.storage.local.set({[id]: pref[id]}); // Promise with no arguments OR reject with error message
      // ---------- /storage -------------------------------

      case 'download':
        // Promise with id OR reject with error message
        return browser.downloads.download({
          url: e.url,
          filename: e.filename || null,
          saveAs: true,
          conflictAction: 'uniquify',
          cookieStoreId: storeId && storeId !== 'firefox-private' ? storeId : 'firefox-default', // Firefox 92 (Released 2021-09-07)
          incognito: sender.tab.incognito
        })
        .catch(logError);

      case 'notification':
        // Promise with notification's ID
        return browser.notifications.create('', {
          type: 'basic',
          iconUrl: e.image || 'image/icon.svg',
          title: name,
          message: e.text
        });

      case 'openInTab':
        // Promise with tabs.Tab OR reject with error message
        return browser.tabs.create({url: e.url, active: e.active, openerTabId: sender.tab.id})
          .catch(logError);

      case 'setClipboard':
        // Promise resolve with value undefined OR reject with error message
        let type = e.type;
        if (type === 'text/plain') {
          return navigator.clipboard.writeText(e.data).catch(logError);
        }

        // all other types
        const blob = new Blob([e.data], {type});
        const data = [new ClipboardItem({[type]: blob})];
        return navigator.clipboard.write(data).catch(logError);

      case 'fetch':
        return this.fetch(e, storeId, name);

      case 'xmlHttpRequest':
        return this.xmlHttpRequest(e, storeId);
    }
  }

  static async addCookie(url, headers, storeId) {
    // add contextual cookies, only in container/incognito
    // https://bugzilla.mozilla.org/show_bug.cgi?id=1670278
    // if privacy.firstparty.isolate = true
    // Error: First-Party Isolation is enabled, but the required 'firstPartyDomain' attribute was not set.
    const cookies = await browser.cookies.getAll({url, storeId});
    const str = cookies && cookies.map(item => `${item.name}=${item.value}`).join('; ');
    str && (headers['FM-Contextual-Cookie'] = str);
  }

  static async fetch(e, storeId, name) {
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
        ['bodyUsed', 'ok', 'redirected', 'status', 'statusText', 'type', 'url'].forEach(i => res[i] = response[i]);

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
        }
        catch (error) {
          App.log(name, `fetch ${e.url} ➜ ${error.message}`, 'error');
          return error.message;
        }
      })
      .catch(error => App.log(name, `fetch ${e.url} ➜ ${error.message}`, 'error'));
  }

  static async xmlHttpRequest(e, storeId) {
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

  static makeResponse(xhr, type) {
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