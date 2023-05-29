// ---------- Scratchpad -----------------------------------
export class Scratchpad {

  static {
    this.scratchpad = document.querySelector('div.scratchpad');
    this.js = document.querySelector('#js');
    this.js.value = localStorage.getItem('scratchpadJS') || ''; // recall last entry
    this.css = document.querySelector('#css');
    this.css.value = localStorage.getItem('scratchpadCSS') || ''; // recall last entry

    document.querySelector('img.scratchpadJS').addEventListener('click', () => {
      this.js.value = '';
      localStorage.removeItem('scratchpadJS');
    });
    document.querySelector('img.scratchpadCSS').addEventListener('click', () => {
      this.css.value = '';
      localStorage.removeItem('scratchpadCSS');
    });
  }

  static run(id) {
    const js = id === 'jsBtn';
    const code = (js ? this.js : this.css).value.trim();
    if (!code) { return; }
    localStorage.setItem(js ? 'scratchpadJS' : 'scratchpadCSS', code); // save last entry

    (js ? browser.tabs.executeScript({code}) : browser.tabs.insertCSS({code}))
    .catch(error => App.notify((js ? 'JavaScript' : 'CSS') + '\n' + browser.i18n.getMessage('insertError') + '\n\n' + error.message));
  }

  static undo() {
    const code = this.css.value.trim();
    if (!code) { return; }
    browser.tabs.removeCSS({code})
    .catch(error => App.notify('CSS\n' + error.message));
  }
}