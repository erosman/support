import {App} from './app.js';

// ---------- Match Pattern Check --------------------------
export class Match {                                        // bg & popup

  static async process(tab, pref, bg) {
    const ids = App.getIds(pref);
    const supported = this.supported(tab.url);
    if (bg && !supported) { return []; }                    // Unsupported scheme

    const frames = await browser.webNavigation.getAllFrames({tabId: tab.id});
    if (!supported) {                                       // Unsupported scheme
      return [[], ids.sort(Intl.Collator().compare), frames.length];
    }

    const urls = [...new Set(frames.map(this.cleanUrl).filter(this.supported))];
    const gExclude = pref.globalScriptExcludeMatches ? pref.globalScriptExcludeMatches.split(/\s+/) : [];
    const containerId = tab.cookieStoreId.substring(8);

    // --- background
    if (bg) {
      return ids.filter(id => pref[id].enabled && this.get(pref[id], tab.url, urls, gExclude, containerId))
        .map(id => (pref[id].js ? '🔹 ' : '🔸 ') + id.substring(1));
    }

    // --- popup
    const Tab = [], Other = [];
    ids.sort(Intl.Collator().compare).forEach(item =>
      (this.get(pref[item], tab.url, urls, gExclude, containerId) ? Tab : Other).push(item));
    return [Tab, Other, frames.length];
  }

  static supported(url) {
    return /^(https?:|file:|about:blank)/i.test(url);
  }

  static cleanUrl(url) {
    return (url.url || url).replace(/#.*/, '').replace(/(:\/\/[^:/]+):\d+/, '$1');
  }

  static get(item, tabUrl, urls, gExclude = [], containerId) {
    if (item.container?.[0] && !item.container.includes(containerId)) { return false; } // check container

    !item.allFrames && (urls = [tabUrl]);                   // only check main frame
    const styleMatches = item.style && item.style[0] ? item.style.flatMap(i => i.matches) : [];

    switch (true) {
      case urls.includes('about:blank') && item.matchAboutBlank: // about:blank
        return true;

      case gExclude[0] && this.#isMatch(urls, gExclude):     // Global Script Exclude Matches
      case !item.matches[0] && !item.includes[0] && !item.includeGlobs[0] && !styleMatches[0]: // scripts/css without matches/includes/includeGlobs/style

      // includes & matches & globs
      case !item.includes[0] && !this.#isMatch(urls, [...item.matches, ...styleMatches]):
      case item.includeGlobs[0] && !this.#isMatch(urls, item.includeGlobs, true):
      case item.includes[0] && !this.#isMatch(urls, item.includes, false, true):

      case item.excludeMatches[0] && this.#isMatch(urls, item.excludeMatches):
      case item.excludeGlobs[0] && this.#isMatch(urls, item.excludeGlobs, true):
      case item.excludes[0] && this.#isMatch(urls, item.excludes, false, true):
        return false;

      default:
        return true;
    }
  }

  static #isMatch(urls, arr, glob, regex) {
    switch (true) {
      case regex:
        return urls.some(u => new RegExp(this.#prepareRegEx(arr), 'i').test(u));

      case glob:
        return urls.some(u => new RegExp(this.#prepareGlob(arr), 'i').test(u));

      // catch all checks
      case arr.includes('<all_urls>'):
      case arr.includes('*://*/*') && urls.some(item => item.startsWith('http')):
      case arr.includes('file:///*') && urls.some(item => item.startsWith('file:///')):
        return true;

      default:
        return urls.some(u => new RegExp(this.#prepareMatch(arr), 'i').test(u));
    }
  }

  static #prepareMatch(arr) {
    const regexSpChar = /[-\/\\^$+?.()|[\]{}]/g;            // Regular Expression Special Characters
    return arr.map(item => '(^' +
        item.replace(regexSpChar, '\\$&')
            .replace(/^\*:/g, 'https?:')
            .replace(/\*/g, '.*')
            .replace('/.*\\.', '/(.*\\.)?')
            + '$)')
            .join('|');
  }

  static #prepareGlob(arr) {
    const regexSpChar = /[-\/\\^$+.()|[\]{}]/g;             // Regular Expression Special Characters minus * ?
    return arr.map(item => '(^' +
        item.replace(regexSpChar, '\\$&')
             .replace(/\?/g, '.')
            .replace(/^\*:/g, 'https?:')
            .replace(/\*/g, '.*')
            + '$)')
            .join('|');
  }

  static #prepareRegEx(arr) {
    return arr.map(item => `(${item.slice(1, -1)})`).join('|');
  }
}