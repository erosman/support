import {App} from './app.js';
import {Meta} from './meta.js';

// ---------- Migrate --------------------------------------
export class Migrate {

  static async init(pref) {
    // --- 2.68 (2023-05-00)
    localStorage.removeItem('migrate');

    // fix typo
    const js = localStorage.getItem('scraptchpadJS');
    js && localStorage.setItem('scratchpadJS', js);
    localStorage.removeItem('scraptchpadJS');

    const css = localStorage.getItem('scraptchpadCSS');
    css && localStorage.setItem('scratchpadCSS', css);
    localStorage.removeItem('scraptchpadCSS');

    // covert userScript lib/*.jsm to original @require URL
    const requireIds = App.getIds(pref).filter(id =>
      pref[id].js && pref[id].require.some(i => i.startsWith('lib/')));
    if (requireIds[0]) {
      requireIds.forEach(id => pref[id].require = this.#getRequire(pref[id].js));

      // update database
      await browser.storage.local.set(pref);
    }
  }

  static #getRequire(js) {
    const require = [];
    const metaData = js.match(Meta.regEx);
    metaData[2].split(/[\r\n]+/).forEach(item => {          // lines
      let [,prop, value = ''] = item.trim().match(Meta.lineRegex) || [];
      prop === 'require' && value && require.push(value);
    });

    return require;
  }
}

/*
  2023-05-14
  FM version users
  -----------------
  1.47	1
  2.32	1
  2.55	1
  2.56	4
  2.59	1
  2.60	1
  2.62	2
  2.64	1
  2.65	1
  2.66	6
  ...

  FF version users
  -----------------
  78.15.0	1
  88.0	  1
  95.0.1	1
  96.0	  1
  96.0.2	1
  99.0	  1
  99.0.1	1
  102.0	  1
  ...
*/