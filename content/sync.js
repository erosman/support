import {App} from './app.js';

// ---------- Storage Sync ---------------------------------
export class Sync {

  static noUpdate = false;

  static allowed(pref) {
    if (!pref.sync) { return; }

    // storage.sync limit 100KB -> 1MB
    // https://github.com/w3c/webextensions/issues/351
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
  static async get(pref) {
    if (!this.allowed(pref)) { return; }

    const result = await browser.storage.sync.get();
    if (!Object.keys(result)[0]) { return; }

    Object.keys(result).forEach(item => pref[item] = result[item]); // update pref with the saved version

    const deleted = [];
    App.getIds(pref).forEach(item => {
      if (!result[item]) {                                  // remove deleted in sync from pref
        delete pref[item];
        deleted.push(item);
      }
    });
    deleted[0] && await browser.storage.local.remove(deleted); // delete scripts from storage local
    browser.storage.local.set(pref);                        // update local saved pref, no storage.onChanged.addListener() yet
  }

  // --- storage sync ➜ local update
  static async apply(changes, pref) {
    if (!this.allowed(pref)) { return; }

    const [keep, deleted] = this.#sortChanges(changes);
    this.noUpdate = false;
    deleted[0] && await browser.storage.local.remove(deleted); // delete scripts from storage local
    browser.storage.local.set(keep)
    .catch(error => App.log('local', error.message, 'error'));
  }

  // --- storage local ➜ sync update
  static set(changes, pref) {
    if (!this.allowed(pref)) { return; }

    const [keep, deleted] = this.#sortChanges(changes);
    this.noUpdate = true;
    browser.storage.sync.set(keep)
    .then(() => deleted[0] && browser.storage.sync.remove(deleted)) // delete scripts from storage sync
    .catch(error => {
      this.noUpdate = false;
      App.log('Sync', error.message, 'error');
    });
  }

  static #sortChanges(changes) {
    const keep = {};
    const deleted = [];
    Object.keys(changes).forEach(item => {
      item.startsWith('_') && !changes[item].newValue ? deleted.push(item) :
          keep[item] = changes[item].newValue;              // or pref[item]
    });
    return [keep, deleted];
  }
}