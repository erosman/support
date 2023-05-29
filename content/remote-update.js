import {App} from './app.js';

// ---------- Remote Update --------------------------------
export class RemoteUpdate {                                 // bg options

  static getUpdate(item, manual) {                          // bg opt
    switch (true) {
      // --- get meta.js
      case item.updateURL.startsWith('https://greasyfork.org/scripts/'):
      case item.updateURL.startsWith('https://sleazyfork.org/scripts/'):
      case item.js && item.updateURL.startsWith('https://openuserjs.org/install/'):
        this.#getMeta(item, manual);
        break;

      case /^https:\/\/userstyles\.org\/styles\/\d+\/.+\.css/.test(item.updateURL):
        this.#getStylishVersion(item, manual);
        break;

      // --- direct update
      default:
        this.getScript(item);
    }
  }

  static #getMeta(item, manual) {
    const url = item.metaURL || item.updateURL.replace(/\.user\.(js|css)/i, '.meta.$1');
    fetch(url)
    .then(response => response.text())
    .then(text => this.#needUpdate(text, item) ? this.getScript(item) :
                      manual && App.notify(browser.i18n.getMessage('noNewUpdate'), item.name))
    .catch(error => App.log(item.name, `getMeta ${url} ➜ ${error.message}`, 'error'));
  }

  static #getStylishVersion(item, manual) {
    const url = item.updateURL.replace(/(\d+\/.+)css/i, 'userjs/$1user.js');
    fetch(url)
    .then(response => response.text())
    .then(text => {
      const m = text.match(/@version\s+(\S+)/);
      const version = m ? m[1].substring(2,10) : '';
      version > item.version ? this.#getStylish(item, version) :
        manual && App.notify(browser.i18n.getMessage('noNewUpdate'), item.name);
    })
    .catch(error => App.log(item.name, `getMeta ${url} ➜ ${error.message}`, 'error'));
  }


  static #getStylish(item, version) {
    const metaData =
`/*
==UserStyle==
@name           ${item.name}
@description    ${item.description}
@author         ${item.author}
@version        ${version}
@homepage       ${item.updateURL.replace(/\.css(\?.*|$)/, '')}
==/UserStyle==
*/`;

    fetch(item.updateURL)
    .then(response => response.text())
    .then(text => !text.trim().startsWith('<') && this.callback(metaData + '\n\n' + text, item.name, item.updateURL)) // check HTML timeout response
    .catch(error => App.log(item.name, `getStylish ${item.updateURL} ➜ ${error.message}`, 'error'));
  }

  static #needUpdate(text, item) {
    const version = text.match(/@version\s+(\S+)/);         // check version
    return version && this.higherVersion(version[1], item.version);
  }

  static getScript(item) {                                  // here bg
    fetch(item.updateURL)
    .then(response => response.text())
    .then(text => this.callback(text, item.name, item.updateURL))
    .catch(error => App.log(item.name, `getScript ${item.updateURL} ➜ ${error.message}`, 'error'));
  }

  static higherVersion(a, b) {                              // here bg opt
    return a.localeCompare(b, undefined, {numeric: true, sensitivity: 'base'}) > 0;
  }
}