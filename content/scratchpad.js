import {App} from './app.js';

// ---------- Scratchpad (Side Effect) ---------------------
class Scratchpad {

  static {
    // this.scratchpad = document.querySelector('div.scratchpad');
    this.js = document.querySelector('#js');
    this.js.value = localStorage.getItem('scratchpadJS') || ''; // recall last entry
    this.css = document.querySelector('#css');
    this.css.value = localStorage.getItem('scratchpadCSS') || ''; // recall last entry

    document.querySelectorAll('.scratchpad button').forEach(item => item.addEventListener('click', e => this.processButtons(e)));
  }

  static processButtons(e) {
    const id = e.target.dataset.i18n;
    switch (id) {
      case 'run':
      case 'delete|title':
        this[e.target.id]();
        break;

      case 'undo':
        this.undo();
        break;
      }
  }

  static runJS() {
    const code = this.js.value.trim();
    if (!code) { return; }

    localStorage.setItem('scratchpadJS', code);             // save last entry
    browser.tabs.executeScript({code})
    .catch(error => App.notify('JavaScript: ' + browser.i18n.getMessage('insertError') + '\n\n' + error.message));
  }

  static runCSS() {
    const code = this.css.value.trim();
    if (!code) { return; }

    localStorage.setItem('scratchpadCSS', code);            // save last entry
    browser.tabs.insertCSS({code})
    .catch(error => App.notify('CSS: ' + browser.i18n.getMessage('insertError') + '\n\n' + error.message));
  }

  static undo() {
    const code = this.css.value.trim();
    if (!code) { return; }
    browser.tabs.removeCSS({code})
    .catch(error => App.notify('CSS\n' + error.message));
  }

  static clearJS() {
    this.js.value = '';
    localStorage.removeItem('scratchpadJS');
  }

  static clearCSS() {
    this.css.value = '';
    localStorage.removeItem('scratchpadCSS');
  }
}