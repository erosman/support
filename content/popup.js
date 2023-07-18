import {pref, App} from './app.js';
import {Meta} from './meta.js';
import {Match} from './match.js';
import {PSL} from './psl.js';
import './scratchpad.js';
import './i18n.js';

// ---------- User Preference ------------------------------
await App.getPref();

// ---------- Popup ----------------------------------------
class Popup {

  static {
    // --- Scripts
    this.liTemplate = document.querySelector('template').content.firstElementChild;
    this.ulTab = document.querySelector('ul.tab');
    this.ulOther = document.querySelector('ul.other');

    // --- Theme
    document.body.classList.toggle('dark', localStorage.getItem('dark') === 'true'); // defaults to false

    // --- add custom style
    pref.customPopupCSS && (document.querySelector('style').textContent = pref.customPopupCSS);

    this.docFrag = document.createDocumentFragment();
    document.querySelectorAll('.main button').forEach(item => item.addEventListener('click', this.processButtons));
    this.process();
  }

  static processButtons() {
    const id = this.dataset.i18n;
    switch (id) {
      case 'options':
        browser.runtime.openOptionsPage();
        break;

      case 'newJS|title':
      case 'newCSS|title':
        browser.tabs.create({url: '/content/options.html?' + id.slice(0, -6)});
        break;

      case 'help':
        browser.tabs.create({url: '/content/options.html?help'});
        break;
    }
    window.close();
  }

  static async process() {
    const tabs = await browser.tabs.query({currentWindow: true, active: true});
    const tabId = tabs[0].id;                               // active tab id

    // make find script list
    this.setSearch(tabs[0].url);

    const [Tab, Other, frames] = await Match.process(tabs[0], pref);
    document.querySelector('h3 span.frame').textContent = frames; // display frame count

    Tab.forEach(item => this.docFrag.appendChild(this.addScript(pref[item])));
    this.ulTab.appendChild(this.docFrag);
    Other.forEach(item => this.docFrag.appendChild(this.addScript(pref[item])));
    this.ulOther.appendChild(this.docFrag);

    // check commands if there are active scripts in tab & has registerMenuCommand FM 2.45
    Info.getMenuCommand(Tab, tabId);

    // add click listener if it has children
    [this.ulTab, this.ulOther].forEach(item =>
      item.children[0] && item.addEventListener('click', e => this.getClick(e)));
  }

  static getClick(e) {
    const li = e.target.closest('li');
    switch (true) {
      case !li?.id:
        break;

      case e.target.classList.contains('enable'):
        this.toggleState(li);
        break;

      case e.target.classList.contains('name'):
        Info.show(li);
        break;
    }
  }

  static addScript(item) {
    const li = this.liTemplate.cloneNode(true);
    li.id = '_' + item.name;
    li.classList.add(item.js ? 'js' : 'css');
    item.enabled || li.classList.add('disabled');
    const sp = li.children;
    sp[1].textContent = item.name;

    if (item.error) {
      sp[0].textContent = '✘';
      sp[0].style.color = '#f00';
    }
    return li;
  }

  static toggleState(li) {
    const id = li.id;
    li.classList.toggle('disabled');
    pref[id].enabled = !li.classList.contains('disabled');
    browser.storage.local.set({[id]: pref[id]});            // update saved pref
  }

  // --- set Find scripts for this site
  static setSearch(url) {
    try { url = new URL(url); }
    catch { return; }                                       // unacceptable url

    let domain = '';
    let sld = '';
    url.protocol.startsWith('http') && ({domain, sld} = PSL.parse(url.host)); // only for http/https
    document.querySelectorAll('.findScript a').forEach(i =>
      i.href = i.href.replace(/;domain;/, domain).replace(/;sld;/, sld));
  }
}
// ---------- /Popup ---------------------------------------

// ---------- Info + Run/Undo ------------------------------
class Info {

  static {
    // --- Info
    this.navInfo = document.querySelector('input#info');
    this.info = document.querySelector('section.info');

    this.infoListDL = this.info.querySelector('.infoList dl');
    this.commandList = this.info.querySelector('.commandList dl');

    this.dtTemp = document.createElement('dt');
    this.ddTemp = document.createElement('dd');
    this.aTemp = document.createElement('a');
    this.aTemp.target = '_blank';

    // --- i18n
    this.lang = navigator.language;

    this.docFrag = document.createDocumentFragment();
    document.querySelectorAll('.infoList button').forEach(item => item.addEventListener('click', e => this.processButtons(e)));
  }

  static processButtons(e) {
    const parentId = e.target.parentElement.id;
    const id = e.target.dataset.i18n;
    switch (id) {
      case 'edit':
        browser.tabs.create({url: '/content/options.html?script=' + parentId.substring(1)});
        window.close();
        break;

      case 'run':
        this.run(parentId);
        break;

      case 'undo':
        this.undo(parentId);
        break;
    }
  }

  static show(li) {
    const id = li.id;
    this.infoListDL.textContent = '';                       // clearing previous content

    this.infoListDL.className = '';                         // reset
    this.infoListDL.classList.add(...li.classList);

    const script = JSON.parse(JSON.stringify(pref[id]));    // deep clone pref object
    const {homepage, support, license} = this.getMetadata(script); // show homepage/support
    script.homepage = homepage;
    script.support = support;
    script.license = license;
    script.require = [...script.require, ...script.requireRemote]; // merge together
    script.size = new Intl.NumberFormat().format(((script.js || script.css).length/1024).toFixed(1)) + ' KB';
    // script.size = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format((script.js || script.css).length/1024) + ' KB';

    const infoArray = [
      'name', 'description', 'author', 'version', 'size', 'license', 'require',
      'matches', 'excludeMatches', 'includes', 'excludes', 'includeGlobs', 'excludeGlobs',
      'grant', 'container', 'injectInto', 'runAt', 'error',
      'homepage', 'support', 'updateURL'
    ];

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
        case 'updateURL':
          const a = this.aTemp.cloneNode();
          a.href = script[item];
          a.textContent = decodeURI(script[item]);
          arr[0] = a;
          break;

        case 'matches':                                     // add UserStyle matches to matches
          script.style?.[0] && arr.push(...script.style.flatMap(i => i.matches));
          break;

        case 'injectInto':
          item = 'inject-into';
          break;

        case 'grant':
          const [grantKeep] = App.sortGrant(arr);
          arr = grantKeep.sort();
          break;

        case 'runAt':
          item = 'run-at';
          arr[0] = arr[0].replace('_', '-');
          break;
      }

      const dt = this.dtTemp.cloneNode();
      item === 'error' && dt.classList.add('error');
      dt.textContent = item;
      this.docFrag.appendChild(dt);

      arr.forEach(item => {
        const dd = this.ddTemp.cloneNode();
        dd.append(item);
        dd.children[0] && (dd.style.opacity = 0.8);
        this.docFrag.appendChild(dd);
      });
    });

    this.infoListDL.appendChild(this.docFrag);
    const edit = document.querySelector('div.edit');
    edit.id = id;
    edit.children[2].disabled = !!script.js;                // only for CSS
    edit.children[2].disabled && (edit.children[2].title = browser.i18n.getMessage('undoDisabled'));

    this.navInfo.checked = true;                            // navigate slide to info page
  }

  static getMetadata(script) {
    const url = script.updateURL;
    const meta = (script.js || script.css).match(Meta.regEx)[2];

    // look for @homepage @homepageURL @website and @source
    let homepage = meta.match(/@(homepage(URL)?|website|source)\s+(http\S+)/)?.[3];

    // look for @support @supportURL
    let support = meta.match(/@support(URL)?\s+(http\S+)/)?.[2];

    // look for @license
    let license = meta.match(/@license\s+(.+)/)?.[1];

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

    return {homepage, support, license};
  }

  static run(id) {
    const item = pref[id];
    const code = Meta.prepare(item.js || item.css);
    if (!code.trim()) { return; }                           // e.g. in case of userStyle

    (item.js ? browser.tabs.executeScript({code}) : browser.tabs.insertCSS({code}))
    .catch(error => App.notify(id.substring(1) + '\n' + browser.i18n.getMessage('insertError') + '\n\n' + error.message));
  }

  static undo(id) {
    const item = pref[id];
    if (!item.css) { return; }                              // only for userCSS

    const code = Meta.prepare(item.css);
    if (!code.trim()) { return; }                           // e.g. in case of userStyle

    browser.tabs.removeCSS({code})
    .catch(error => App.notify(id.substring(1) + '\n\n' + error.message));
  }

  // ---------- Script Commands ----------------------------
  static getMenuCommand(Tab, tabId) {
    // --- check commands if there are active scripts in tab & has registerMenuCommand v2.45
    if(Tab.some(item => pref[item].enabled &&
      ['GM_registerMenuCommand', 'GM.registerMenuCommand'].some(i => pref[item].grant?.includes(i)))) {
      browser.runtime.onMessage.addListener((message, sender) =>
        sender.tab.id === tabId && this.addCommand(tabId, message));
      browser.tabs.sendMessage(tabId, {listCommand: []});
    }
  }

  static addCommand(tabId, message) {
    // {name, command: Object.keys(command)}
    if (!message.command?.[0]) { return; }

    const dl = this.commandList;
    const dt = this.dtTemp.cloneNode();
    dt.textContent = message.name;
    this.docFrag.appendChild(dt);

    message.command.forEach(item => {
      const dd = this.ddTemp.cloneNode();
      dd.textContent = item;
      dd.addEventListener('click', () => {
        browser.tabs.sendMessage(tabId, {name: message.name, command: item});
        window.close();
      });
      this.docFrag.appendChild(dd);
    });
    dl.appendChild(this.docFrag);
  }
}
// ---------- /Info + Run/Undo -----------------------------