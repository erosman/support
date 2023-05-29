// ---------- Context Menu (Side Effect) -------------------
class Menus {

  static {
    browser.menus && this.init();                           // menus not supported on Android
  }

  static init() {
    const contextMenus = [
      {id: 'options', contexts: ['browser_action'], icons: {16: '/image/gear.svg'}},
      {id: 'newJS',   contexts: ['browser_action'], icons: {16: '/image/js.svg'}},
      {id: 'newCSS',  contexts: ['browser_action'], icons: {16: '/image/css.svg'}},
      {id: 'help',    contexts: ['browser_action'], icons: {16: '/image/help.svg'}},
      {id: 'log',     contexts: ['browser_action'], icons: {16: '/image/document.svg'}},
      {id: 'localeMaker', contexts: ['browser_action'], icons: {16: '/locale-maker/locale-maker.svg'}, title: 'Locale Maker'},
    ];

    contextMenus.forEach(item => {
      if (item.id) {
        !item.title && (item.title = browser.i18n.getMessage(item.id)); // always use the same ID for i18n
      }
      browser.menus.create(item);
    });

    // prepare for manifest v3
    browser.menus.onClicked.addListener(this.#process);
  }

  static #process(info, tab) {
    switch (info.menuItemId) {
      case 'options':
        browser.runtime.openOptionsPage();
        break;

      case 'newJS':
      case 'newCSS':
      case 'help':
      case 'log':
        browser.tabs.create({url: '/content/options.html?' + info.menuItemId});
        break;

      case 'localeMaker':
        browser.tabs.create({url: '/locale-maker/locale-maker.html'});
        break;
    }
  }
}