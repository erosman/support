import {pref, App} from './app.js';
import {ProgressBar} from './progress-bar.js';
import {ImportExport} from './import-export.js';
import {Meta} from './meta.js';
import {RemoteUpdate} from './remote-update.js';
import {Pattern} from './pattern.js';
import {Color} from './color.js';
import {Nav} from './nav.js';
import './cm-config.js';
import './log.js';
import './i18n.js';

// ---------- User Preference ------------------------------
await App.getPref();

// ---------- Options --------------------------------------
class Options {

  static {
    document.querySelector('button[data-i18n="importFromUrl"]').addEventListener('click', this.importFromUrl);
    document.querySelector('button[type="submit"]').addEventListener('click', () => this.check()); // submit button

    this.init(['autoUpdateInterval', 'cmOptions', 'counter', 'sync',
      'customOptionsCSS', 'customPopupCSS', 'globalScriptExcludeMatches']);
  }

  static init(keys = Object.keys(pref)) {
    this.prefNode = document.querySelectorAll('#' + keys.join(',#')); // defaults to pref keys
    this.globalScriptExcludeMatches = document.querySelector('#globalScriptExcludeMatches');

    // --- add custom style
    pref.customOptionsCSS && (document.querySelector('style').textContent = pref.customOptionsCSS);

    this.process();
  }

  static process(save) {
    // 'save' is only set when clicking the button to save options
    this.prefNode.forEach(node => {
      // value: 'select-one', 'textarea', 'text', 'number'
      const attr = node.type === 'checkbox' ? 'checked' : 'value';
      save ? pref[node.id] = node[attr] : node[attr] = pref[node.id];
    });

    save && !ProgressBar.show() && browser.storage.local.set(pref); // update saved pref
  }

  static check() {
    // --- check Global Script Exclude Matches
    if(!Pattern.validate(this.globalScriptExcludeMatches)) { return; }

    // Custom CodeMirror Options
    const cmOptionsNode = document.querySelector('#cmOptions');
    cmOptionsNode.value = cmOptionsNode.value.trim();
    if (cmOptionsNode.value) {
      let cmOptions = App.JSONparse(cmOptionsNode.value);
      if (!cmOptions) {
        App.notify(browser.i18n.getMessage('jsonError')) ;
        return;
      }
      // remove disallowed
      delete cmOptions.lint;
      delete cmOptions.mode;
      cmOptions.jshint && delete cmOptions.jshint.globals;
      cmOptionsNode.value = JSON.stringify(cmOptions, null, 2); // reset value with allowed options
    }

    // --- save options
    this.process(true);
  }

  static importFromUrl() {
    const url = prompt(browser.i18n.getMessage('importFromUrlMessage'), localStorage.getItem('importFromUrl') || '')?.trim();
    if (!url) { return; }

    localStorage.setItem('importFromUrl', url);

    fetch(url)
    .then(response => response.json())
    .then(data => {
      // FireMonkey has userscripts which are not in default pref keys
      Object.keys(data).forEach(item =>
        (pref.hasOwnProperty(item) || item.startsWith('_')) && (pref[item] = data[item]));
      Options.process();                                    // set options after the pref update
      Script.process();                                     // update page display
    })
    .catch(error => App.notify(browser.i18n.getMessage('error') + '\n\n' + error.message));
  }
}
// ---------- /Options -------------------------------------

// ---------- Scripts --------------------------------------
class Script {

  static {
    RemoteUpdate.callback = this.processResponse.bind(this);

    this.docFrag = document.createDocumentFragment();
    this.liTemplate = document.createElement('li');
    this.navUL = document.querySelector('aside ul');
    this.legend = document.querySelector('.script legend');
    this.box = document.querySelector('.script .box');
    this.box.value = '';                                    // browser retains textarea content on refresh

    this.enable = document.querySelector('#enable');
    this.enable.addEventListener('change', () => this.toggleEnable());
    Meta.enable = this.enable;

    this.autoUpdate = document.querySelector('#autoUpdate');
    this.autoUpdate.addEventListener('change', () => this.toggleAutoUpdate());
    Meta.autoUpdate = this.autoUpdate;

    // --- User Variables
    this.userVar = document.querySelector('.userVar ul');
    Meta.userVar = this.userVar;
    document.querySelector('.userVar button').addEventListener('click', () => this.resetUserVar());

    // --- User Metadata
    this.userMeta = document.querySelector('#userMeta');
    this.userMeta.value = '';
    Meta.userMeta = this.userMeta;

    const userMetaSelect = document.querySelector('#userMetaSelect');
    userMetaSelect.selectedIndex = 0;
    userMetaSelect.addEventListener('change', e => {
      this.userMeta.value = (this.userMeta.value + '\n' + e.target.value).trim();
      e.target.selectedIndex = 0;
    });

    // --- Storage
    this.storage = document.querySelector('#storage');
    this.storage.value = '';

    document.querySelectorAll('.script button, .script li.button, aside button').forEach(item =>
      item.addEventListener('click', e => this.processButtons(e)));

    window.addEventListener('beforeunload', e =>
      this.unsavedChanges() ? e.preventDefault() : this.box.value = '');


    this.template = {
      js:
`// ==UserScript==
// @name
// @match            *://*/*
// @version          1.0
// ==/UserScript==`,

      css:
`/*
==UserCSS==
@name
@match            *://*/*
@version          1.0
==/UserCSS==
*/`
};

    // --- Import/Export Script
    document.getElementById('fileScript').addEventListener('change', e => this.processFileSelect(e));

    // --- menu dropdown (close when clicking body)
    const menuDetails = document.querySelectorAll('.menu details');
    document.body.addEventListener('click', e =>
      menuDetails.forEach(item => !item.contains(e.explicitOriginalTarget) && (item.open = false))
    );

    // --- textarea resize
    const divUser = document.querySelector('.menu details div.user');
    divUser.parentElement.addEventListener('toggle', e => !e.target.open && divUser.classList.remove('expand'));
    divUser.querySelectorAll('textarea').forEach(item => {
      item.addEventListener('focus', () => divUser.classList.toggle('expand', true));
    });

    // --- CodeMirror & Theme
    this.cm;
    this.footer = document.querySelector('footer');

    const themeSelect = document.querySelector('#theme');
    this.theme = localStorage.getItem('theme') ||
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'darcula' : 'default');
    themeSelect.value = this.theme;
    if (themeSelect.selectedIndex === -1) {                 // bad value correction
      this.theme = 'default';
      themeSelect.value = this.theme;
    }

    this.defaultLink = document.querySelector('link[rel="stylesheet"]');
    this.addTheme(localStorage.getItem('dark') === 'true');

    themeSelect.addEventListener('change', e => {
      const opt = themeSelect.selectedOptions[0];
      this.theme = opt.value;
      localStorage.setItem('theme', this.theme);

      const dark = opt.parentElement.dataset.type === 'dark';
      localStorage.setItem('dark', dark);
      this.addTheme(dark);
      document.querySelectorAll('iframe').forEach(i => i.contentDocument.body.classList.toggle('dark', dark));
    });

    // --- color picker
    this.inputColor = document.querySelector('.script input[type="color"]');
    this.inputColor.addEventListener('change', e => this.changeColor(e));

    // --- sidebar
    this.sidebar = document.querySelector('#sidebar');


    // --- script storage changes
    browser.storage.onChanged.addListener((changes, area) => { // Change Listener
      area === 'local' && Object.keys(changes).forEach(item => { // local only, not for sync
        pref[item] = changes[item].newValue;                // update pref with the saved version
        if (!item.startsWith('_')) { return; }              // skip

        const {oldValue, newValue} = changes[item];
        const id = item;

        // enabled/disabled
        if (oldValue && newValue && newValue.enabled !== oldValue.enabled) {
          const li = document.getElementById(id);
          li && li.classList.toggle('disabled', !newValue.enabled);
          if (id === this.box.id) {
            this.legend.classList.toggle('disabled', !newValue.enabled);
            this.enable.checked = newValue.enabled;
          }
        }

        // check script storage
        if (newValue?.storage !== oldValue?.storage && id === this.box.id) {
          this.storage.value = Object.keys(pref[id].storage).length ? JSON.stringify(pref[id].storage, null, 2) : '';
        }
      });
    });

    Script.process();
  }

  static processButtons(e) {
    const action = e.target.dataset.i18n;
    switch (action) {
      case 'saveScript': return this.saveScript();
      case 'update': return this.updateScript();
      case 'delete|title': return this.deleteScript();
      // case 'newJS':
      case 'newJS|title': return this.newScript('js');
      // case 'newCSS':
      case 'newCSS|title': return this.newScript('css');
      case 'beautify|title': return this.beautify();
      case 'saveTemplate': return this.saveTemplate();
      case 'export': return this.exportScript();
      case 'exportAll': return this.exportScriptAll();

      case 'tabToSpaces':
      case 'toLowerCase':
      case 'toUpperCase':
      case 'wrapIIFE':
        return this.edit(action);
    }
  }

  static process() {
    this.navUL.textContent = '';                            // clear data

    App.getIds(pref).sort(Intl.Collator().compare).forEach(item => this.addScript(pref[item]));
    this.navUL.appendChild(this.docFrag);

    if (this.box.id) {                                      // refresh previously loaded content
      this.box.value = '';
      document.getElementById(this.box.id).click();
    }
  }

  static addTheme(dark) {
    const url = `../lib/codemirror/theme/${this.theme}.css`;
    if (this.theme === 'default' || document.querySelector(`link[href="${url}"]`)) { // already added
      document.body.classList.toggle('dark', dark);
      this.cm?.setOption('theme', this.theme);
      return;
    }

    const link = this.defaultLink.cloneNode();
    link.href = url;
    document.head.appendChild(link);
    link.onload = () => {
      link.onload = null;
      document.body.classList.toggle('dark', dark);
      this.cm?.setOption('theme', this.theme);
    };
  }

  static setCodeMirror() {
    const js = this.legend.classList.contains('js');
    const jshint = {
        browser: true,
        curly: true,
        devel: true,
        eqeqeq: true,
        esversion: 11,
        expr: true,
        // forin: true,
        freeze: true,
        globals: {
          GM: false,
          GM_getValue: false, GM_setValue: false, GM_deleteValue: false, GM_listValues: false,
          GM_getValues: false, GM_setValues: false, GM_deleteValues: false,
          GM_addValueChangeListener: false, GM_removeValueChangeListener: false,

          GM_addElement: false, GM_addScript: false, GM_addStyle: false, GM_download: false,
          GM_getResourceText: false, GM_getResourceURL: false, GM_info: false,
          GM_log: false, GM_notification: false, GM_openInTab: false, GM_popup: false,
          GM_registerMenuCommand: false, GM_unregisterMenuCommand: false, GM_setClipboard: false,
          GM_fetch: false, GM_xmlhttpRequest: false, unsafeWindow: false,
          exportFunction: false, cloneInto: false
        },
        jquery: js && !!this.box.id && pref[this.box.id]?.require.some(item => /\bjquery\b/i.test(item)),
        latedef: 'nofunc',
        leanswitch: true,
        maxerr: 100,
        noarg: true,
        nonbsp: true,
        undef: true,
        unused: true,
        validthis: true,
        varstmt: true,
        highlightLines: true                                // CodeMirror 5.62.0
      };

    const options = {
      lineNumbers: true,
      theme: this.theme,
      mode: js ? 'javascript' : 'css',
      tabSize: 2,
      matchBrackets: true,
      continueComments: 'Enter',
      showTrailingSpace: true,
      styleActiveLine: true,
      autoCloseBrackets: true,
      search: {bottom: true},
      lint: js ? jshint : {highlightLines: true},           // CodeMirror 5.62.0
      // hint: {hintOptions: {}},
      // rulers: [{ color: '#f50', column: 20, lineStyle: 'solid' }], // v2.68
      foldGutter: true,
      gutters: ['CodeMirror-lint-markers', 'CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
      highlightSelectionMatches: {wordsOnly: true, annotateScrollbar: true},
      extraKeys: {
        // conflict with 'toggleComment'
        // "Ctrl-Q": function(cm){ cm.foldCode(cm.getCursor()); }
        // 'Ctrl-Q': (cm)=> cm.foldCode(cm.getCursor()),
        // 'Ctrl-Q': 'toggleComment', // conflict with Firefox Quit
        'Ctrl-/': 'toggleComment',
        'Ctrl-Space': 'autocomplete',
        'Alt-F': 'findPersistent',
        F11: cm => {
          cm.setOption('fullScreen', !cm.getOption('fullScreen'));
          this.sidebar.checked = !cm.getOption('fullScreen');
        },
        Esc: cm => {
          cm.getOption('fullScreen') && cm.setOption('fullScreen', false);
          this.sidebar.checked = true;
        }
      }
    };

    // Custom CodeMirror Options
    const cmOptions = App.JSONparse(pref.cmOptions) || {};
    Object.keys(cmOptions).forEach(item => !['jshint', 'extraKeys'].includes(item) && (options[item] = cmOptions[item]));
    cmOptions.jshint && Object.keys(cmOptions.jshint).forEach(item => jshint[item] = cmOptions.jshint[item]);
    cmOptions.extraKeys && Object.keys(cmOptions.extraKeys).forEach(item => options.extraKeys[item] = cmOptions.extraKeys[item]);
    // use Tab instead of spaces
    if (cmOptions.indentWithTabs) {
      delete cmOptions.extraKeys.Tab;
      delete cmOptions.extraKeys['Shift-Tab'];
    }

    this.cm = CodeMirror.fromTextArea(this.box, options);
    CodeMirror.commands.save = () => this.saveScript();

    // --- stats
    this.makeStats();

    // converter + color picker
    this.cm.on('mousedown', (cm, e) => {
      const node = e.explicitOriginalTarget;
      if (node.nodeName === '#text') { return; }
      e.stopPropagation();
      node.classList.contains('cm-fm-color') && this.colorPicker(node);
    });
  }

  static colorPicker(node) {
    const fmColor = node.style.getPropertyValue('--fm-color');
    const clr = Color.convertToHex(fmColor);
    this.inputColor.dataset.fmColor = fmColor;
    this.inputColor.value = clr;
    this.inputColor.click();
  }

  static changeColor(e) {
    const fmColor = e.target.dataset.fmColor;
    const clr = Color.convertToFmColor(e.target.value, fmColor);

    const {line, ch} = this.cm.getCursor();
    this.cm.replaceRange(clr, {line, ch}, {line, ch: ch + fmColor.length});
  }

  static makeStats(text = this.box.value) {
    const nf = new Intl.NumberFormat();
    const stats = [];

    stats.push('Size ' + nf.format((text.length/1024).toFixed(1)) + ' KB');
    stats.push('Lines ' + nf.format(this.cm.lineCount()));
    // stats.push(/\r\n/.test(text) ? 'DOS' : 'UNIX');

    const storage = this.storage.value.trim().length;
    storage && stats.push('Storage ' + nf.format((storage/1024).toFixed(1)) + ' KB');

    const tab = text.match(/\t/g);
    tab && stats.push('Tabs ' + nf.format(tab.length));

    const tr = text.match(/[ ]+((?=\r?\n))/g);
    tr && stats.push('Trailing Spaces ' + nf.format(tr.length));

    this.footer.textContent = stats.join(' 🔹 ');
  }

  static edit(action) {
    if (!this.cm) { return; }

    let text;
    switch (action) {
      case 'tabToSpaces':
        text = this.cm.getValue().replace(/\t/g, '  ');
        this.cm.setValue(text);
        this.makeStats(text);
        break;

      case 'toLowerCase':
        this.cm.replaceSelection(this.cm.getSelection().toLowerCase());
        break;

      case 'toUpperCase':
        this.cm.replaceSelection(this.cm.getSelection().toUpperCase());
        break;

      case 'wrapIIFE':
        if (!this.legend.classList.contains('js')) { return; } // only for JS
        text = ['(() => { ', this.cm.getValue(), '\n\n})();'].join('');
        this.cm.setValue(text);
        this.makeStats(text);
        break;
    }
  }

  static beautify() {
    if (!this.cm) { return; }

    const options = {
      indent_size: this.cm.getOption('tabSize')
    };

    let text = this.cm.getValue();
    text = this.legend.classList.contains('js') ? js_beautify(text, options) : css_beautify(text, options);
    this.cm.setValue(text);
    this.makeStats(text);
  }

  static newScript(type) {
    const {box, legend} = this;
    this.enable.checked = true;
    document.querySelector('aside li.on')?.classList.remove('on');

    this.cm?.save();                                        // save CodeMirror to textarea
    if(this.unsavedChanges()) { return; }
    this.cm?.toTextArea();                                  // reset CodeMirror

    box.id = '';
    legend.textContent = '';
    legend.className = type;
    legend.textContent = browser.i18n.getMessage(type === 'js' ? 'newJS' : 'newCSS');
    this.userMeta.value = '';
    this.storage.value = '';

    const text = pref.template[type] || this.template[type];
    box.value = text;

    // --- CodeMirror
    this.setCodeMirror();
  }

  static saveTemplate() {
    this.cm?.save();                                        // save CodeMirror to textarea
    const text = this.box.value;
    const metaData = text.match(Meta.regEx);
    if (!metaData) {
      App.notify(browser.i18n.getMessage('metaError'));
      return;
    }

    const type = metaData[1].toLowerCase() === 'userscript' ? 'js' : 'css';
    pref.template[type] = text.trimStart();
    browser.storage.local.set({template: pref.template});   // update saved pref
  }

  static addScript(item) {
    const li = this.liTemplate.cloneNode(true);
    li.classList.add(item.js ? 'js' : 'css');
    item.enabled || li.classList.add('disabled');
    item.error && li.classList.add('error');
    li.textContent = item.name;
    li.id = `_${item.name}`;
    this.docFrag.appendChild(li);
    li.addEventListener('click', e => this.showScript(e));
  }

  static showScript(e) {
    const {box} = this;
    const li = e.target;
    li.classList.add('on');

    // --- multi-select
    if (e.ctrlKey) { return; }                              // Ctrl multi-select
    else if (e.shiftKey) {                                  // Shift multi-select
      if (!box.id) { return; }
      window.getSelection().removeAllRanges();
      let st = false, end = false;
      document.querySelectorAll('aside li').forEach(item => {
        const stEnd = item === li || item.id === box.id;
        if (!st && stEnd) { st = true; }
        else if (st && stEnd) { end = true; }
        !stEnd && item.classList.toggle('on', st && !end);
        // remove hidden items
        item.classList.contains('on') && window.getComputedStyle(item).display === 'none' && item.classList.toggle('on', false);
      });
      return;
    }

    // --- reset others
    document.querySelectorAll('aside li.on').forEach(item => item !== li && item.classList.remove('on'));

    // --- if showing another page
    document.getElementById('nav4').checked = true;
    this.cm?.save();                                        // save CodeMirror to textarea
    if(this.unsavedChanges()) {
      li.classList.remove('on');
      box.id && document.getElementById(box.id)?.classList.add('on');
      return;
    }
    this.cm?.toTextArea();                                  // reset CodeMirror

    const id = li.id;
    box.id = id;
    this.legend.textContent = pref[id].name;
    this.legend.className = li.classList.contains('js') ? 'js' : 'css';
    pref[id].enabled || this.legend.classList.add('disabled');

    // --- i18n
    const lang = navigator.language;
    const i18nName = pref[id].i18n.name[lang] || pref[id].i18n.name[lang.substring(0, 2)]; // fallback to primary language
    if (i18nName !== pref[id].name) {                       // i18n if different
      const sp = document.createElement('span');
      sp.textContent = i18nName;
      this.legend.appendChild(sp);
    }

    this.enable.checked = pref[id].enabled;
    this.autoUpdate.checked = pref[id].autoUpdate;
    box.value = pref[id].js || pref[id].css;
    pref[id].error && App.notify(pref[id].error, id);
    pref[id].antifeatures[0] && this.legend.classList.add('antifeature');
    this.userMeta.value = pref[id].userMeta || '';

    this.storage.parentElement.style.display = pref[id].js ? 'list-item' : 'none';
    this.storage.value = Object.keys(pref[id].storage).length ? JSON.stringify(pref[id].storage, null, 2) : '';

    // --- userVar
    this.showUserVar(id);

    // --- CodeMirror
    this.setCodeMirror();
  }

  static showUserVar(id) {
    this.userVar.textContent = '';                          // reset
    delete this.userVar.dataset.reset;
    const tmp = this.liTemplate.cloneNode();
    tmp.append(document.createElement('label'), document.createElement('input'));
    const sel = document.createElement('select');
    const output = document.createElement('output');

    Object.entries(pref[id].userVar || {}).forEach(([key, value]) => {
      if (!value.hasOwnProperty('user')) { return; }        // skip
      const li = tmp.cloneNode(true);
      const elem = li.children;
      switch (value.type) {
        case 'text':
          elem[0].textContent = value.label;
          elem[1].dataset.id = key;
          elem[1].type = value.type;
          elem[1].value = value.user;
          elem[1].dataset.default = value.value;
          break;

        case 'color':
          const clr = Color.prepareColor(elem[1], value.user);
          elem[0].textContent = value.label;
          elem[1].dataset.id = key;
          elem[1].type = value.type;
          elem[1].value = clr;
          elem[1].dataset.default = value.value;
          break;

        case 'checkbox':
          elem[0].textContent = value.label;
          elem[1].dataset.id = key;
          elem[1].type = value.type;
          elem[1].checked = Boolean(value.user);
          elem[1].dataset.default = value.value;
          break;

        case 'number':
          elem[0].textContent = value.label;
          elem[1].dataset.id = key;
          elem[1].type = value.type;
          elem[1].value = value.user;
          value.value[1] !== null && (elem[1].min = value.value[1]);
          value.value[2] !== null && (elem[1].max = value.value[2]);
          elem[1].step = value.value[3];
          elem[1].dataset.default = value.value[0];
          break;

        case 'range':
          li.appendChild(output.cloneNode());
          elem[0].textContent = value.label;
          elem[1].dataset.id = key;
          elem[1].type = value.type;
          elem[1].value = value.user;
          value.value[1] !== null && (elem[1].min = value.value[1]);
          value.value[2] !== null && (elem[1].max = value.value[2]);
          elem[1].step = value.value[3];
          elem[1].dataset.default = value.value[0];
          elem[1].addEventListener('input',
            e => elem[2].textContent = e.target.value + (value.value[4] || ''));
          elem[2].textContent = value.user + (value.value[4] || '');
          break;

        case 'select':
        case 'dropdown':
        case 'image':
          elem[1].remove();
          li.appendChild(sel.cloneNode());
          elem[0].textContent = value.label;
          elem[1].dataset.id = key;
          // add option
          Array.isArray(value.value) ?
            value.value.forEach(item => elem[1].appendChild(new Option(item.replace(/\*$/, ''), item))) :
             Object.entries(value.value).forEach(([k, v]) => elem[1].appendChild(new Option(k.replace(/\*$/, ''), v)));
          elem[1].value = value.user;

          elem[1].dataset.default =
            Array.isArray(value.value) ? value.value.find(item => item.endsWith('*')) || value.value[0] :
              value.value[Object.keys(value.value).find(item => item.endsWith('*')) || Object.keys(value.value)[0]];
          break;
      }
      this.docFrag.appendChild(li);
    });
    this.userVar.appendChild(this.docFrag);
  }

  static resetUserVar() {
    if(!this.userVar.children[0]) { return; }

    this.userVar.dataset.default = 'true';
    this.userVar.querySelectorAll('input, select').forEach(item => {
      let val = item.type === 'checkbox' ? item.checked + '' : item.value;
      if (val !== item.dataset.default) {
        switch (item.type) {
          case 'checkbox':
            item.checked = item.dataset.default === '1';
            break;

          case 'range':
            item.value = item.dataset.default;
            item.dispatchEvent(new Event('input'));
            break;

          default:
            item.value = item.dataset.default;
        }
        item.parentElement.classList.add('default');
      }
    });
  }

  static noSpace(str) {
    return str.replace(/\s+/g, '');
  }

  static unsavedChanges() {
    const {box} = this;
    const text = this.noSpace(this.box.value);
    switch (true) {
      case !text:
      case !box.id && text === this.noSpace(pref.template.js || this.template.js):
      case !box.id && text === this.noSpace(pref.template.css || this.template.css):
      case  box.id && text === this.noSpace(pref[box.id].js + pref[box.id].css) &&
                this.userMeta.value.trim() === (pref[box.id].userMeta || ''):
        return false;

      default:
        return !confirm(browser.i18n.getMessage('discardConfirm'));
    }
  }

  static toggleEnable() {
    const enabled = this.enable.checked;

    const multi = document.querySelectorAll('aside li.on');
    if (!multi[0]) { return; }

    this.box.id && this.legend.classList.toggle('disabled', !enabled);

    const obj = {};
    multi.forEach(item => {
      pref[item.id].enabled = enabled;
      item.classList.toggle('disabled', !enabled);
      obj[item.id] = pref[item.id];
    });

    browser.storage.local.set(obj);                         // update saved pref
  }

  static toggleAutoUpdate() {
    const id = this.box.id;
    if (!id) { return; }

    if (pref[id].updateURL && pref[id].version) {
      pref[id].autoUpdate = this.autoUpdate.checked;
    }
    else {
      App.notify(browser.i18n.getMessage('updateUrlError'));
      this.autoUpdate.checked = false;
      return;
    }

    browser.storage.local.set({[id]: pref[id]});            // update saved pref
  }

  static deleteScript() {
    const {box} = this;
    const multi = document.querySelectorAll('aside li.on');
    if (!multi[0]) { return; }

    if (multi.length > 1 ? !confirm(browser.i18n.getMessage('deleteMultiConfirm', multi.length)) :
        !confirm(browser.i18n.getMessage('deleteConfirm', box.id.substring(1)))) { return; }

    const deleted = [];
    multi.forEach(item => {
      const id = item.id;
      item.remove();                                        // remove from menu list
      delete pref[id];
      deleted.push(id);
      App.log(id.substring(1), 'Deleted');
    });

    browser.storage.local.remove(deleted);                  // delete script

    // --- reset box
    if (this.cm) {                                          // reset CodeMirror
      this.cm.setValue('');
      this.cm.toTextArea();
    }
    this.legend.className = '';
    this.legend.textContent = browser.i18n.getMessage('script');
    box.id = '';
    box.value = '';
  }

  static async saveScript() {
    const {box} = this;
    this.cm?.save();                                        // save CodeMirror to textarea

    // --- Trim Trailing Spaces
    const regex = /[ ]+(?=\r?\n)/g;
    this.userMeta.value = this.userMeta.value.trim().replace(regex, '');
    box.value = box.value.trim().replace(regex, '');
    // this.cm.setValue(box.value); //resets the cursor to the top :(
    this.makeStats();

    // --- check metadata
    const data = Meta.get(box.value, pref);
    if (!data) { throw 'Meta Data Error'; }
    else if (data.error) {
      App.notify(browser.i18n.getMessage('metaError'));
      return;
    }

    // --- check if patterns are valid match pattern
    let matchError = 0;
    for (const item of [...data.matches, ...data.excludeMatches]) { // use for loop to break early
      const error = Pattern.hasError(item);
      if (error) {
        matchError++;
        if (matchError > 3) { return; }                     // max 3 notifications
        App.notify(item + '\n' + error);
      }
    }
    if (matchError) { return; }

    // --- check name
    if (!data.name) {
      App.notify(browser.i18n.getMessage('noNameError'));
      return;
    }

    // --- check matches
    if (!data.matches[0] && !data.includes[0] && !data.includeGlobs[0] && !data.style[0]) {
      data.enabled = false;                                 // allow no matches but disable
    }

    const id = `_${data.name}`;                             // set id as _name

    if (!box.id) {                                          // new script
      this.addScript(data);
      const index = [...this.navUL.children].findIndex(item => Intl.Collator().compare(item.id, id) > 0);
      index !== -1 ? this.navUL.insertBefore(this.docFrag, this.navUL.children[index]) : this.navUL.appendChild(this.docFrag);
      this.navUL.children[index !== -1 ? index : 0].classList.toggle('on', true);
    }
    else {                                                  // existing script
      // --- check type conversion UserStyle to UserCSS & vice versa
      if (pref[box.id].style[0]) {
        pref[box.id].enabled = false;                       // disable old one to force unregister old one
        await browser.storage.local.set({[box.id]: pref[box.id]}); // update saved pref
      }

      // --- check name change
      if (id !== box.id) {
        if (pref[id] && !confirm(browser.i18n.getMessage('nameError'))) { return; }

        pref[id] = pref[box.id];                            // copy to new id
        delete pref[box.id];                                // delete old id
        browser.storage.local.remove(box.id);               // remove old data
      }

      // --- copy storage to data
      data.storage = pref[id].storage;

      // --- check for Web Install, set install URL
      if (!data.updateURL && pref[id].updateURL) {
        data.updateURL = pref[id].updateURL;
        data.autoUpdate = true;
      }

      // --- update menu list
      const li = document.querySelector('aside li.on');
      li.classList.remove('error');                         // reset error
      li.textContent = data.name;
      li.id = id;
    }

    // --- check storage, JS only
    if (data.js) {
      if (!this.storage.value.trim()) {
        data.storage = {};                                  // clear storage
      }
      else {
        let storage = App.JSONparse(this.storage.value);
        Array.isArray(storage) && (storage = null);         // must be an Object, not an array
        storage ? data.storage = storage : App.notify(browser.i18n.getMessage('storageError'));
      }
    }

    // --- update box & legend
    box.id = id;
    this.legend.textContent = data.name;

    pref[id] = data;                                        // save to pref
    browser.storage.local.set({[id]: pref[id]});            // update saved pref

    // --- userVar
    this.showUserVar(id);

    // --- progress bar
    ProgressBar.show();
  }

  // --- Remote Update
  static updateScript() {                                   // manual update, also for disabled and disabled autoUpdate
    const {box} = this;
    if (!box.id) { return; }

    const id = box.id;

    if (!pref[id].updateURL || !pref[id].version) {
      App.notify(browser.i18n.getMessage('updateUrlError'));
      return;
    }

    RemoteUpdate.getUpdate(pref[id], true);                 // to class RemoteUpdate in app.js
  }

  static processResponse(text, name, updateURL) {           // from class RemoteUpdate in app.js
    const data = Meta.get(text, pref);
    if (!data) { throw `${name}: Update Meta Data error`; }

    const id = `_${data.name}`;                             // set id as _name
    const oldId = `_${name}`;

    // --- check version
    if (!RemoteUpdate.higherVersion(data.version, pref[id].version)) {
      App.notify(browser.i18n.getMessage('noNewUpdate'), name);
      return;
    }

    // --- log message to display in Options -> Log
    App.log(data.name, `Updated version ${pref[id].version} ➜ ${data.version}`, '', updateURL);

    // --- check name change
    if (data.name !== name) {                               // name has changed
      if (pref[id]) { throw `${name}: Update new name already exists`; } // name already exists
      else {
        pref[id] = pref[oldId];                             // copy to new id
        delete pref[oldId];                                 // delete old id
        browser.storage.local.remove(oldId);                // remove old data
      }
    }

    App.notify(browser.i18n.getMessage('scriptUpdated', data.version), name);
    pref[id] = data;                                        // save to pref
    browser.storage.local.set({[id]: pref[id]});            // update saved pref



    this.cm.setValue('');                                   // clear box avoid unsavedChanges warning
    this.process();                                         // update page display
  }

  // ---------- Import Script ------------------------------
  static processFileSelect(e) {
    // --- check for Stylus import
    if (e.target.files[0].type === 'application/json') {
      this.processFileSelectStylus(e);
      return;
    }

    this.fileLength = e.target.files.length;
    this.obj = {};

    [...e.target.files].forEach(file => {
      switch (true) {
        //case !file: App.notify(browser.i18n.getMessage('error')); return;
        case !['text/css', 'application/x-javascript'].includes(file.type): // check file MIME type CSS/JS
          App.notify(browser.i18n.getMessage('fileTypeError'));
          return;
      }

      ImportExport.fileReader(file, r => Script.readDataScript(r));
    });
  }

  static readDataScript(text) {
    // --- check meta data
    const data = Meta.get(text, pref);
    if (!data) { throw 'Meta Data Error'; }
    else if (data.error) {
      App.notify(browser.i18n.getMessage('metaError'));
      return;
    }

    let id = `_${data.name}`;                               // set id as _name

    // --- check name
    if (pref[id]) {
      const dataType = data.js ? 'js' : 'css';
      const targetType = pref[id].js ? 'js' : 'css';
      if (dataType !== targetType) { // same name exist in another type
        data.name += ` (${dataType})`;
        id = `_${data.name}`;
        if (pref[id]) { throw `${data.name}: Update new name already exists`; } // name already exists
      }
    }

    // --- log message to display in Options -> Log
    const message = pref[id] ? `Updated version ${pref[id].version} ➜ ${data.version}` : `Installed version ${data.version}`
    App.log(data.name, message, '', data.updateURL);

    pref[id] = data;                                        // save to pref
    this.obj[id] = pref[id];

    // --- update storage after all files are processed
    this.fileLength--;                                      // one less file to process
    if(this.fileLength) { return; }                         // not 0 yet

    this.process();                                         // update page display
    browser.storage.local.set(this.obj);                    // update saved pref
  }
  // ---------- /Import Script -----------------------------

  // ---------- Import Stylus ------------------------------
  static processFileSelectStylus(e) {
    const file = e.target.files[0];
    ImportExport.fileReader(file, r => Script.prepareStylus(r));
  }

  static prepareStylus(data) {
    const importData = App.JSONparse(data);
    if (!importData) {
      App.notify(browser.i18n.getMessage('fileParseError')); // display the error
      return;
    }

    const obj = {};
    importData.forEach(item => {
      // --- test validity
      if (!item.name || !item.id || !item.sections) {
        App.notify(browser.i18n.getMessage('error'));
        return;
      }

      const updateUrl = item.updateUrl || '';               // new Stylus "updateUrl": null, | old Stylus "updateUrl": "",

      // rebuild UserStyle
      let text =
`/*
==UserStyle==
@name           ${item.name}
@updateURL      ${updateUrl}
@run-at         document-start
==/UserStyle==
*/`;

      item.sections.forEach(sec => {
        const r = [];
        sec.urls?.forEach(i => r.push(`url('${i}')`));
        sec.urlPrefixes?.forEach(i => r.push(`url-prefix('${i}')`));
        sec.domains?.forEach(i => r.push(`domain('${i}')`));
        sec.regexps?.forEach(i => r.push(`regexp('${i}')`));

        r[0] && (text += '\n\n@-moz-document ' + r.join(', ') +' {\n  ' + sec.code + '\n}');
      });

      const data = Meta.get(text, pref);
      data.enabled = item.enabled;
      if (pref[`_${data.name}`]) { data.name += ' (Stylus)'; }
      const id = `_${data.name}`;                           // set id as _name
      pref[id] = data;                                      // save to pref
      obj[id] = pref[id];
    });

    browser.storage.local.set(obj);                         // update saved pref
    this.process();                                         // update page display
  }
  // ---------- /Import Stylus -----------------------------

  // ---------- Export -------------------------------------
  static exportScript() {
    if (!this.box.id) { return; }

    const id = this.box.id;
    const ext = pref[id].js ? '.js' : '.css';
    const data = pref[id].js || pref[id].css;
    this.export(data, ext, pref[id].name);
  }

  static exportScriptAll() {
    if (App.android) { return; }                            // disable on Android

    const multi = document.querySelectorAll('aside li.on');
    const target = multi.length > 1 ? [...multi].map(i => i.id) : App.getIds(pref);
    target.forEach(id => {
      const ext = pref[id].js ? '.js' : '.css';
      const data = pref[id].js || pref[id].css;
      this.export(data, ext, pref[id].name, 'FireMonkey_' + new Date().toISOString().substring(0, 10) + '/', false);
    });
  }

  static export(data, ext, name, folder = '', saveAs = true) {
    navigator.userAgent.includes('Windows') && (data = data.replace(/\r?\n/g, '\r\n'));
    const filename = folder + name.replace(/[<>:"/\\|?*]/g, '') + '.user' + ext; // removing disallowed characters
    ImportExport.saveFile({data, filename, saveAs});
  }
}
// ---------- /Scripts -------------------------------------

// ---------- Import/Export Preferences --------------------
ImportExport.init(pref, () => {
  Options.process();                                        // set options after the pref update
  Script.process();                                         // update page display
});
// ---------- /Import/Export Preferences -------------------

// ---------- Navigation -----------------------------------
Nav.process(Script);