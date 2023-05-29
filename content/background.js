import {pref, App} from './app.js';
import {Sync} from "./sync.js";
import {Meta} from './meta.js';
import {Match} from './match.js';
import {Script} from './script.js';
import {Counter} from './counter.js';
import {Migrate} from './migrate.js';
import './menus.js'
import './installer.js';
import './web-request.js';
import './api-message.js';

// ---------- User Preference ------------------------------
await App.getPref();

// ---------- Process Preference ---------------------------
class ProcessPref {

  static {
    this.process();
  }

  static async process() {
    await Sync.get(pref);                                   // storage sync -> local update

    await Migrate.init(pref);                               // migrate after storage sync check

    // --- Script Counter
    Counter.init(pref);

    // --- Scripts Register
    await Script.init();                                    // await data initialization
    Script.update(pref);                                    // register all

    // Change listener, after migrate
    browser.storage.onChanged.addListener((...e) => this.onChanged(...e));
  }

  static onChanged(changes, area) {
    switch (true) {
      case Sync.noUpdate:                                   // prevent loop from sync update
        Sync.noUpdate = false;
        break;

      case area === 'local':
        // update pref with the saved version
        Object.keys(changes).forEach(item => {
          typeof changes[item].newValue !== 'undefined' ?
            pref[item] = changes[item].newValue :
            delete pref[item];
          });

        Counter.pref = pref;                                // update Counter pref
        this.processPrefUpdate(changes);                    // apply changes
        Sync.set(changes, pref);                            // set changes to sync
        break;

      case area === 'sync':                                 // from sync
        Sync.apply(changes, pref);                          // apply changes to local
        break;
    }
  }

  static processPrefUpdate(changes) {
    // check counter preference has changed
    if (changes.counter && changes.counter.newValue !== changes.counter.oldValue) {
      Counter.init(pref);
    }

    // global change
    const gExclude = changes.globalScriptExcludeMatches;
    if (gExclude && gExclude.newValue !== gExclude.oldValue) {
      Script.update(pref);                                  // re-register all
      return;                                               // end here
    }

    // find changed scripts
    const relevant = ['name', 'enabled', 'injectInto', 'require', 'requireRemote', 'resource',
    'allFrames', 'js', 'css', 'style', 'container', 'grant', 'matches', 'excludeMatches',
    'includeGlobs', 'excludeGlobs', 'includes', 'excludes', 'matchAboutBlank', 'runAt'];

    Object.keys(changes).filter(i => i.startsWith('_')).forEach(id => {
      const {oldValue, newValue} = changes[id];

      // if deleted, unregister
      if(!newValue) {
        Script.remove(oldValue);
      }
      // if added or relevant data changed
      else if (!oldValue || relevant.some(i => !this.equal(oldValue[i], newValue[i]))) {
        Script.process(pref, id);                           // also Script.update(pref, [id)];

        // apply userCSS changes to tabs
        switch (true) {
          case !newValue.css:                               // not userCSS
          case !oldValue && !newValue.enabled:              // new & disabled
            break;

          case !oldValue?.enabled && newValue.enabled:      // new & enabled OR disabled -> enabled
            this.updateTabs(id);
            break;

          case newValue.enabled && oldValue.css !== newValue.css: // enabled & CSS change
          case oldValue.enabled && !newValue.enabled:       // enabled -> disabled
            this.updateTabs(id, oldValue.css);
            break;
        }
      }
    });
  }

  static equal(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  static updateTabs(id, oldCSS) {
    const {css, allFrames, enabled} = pref[id];
    const gExclude = pref.globalScriptExcludeMatches?.split(/\s+/) || [];

    browser.tabs.query({}).then(tabs => {
      tabs.forEach(async tab => {
        if (tab.discarded) { return; }
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