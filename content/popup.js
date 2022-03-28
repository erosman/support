import {pref, App, Meta, CheckMatches} from './app.js';

// ----------------- Internationalization ------------------
App.i18n();

// ----------------- Popup ---------------------------------
class Popup {

  constructor() {
    document.querySelectorAll('button').forEach(item => item.addEventListener('click', this.processButtons));
    this.docfrag = document.createDocumentFragment();

    // ----- Scripts
    this.liTemplate = document.querySelector('template').content.firstElementChild;
    this.ulTab = document.querySelector('ul.tab');
    this.ulOther = document.querySelector('ul.other');

    // ----- Info
    this.info = document.querySelector('section.info');
    this.info.querySelector('h3 span').addEventListener('click', () =>
        this.info.parentNode.style.transform = 'translateX(0%)');

    this.infoListDL = this.info.querySelector('.infoList dl');
    this.commandList = this.info.querySelector('dl.commandList');
    this.scratchpad = this.info.querySelector('div.scratchpad');
    this.dtTemp = document.createElement('dt');
    this.ddTemp = document.createElement('dd');
    this.aTemp = document.createElement('a');
    this.aTemp.target = '_blank';

    // ----- Script Commands
    document.querySelector('h3.command').addEventListener('click', () => {
      this.toggleOn(this.commandList);
      this.info.parentNode.style.transform = 'translateX(-50%)';
    });

    // ----- Scratchpad
    this.js = document.querySelector('#js');
    this.js.value = localStorage.getItem('scraptchpadJS') || ''; // recall last entry
    this.css = document.querySelector('#css');
    this.css.value = localStorage.getItem('scraptchpadCSS') || ''; // recall last entry

    document.querySelector('h3.scratch').addEventListener('click', () => {
      this.toggleOn(this.scratchpad);
      this.info.parentNode.style.transform = 'translateX(-50%)';
    });
    document.querySelector('img.scraptchpadJS').addEventListener('click', () => {
      this.js.value = '';
      localStorage.setItem('scraptchpadJS', '');
    });
    document.querySelector('img.scraptchpadCSS').addEventListener('click', () => {
      this.css.value = '';
      localStorage.setItem('scraptchpadCSS', '');
    });

    // ----- Find Scripts
    this.url = '';
    document.querySelector('h3.findScript').addEventListener('click', () => {
      const [scheme, host, ...path] = this.url.split(/:\/{2,3}|\/+/);
      if (scheme.startsWith('http') && host) {
        browser.tabs.create({url: 'https://greasyfork.org/en/scripts/by-site/' + host.replace(/^www\./, '')});
        window.close();
      }
    });

    // --- i18n
    this.lang = navigator.language;
  }

  processButtons() {
    switch (this.dataset.i18n) {
      case 'options': break;
      case 'newJS|title': localStorage.setItem('nav', 'js'); break;
      case 'newCSS|title': localStorage.setItem('nav', 'css'); break;
      case 'help': localStorage.setItem('nav', 'help'); break;
      case 'edit': localStorage.setItem('nav', this.parentNode.id); break;
      case 'run':                                           // infoRun if not already injected in the tab
        this.id === 'infoRun' ? popup.infoRun(this.parentNode.id) : popup.scratchpadRun(this.id);
        return;
      case 'undo':
        this.id === 'infoUndo' ? popup.infoUndo(this.parentNode.id) : popup.scratchpadUndo();
        return;
    }
    browser.runtime.openOptionsPage();
    window.close();
  }

  async process() {
    const tabs = await browser.tabs.query({currentWindow: true, active: true});
    const tabId = tabs[0].id;                                 // active tab id
    this.url = tabs[0].url;                                   // used in find scripts

    const [Tab, Other, frames] = await CheckMatches.process(tabs[0]);
    document.querySelector('h3 span.frame').textContent = frames; // display frame count

    Tab.forEach(item => this.docfrag.appendChild(this.addScript(pref[item])));
    this.ulTab.appendChild(this.docfrag);
    Other.forEach(item => this.docfrag.appendChild(this.addScript(pref[item])));
    this.ulOther.appendChild(this.docfrag);

    // --- check commands if there are active scripts in tab & has registerMenuCommand v2.45
    if(Tab.some(item => pref[item].enabled &&
      ['GM_registerMenuCommand', 'GM.registerMenuCommand'].some(i => pref[item].grant.includes(i)))) {
      browser.runtime.onMessage.addListener((message, sender) =>
          sender.tab.id === tabId && this.addCommand(tabId, message));
      browser.tabs.sendMessage(tabId, {listCommand: []});
    }
  }

  addScript(item) {
    const li = this.liTemplate.cloneNode(true);
    li.classList.add(item.js ? 'js' : 'css');
    item.enabled || li.classList.add('disabled');
    li.children[1].textContent = item.name;
    li.id = '_' + item.name;

    if (item.error) {
      li.children[0].textContent = '\u2718';
      li.children[0].style.color = '#f00';
    }

    li.children[0].addEventListener('click', this.toggleState);
    li.children[1].addEventListener('click', e => this.showInfo(e));
    return li;
  }

  toggleState() {
    const li = this.parentNode;
    const id = li.id;
    if (!id) { return; }

    li.classList.toggle('disabled');
    pref[id].enabled = !li.classList.contains('disabled');
    browser.storage.local.set({[id]: pref[id]});            // update saved pref
  }

  toggleOn(node) {
    [this.infoListDL.parentNode, this.commandList, this.scratchpad].forEach(item => item.classList.toggle('on', item === node));
  }

  showInfo(e) {
    const li = e.target.parentNode;
    const id = li.id;
    this.infoListDL.textContent = '';                       // clearing previous content
    this.toggleOn(this.infoListDL.parentNode);

    this.infoListDL.className = '';                         // reset
    this.infoListDL.classList.add(...li.classList);

    const script =  JSON.parse(JSON.stringify(pref[id]));   // deep clone pref object
    const {homepage, support} = this.getMetadata(script);   // show homepage/support
    script.homepage = homepage;
    script.support = support;
    script.size = new Intl.NumberFormat().format(((script.js || script.css).length/1024).toFixed(1)) + ' KB';
//    script.size = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format((script.js || script.css).length/1024) + ' KB';

    const infoArray = ['name', 'description', 'author', 'version', 'size', 'homepage',
                        'support', 'updateURL', 'matches', 'excludeMatches',
                        'includes', 'excludes', 'includeGlobs', 'excludeGlobs',
                        'container', 'require', 'injectInto', 'runAt', 'grant', 'error'];

    infoArray.forEach(item => {
      if (!script[item]) { return; }                        // skip to next

      let arr = Array.isArray(script[item]) ? script[item] : script[item].split(/\r?\n/);
      if (!arr[0]) { return; }                              // skip to next

      switch (item) {
        case 'name':                                        // i18n if different
        case 'description':
          const i18n = script.i18n[item][this.lang] || script.i18n[item][this.lang.substring(0, 2)]; // fallback to primary language
          i18n && i18n !== script[item] && arr.push(i18n);
          break;

        case 'homepage':
        case 'support':
          const a = this.aTemp.cloneNode();
          a.href = script[item];
          a.textContent = script[item];
          arr[0] = a;
          break;

        case 'require':                                     // add requireRemote to require
          arr = arr.map(item => item.startsWith('lib/') ? item.slice(4, -1) : item);
          script.requireRemote && arr.push(...script.requireRemote);
          break;

        case 'matches':                                     // add UserStyle matches to matches
          script.style?.[0] && arr.push(...script.style.flatMap(i => i.matches));
          break;

        case 'injectInto':
          item = 'inject-into';
          break;

        case 'grant':
          arr.includes('GM.xmlHttpRequest') && arr.push('GM.xmlhttpRequest');
          arr.includes('GM.getResourceUrl') && arr.push('GM.getResourceURL');
          arr = arr.filter(item => !item.startsWith('GM_') || !arr.includes(`GM.${item.substring(3)}`) )
                .filter(item => !['GM.xmlhttpRequest', 'GM.getResourceURL'].includes(item)).sort();
          break;

        case 'runAt':
          item = 'run-at';
          arr[0] = arr[0].replace('_', '-');
          break;
      }

      const dt = this.dtTemp.cloneNode();
      item === 'error' && dt.classList.add('error');
      dt.textContent = item;
      this.docfrag.appendChild(dt);

      arr.forEach(item => {
        const dd = this.ddTemp.cloneNode();
        dd.append(item);
        dd.children[0] && (dd.style.opacity = 0.8);
        this.docfrag.appendChild(dd);
      });
    });

    this.infoListDL.appendChild(this.docfrag);
    const edit = document.querySelector('div.edit');
    edit.id = id;
    const active = e.target.parentNode.parentNode.classList.contains('tab') && script.enabled;
    edit.children[1].disabled = active;
    edit.children[2].disabled = active;
    this.info.parentNode.style.transform = 'translateX(-50%)';
  }

  getMetadata(script) {
    const url = script.updateURL;
    const meta = (script.js || script.css).match(Meta.regEx)[2];

    // look for @homepage @homepageURL @website and @source
    let homepage = meta.match(/@(homepage(URL)?|website|source)\s+(http\S+)/)?.[3];

    // look for @support @supportURL
    let support = meta.match(/@support(URL)?\s+(http\S+)/)?.[2];

    // make homepage from updateURL
    switch (true) {
      case !!homepage || !url:
        break;

      case url.startsWith('https://greasyfork.org/scripts/'):
      case url.startsWith('https://sleazyfork.org/scripts/'):
        homepage = url.replace(/\/code.+/, '');
        break;

      case url.startsWith('https://openuserjs.org/install/'):
        homepage = url.replace('/install/', '/scripts/').replace(/\.user\.js/, '');
        break;

      case url.startsWith('https://userstyles.org/styles/'):
        homepage = url.replace(/userjs\/|\.(user\.js|css)$/, '');
        break;

      case url.startsWith('https://cdn.jsdelivr.net/gh/'):
        homepage = 'https://github.com/' + url.substring(28).replace('@', '/tree/').replace(/\/[^/]+\.user\.js/, '');
        break;

      case url.startsWith('https://github.com/'):
        homepage = url.replace('/raw/', '/tree/').replace(/\/[^/]+\.user\.js/, '');
        break;
    }

    return {homepage, support};
  }
  // ----------------- Script Commands -----------------------
  addCommand(tabId, message) {
    //{name, command: Object.keys(command)}
    if (!message.command || !message.command[0]) { return; }

    const dl = this.commandList;
    const dt = this.dtTemp.cloneNode();
    dt.textContent = message.name;
    this.docfrag.appendChild(dt);

    message.command.forEach(item => {
      const dd = this.ddTemp.cloneNode();
      dd.textContent = item;
      dd.addEventListener('click', () => {
        browser.tabs.sendMessage(tabId, {name: message.name, command: item});
        window.close();
      });
      this.docfrag.appendChild(dd);
    });
    dl.appendChild(this.docfrag);
  }

  // ----------------- Info Run/Undo -----------------------
  infoRun(id) {
    const item = pref[id];
    const code = Meta.prepare(item.js || item.css);
    if (!code.trim()) { return; }                           // e.g. in case of userStyle

    (item.js ? browser.tabs.executeScript({code}) : browser.tabs.insertCSS({code}))
    .catch(error => App.notify(id.substring(1) + '\n' + browser.i18n.getMessage('insertError') + '\n\n' + error.message));
  }

  infoUndo(id) {
    const item = pref[id];
    if (!item.css) { return; }                              // only for userCSS

    const code =  Meta.prepare(item.css);
    if (!code.trim()) { return; }                           // e.g. in case of userStyle

    browser.tabs.removeCSS({code})
    .catch(error => App.notify(id.substring(1) + '\n\n' + error.message));
  }

  // ----------------- Scratchpad --------------------------
  scratchpadRun(id) {
    const js = id === 'jsBtn';
    const code = (js ? this.js : this.css).value.trim();
    if (!code) { return; }
    localStorage.setItem(js ? 'scraptchpadJS' : 'scraptchpadCSS', code); // save last entry

    (js ? browser.tabs.executeScript({code}) : browser.tabs.insertCSS({code}))
    .catch(error => App.notify((js ? 'JavaScript' : 'CSS') + '\n' + browser.i18n.getMessage('insertError') + '\n\n' + error.message));
  }

  scratchpadUndo() {
    const code = this.css.value.trim();
    if (!code) { return; }
    browser.tabs.removeCSS({code})
    .catch(error => App.notify('CSS\n' + error.message));
  }
}
const popup = new Popup();
// ----------------- /Popup --------------------------------

// ----------------- User Preference -----------------------
App.getPref().then(() => {
  popup.process();

  // --- add custom style
  pref.customPopupCSS && (document.querySelector('style').textContent = pref.customPopupCSS);
});
// ----------------- /User Preference ----------------------