import {pref, App, Meta, RemoteUpdate} from './app.js';
const RU = new RemoteUpdate();

// ----------------- Internationalization ------------------
App.i18n();

// ----------------- User Preference -----------------------
App.getPref().then(() => {
  options.process();
  script.process();

  // --- add custom style
  pref.customCSS && (document.querySelector('style').textContent = pref.customCSS);
});
// ----------------- /User Preference ----------------------

// ----------------- Options -------------------------------
class Options {

  constructor(keys = Object.keys(pref)) {
    this.prefNode = document.querySelectorAll('#' + keys.join(',#')); // defaults to pref keys
    document.querySelector('button[type="submit"]').addEventListener('click', () => this.check()); // submit button
    this.pBar = document.querySelector('.progressBar');

    this.globalScriptExcludeMatches = document.querySelector('#globalScriptExcludeMatches');

    // --- from browser pop-up & contextmenu (not in Private Window)
    window.addEventListener('storage', (e) => {
      if (e.key === 'nav') { this.getNav(e.newValue); }
      else if (e.key === 'log') { showLog.update(e.newValue); }
    });
  }

  process(save) {
    // 'save' is only set when clicking the button to save options
    this.prefNode.forEach(node => {
      // value: 'select-one', 'textarea', 'text', 'number'
      const attr = node.type === 'checkbox' ? 'checked' : 'value';
      save ? pref[node.id] = node[attr] : node[attr] = pref[node.id];
    });

    save && this.progressBar();                             // progress bar
    save && browser.storage.local.set(pref);                // update saved pref
  }

  progressBar() {
    this.pBar.classList.toggle('on');
    setTimeout(() => this.pBar.classList.toggle('on'), 2000);
  }

  check() {
    // --- check Global Script Exclude Matches
    if(!Pattern.validate(this.globalScriptExcludeMatches)) { return; }

    // Custom CodeMirror Options
    const cmOptionsNode = document.querySelector('#cmOptions');
    cmOptionsNode.value = cmOptionsNode.value.trim();
    if (cmOptionsNode.value) {
      let cmOptions = App.JSONparse(cmOptionsNode.value);
      if (!cmOptions) {
        App.notify(browser.i18n.getMessage('cmOptionsError')) ;
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

  getNav(nav) {
    nav = nav || localStorage.getItem('nav');
    localStorage.removeItem('nav');
    if (!nav) { return; }                                   // end execution if not found

    switch (nav) {
      case 'help':
        document.getElementById('nav1').checked = true;
        break;

      case 'log':
        document.getElementById('nav5').checked = true;
        break;

      case 'js':
      case 'css':
        document.getElementById('nav4').checked = true;
        script.newScript(nav);
        break;

      default:
        document.getElementById(nav).click();
    }
  }
}
const options = new Options(['autoUpdateInterval', 'globalScriptExcludeMatches', 'sync', 'counter', 'customCSS', 'cmOptions']);
// ----------------- /Options ------------------------------

// ----------------- Scripts -------------------------------
class Script {

  constructor() {
    // class RemoteUpdate in app.js
    RU.callback = this.processResponse.bind(this);

    this.docfrag = document.createDocumentFragment();
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

    this.userMeta = document.querySelector('#userMeta');
    this.userMeta.value = '';
    Meta.userMeta = this.userMeta;

    document.querySelectorAll('.script button, .script li.button, aside button').forEach(item =>
      item.addEventListener('click', e => this.processButtons(e)));

    window.addEventListener('beforeunload', () => {
      this.unsavedChanges() ? event.preventDefault() : this.box.value = '';
    });


    this.template = {
      js:
`// ==UserScript==
// @name
// @match
// @version          1.0
// ==/UserScript==`,

      css:
`/*
==UserCSS==
@name
@match
@version          1.0
==/UserCSS==
*/`
};

    // --- Import/Export Script
    document.getElementById('fileScript').addEventListener('change', e => this.processFileSelect(e));

    // --- menu dropdown
    const menuDetails = document.querySelectorAll('.menu details');
    document.body.addEventListener('click', e =>
      menuDetails.forEach(item => !item.contains(e.explicitOriginalTarget) && (item.open = false))
    );

    // --- textarea resize
    const divUser = document.querySelector('.menu details div.user');
    divUser.parentNode.addEventListener('toggle', e => !e.target.open && divUser.classList.remove('expand'));
    divUser.querySelectorAll('textarea').forEach(item => {
      item.addEventListener('focus', () => divUser.classList.toggle('expand', true));
    });

    // --- CodeMirror & Theme
    this.cm;
    this.footer = document.querySelector('footer');

    const themeSelect = document.querySelector('#theme');
    this.theme = localStorage.getItem('theme') ||
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'darcula' : 'defualt');
    themeSelect.value = this.theme;
    if (themeSelect.selectedIndex === -1) {                 // bad value correction
      this.theme = 'default';
      themeSelect.value = this.theme;
    }

    this.defaultLink = document.querySelector('link[href="../lib/codemirror/codemirror.css"]');
    this.addTheme(localStorage.getItem('dark') === 'true');

    themeSelect.addEventListener('change', (e) => {
      const opt = themeSelect.selectedOptions[0];
      this.theme = opt.value;
      localStorage.setItem('theme', this.theme);

      const dark = opt.parentNode.dataset.type === 'dark';
      localStorage.setItem('dark', dark);
      this.addTheme(dark);
    });

    // --- color picker
    this.inputColor = document.querySelector('.script input[type="color"]');
    this.inputColor.addEventListener('change', (e) => this.changeColor());

    // --- script storage changes
    browser.storage.onChanged.addListener((changes, area) => { // Change Listener
      area === 'local' && Object.keys(changes).forEach(item => { // local only, not for sync
        pref[item] = changes[item].newValue;                // update pref with the saved version
        if (!item.startsWith('_')) { return; }              // skip

        const {oldValue, newValue} = changes[item];
        if (oldValue && newValue && newValue.enabled !== oldValue.enabled) { // if enabled/disabled
          const id = item;
          const li = document.getElementById(id);
          li && li.classList.toggle('disabled', !newValue.enabled);
          if (id === this.box.id) {
            this.legend.classList.toggle('disabled', !newValue.enabled);
            this.enable.checked = newValue.enabled;
          }
        }
      });
    });
  }

  addTheme(dark) {
    const url =  `../lib/codemirror/theme/${this.theme}.css`;
    if (this.theme === 'default' || document.querySelector(`link[href="${url}"]`)) { // already added
      document.body.classList.toggle('dark', dark);
      this.cm && this.cm.setOption('theme', this.theme);
      return;
    }

    const link = this.defaultLink.cloneNode();
    link.href = url;
    this.defaultLink.after(link);
    link.onload = () => {
      link.onload = null;
      document.body.classList.toggle('dark', dark);
      this.cm && this.cm.setOption('theme', this.theme);
    };
  }

  setCodeMirror() {
    const js =  this.legend.classList.contains('js');
    const jshint = {
        browser: true,
        curly: true,
        devel: true,
        eqeqeq: true,
        esversion: 11,
        expr: true,
       /* forin: true,*/
        freeze: true,
        globals: {
          GM: false, GM_addScript: false, GM_addStyle: false, GM_addValueChangeListener: false, GM_deleteValue: false,
          GM_download: false, GM_fetch: false, GM_getResourceText: false, GM_getResourceURL: false, GM_info: false,
          GM_log: false, GM_notification: false, GM_openInTab: false, GM_popup: false,
          GM_registerMenuCommand: false, GM_removeValueChangeListener: false, GM_setClipboard: false,
          GM_setValue: false, GM_unregisterMenuCommand: false, GM_xmlhttpRequest: false, unsafeWindow: false
        },
        jquery: js && !!this.box.id && (pref[this.box.id].require || []).some(item => /lib\/jquery-\d/.test(item)),
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
//      hint: {hintOptions: {}},
      foldGutter: true,
      gutters: ['CodeMirror-lint-markers', 'CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
      highlightSelectionMatches: {wordsOnly: true, annotateScrollbar: true},
      extraKeys: {
        // conflict with 'toggleComment'
//      "Ctrl-Q": function(cm){ cm.foldCode(cm.getCursor()); }
//      'Ctrl-Q': (cm)=> cm.foldCode(cm.getCursor()),

        'Ctrl-Q': 'toggleComment',
        'Ctrl-Space': 'autocomplete',
        'Alt-F': 'findPersistent',
        F11: (cm) => cm.setOption('fullScreen', !cm.getOption('fullScreen')),
        Esc: (cm) => cm.getOption('fullScreen') && cm.setOption('fullScreen', false)
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
    this.makeStats(js);

    // converter + color picker
    this.cm.on('mousedown', (cm, e) => {
      const node = e.explicitOriginalTarget;
      if (node.nodeName === '#text') { return; }
      e.stopPropagation();
      node.classList.contains('cm-fm-color') && this.colorPicker(cm, node);
    });
  }

  colorPicker(cm, node) {
    this.oldColor = node.style.getPropertyValue('--fm-color');
    let color = this.oldColor;
    switch (true) {
      case this.oldColor.startsWith('rgb'):                 // convert rgba?() -> #rrggbb
        color = this.rgbToHex(color);
        break;

      case /^#\w{3}$/.test(this.oldColor):                  // convert #rgb -> #rrggbb
        color = this.hex3to6(color);
        break;

      case !this.oldColor.startsWith('#'):                  // convert named -> #rrggbb
        color = this.namedColors(color);
        break;
    }

    this.inputColor.value = color;
    this.inputColor.click();
  }

  changeColor() {
    if (this.oldColor === this.inputColor.value) { return; }     // no change

    let color = this.inputColor.value;
    switch (true) {
      case this.oldColor.startsWith('rgb'):                 // convert #rrggbb -> rgba?()
        color = this.hexToRgb(color);
        break;

      case /^#\w{3}$/.test(this.oldColor):                  // convert #rrggbb -> #rgb
        const m = this.oldColor.match(/[\d.]+/g);
        color = this.hex6to3(color, m && m[3]);
        break;

      case !this.oldColor.startsWith('#'):
        color = this.namedColors(color, true);              // // convert #rrggbb -> named
        break;
    }

    const {line, ch} = this.cm.getCursor();
    this.cm.replaceRange(color, {line, ch}, {line, ch: ch + this.oldColor.length});
  }

  rgbToHex(color) {
    const m = color.replace(/\s+/g, '').match(/rgba?\((\d+),(\d+),(\d+)/);
    return m ? '#' + m.slice(1).map(d => (d*1).toString(16).padStart(2, 0)).join('') : color;
  }

  hexToRgb(color) {
    const m = color.substring(1).match(/.{2}/g).map(hex => parseInt(hex, 16));
    const op = this.oldColor.match(/[\d.]+/g)[3];
    op && m.push(op);
    return (op ? 'rgba(' : 'rgb(') + m.join(',') + ')';
  }

  hex3to6(color) {
    return color.split('').map(hex => hex+hex).join('').substring(1);
  }

  hex6to3(color) {
    const m = color.match(/#(.)\1(.)\2(.)\3/);
    return m ? '#' + m.slice(1).join('') : color;
  }

  namedColors(color, back) {
    const names = {
      'aliceblue': '#f0f8ff',
      'antiquewhite': '#faebd7',
      'aqua': '#00ffff',
      'aquamarine': '#7fffd4',
      'azure': '#f0ffff',
      'beige': '#f5f5dc',
      'bisque': '#ffe4c4',
      'black': '#000000',
      'blanchedalmond': '#ffebcd',
      'blue': '#0000ff',
      'blueviolet': '#8a2be2',
      'brown': '#a52a2a',
      'burlywood': '#deb887',
      'cadetblue': '#5f9ea0',
      'chartreuse': '#7fff00',
      'chocolate': '#d2691e',
      'coral': '#ff7f50',
      'cornflowerblue': '#6495ed',
      'cornsilk': '#fff8dc',
      'crimson': '#dc143c',
      'cyan': '#00ffff',
      'darkblue': '#00008b',
      'darkcyan': '#008b8b',
      'darkgoldenrod': '#b8860b',
      'darkgray': '#a9a9a9',
      'darkgrey': '#a9a9a9',
      'darkgreen': '#006400',
      'darkkhaki': '#bdb76b',
      'darkmagenta': '#8b008b',
      'darkolivegreen': '#556b2f',
      'darkorange': '#ff8c00',
      'darkorchid': '#9932cc',
      'darkred': '#8b0000',
      'darksalmon': '#e9967a',
      'darkseagreen': '#8fbc8f',
      'darkslateblue': '#483d8b',
      'darkslategray': '#2f4f4f',
      'darkslategrey': '#2f4f4f',
      'darkturquoise': '#00ced1',
      'darkviolet': '#9400d3',
      'deeppink': '#ff1493',
      'deepskyblue': '#00bfff',
      'dimgray': '#696969',
      'dimgrey': '#696969',
      'dodgerblue': '#1e90ff',
      'firebrick': '#b22222',
      'floralwhite': '#fffaf0',
      'forestgreen': '#228b22',
      'fuchsia': '#ff00ff',
      'gainsboro': '#dcdcdc',
      'ghostwhite': '#f8f8ff',
      'gold': '#ffd700',
      'goldenrod': '#daa520',
      'gray': '#808080',
      'grey': '#808080',
      'green': '#008000',
      'greenyellow': '#adff2f',
      'honeydew': '#f0fff0',
      'hotpink': '#ff69b4',
      'indianred': '#cd5c5c',
      'indigo': '#4b0082',
      'ivory': '#fffff0',
      'khaki': '#f0e68c',
      'lavender': '#e6e6fa',
      'lavenderblush': '#fff0f5',
      'lawngreen': '#7cfc00',
      'lemonchiffon': '#fffacd',
      'lightblue': '#add8e6',
      'lightcoral': '#f08080',
      'lightcyan': '#e0ffff',
      'lightgoldenrodyellow': '#fafad2',
      'lightgray': '#d3d3d3',
      'lightgrey': '#d3d3d3',
      'lightgreen': '#90ee90',
      'lightpink': '#ffb6c1',
      'lightsalmon': '#ffa07a',
      'lightseagreen': '#20b2aa',
      'lightskyblue': '#87cefa',
      'lightslategray': '#778899',
      'lightslategrey': '#778899',
      'lightsteelblue': '#b0c4de',
      'lightyellow': '#ffffe0',
      'lime': '#00ff00',
      'limegreen': '#32cd32',
      'linen': '#faf0e6',
      'magenta': '#ff00ff',
      'maroon': '#800000',
      'mediumaquamarine': '#66cdaa',
      'mediumblue': '#0000cd',
      'mediumorchid': '#ba55d3',
      'mediumpurple': '#9370db',
      'mediumseagreen': '#3cb371',
      'mediumslateblue': '#7b68ee',
      'mediumspringgreen': '#00fa9a',
      'mediumturquoise': '#48d1cc',
      'mediumvioletred': '#c71585',
      'midnightblue': '#191970',
      'mintcream': '#f5fffa',
      'mistyrose': '#ffe4e1',
      'moccasin': '#ffe4b5',
      'navajowhite': '#ffdead',
      'navy': '#000080',
      'oldlace': '#fdf5e6',
      'olive': '#808000',
      'olivedrab': '#6b8e23',
      'orange': '#ffa500',
      'orangered': '#ff4500',
      'orchid': '#da70d6',
      'palegoldenrod': '#eee8aa',
      'palegreen': '#98fb98',
      'paleturquoise': '#afeeee',
      'palevioletred': '#db7093',
      'papayawhip': '#ffefd5',
      'peachpuff': '#ffdab9',
      'peru': '#cd853f',
      'pink': '#ffc0cb',
      'plum': '#dda0dd',
      'powderblue': '#b0e0e6',
      'purple': '#800080',
      'rebeccapurple': '#663399',
      'red': '#ff0000',
      'rosybrown': '#bc8f8f',
      'royalblue': '#4169e1',
      'saddlebrown': '#8b4513',
      'salmon': '#fa8072',
      'sandybrown': '#f4a460',
      'seagreen': '#2e8b57',
      'seashell': '#fff5ee',
      'sienna': '#a0522d',
      'silver': '#c0c0c0',
      'skyblue': '#87ceeb',
      'slateblue': '#6a5acd',
      'slategray': '#708090',
      'slategrey': '#708090',
      'snow': '#fffafa',
      'springgreen': '#00ff7f',
      'steelblue': '#4682b4',
      'tan': '#d2b48c',
      'teal': '#008080',
      'thistle': '#d8bfd8',
      'tomato': '#ff6347',
      'turquoise': '#40e0d0',
      'violet': '#ee82ee',
      'wheat': '#f5deb3',
      'white': '#ffffff',
      'whitesmoke': '#f5f5f5',
      'yellow': '#ffff00',
      '#9acd32': 'yellowgreen'
    };

    if (back) { return Object.keys(names).find(item => names[item] === color) || color; }
    return names[color] || color;
  }

  makeStats(js, text = this.box.value) {
    const nf = new Intl.NumberFormat();
    const stats = [];

    stats.push('Size  ' + nf.format(parseFloat((text.length/1024).toFixed(1))) + ' KB');
    stats.push('Lines ' + nf.format(this.cm.lineCount()));
//    stats.push(/\r\n/.test(text) ? 'DOS' : 'UNIX');

    const tab = text.match(/\t/g);
    tab && stats.push('Tabs ' + nf.format(tab.length));

    const tr = text.match(/[ ]+((?=\r?\n))/g);
    tr && stats.push('Trailing Spaces ' + nf.format(tr.length));

    this.footer.textContent = stats.join(' \u{1f539} ');
  }

  processButtons(e) {
    const action = e.target.dataset.i18n;
    switch (action) {
      case 'saveScript': return this.saveScript();
      case 'update': return this.updateScript();
      case 'delete|title': return this.deleteScript();
      case 'newJS': case 'newJS|title': return this.newScript('js');
      case 'newCSS': case 'newCSS|title': return this.newScript('css');
      case 'saveTemplate': return this.saveTemplate();
      case 'export': return this.exportScript();
      case 'exportAll': return this.exportScriptAll();

      case 'tabToSpaces':
//      case 'trimTrailingSpaces':
      case 'toLowerCase':
      case 'toUpperCase':
      case 'includeToMatch':
        return this.edit(action);
    }
  }

  edit(action) {
    if (!this.cm) { return; }

    let text;
    switch (action) {
      case 'tabToSpaces':
        text = this.cm.getValue().replace(/\t/g, '  ');
        this.cm.setValue(text);
        this.makeStats(text);
        break;
/*
      case 'trimTrailingSpaces':
        text = this.cm.getValue().trimEnd().replace(/[ ]+(?=\r?\n)/g, '');
        this.cm.setValue(text);
        this.makeStats(text);
        break;
*/
      case 'toLowerCase':
        this.cm.replaceSelection(this.cm.getSelection().toLowerCase());
        break;

      case 'toUpperCase':
        this.cm.replaceSelection(this.cm.getSelection().toUpperCase());
        break;
    }
  }

  newScript(type) {
    const {box, legend} = this;
    this.enable.checked = true;

    const last = document.querySelector('aside li.on');
    last && last.classList.remove('on');

    this.cm && this.cm.save();                              // save CodeMirror to textarea
    if(this.unsavedChanges()) { return; }
    this.cm && this.cm.toTextArea();                        // reset CodeMirror

    box.id = '';
    legend.textContent = '';
    legend.className = type;
    legend.textContent = browser.i18n.getMessage(type === 'js' ? 'newJS' : 'newCSS');

    const text = pref.template[type] || this.template[type];
    box.value = text;

    // --- CodeMirror
    this.setCodeMirror();
  }

  saveTemplate() {
    this.cm && this.cm.save();                              // save CodeMirror to textarea
    const text = this.box.value;
    const metaData = text.match(Meta.regEx);

    if (!metaData) { App.notify(browser.i18n.getMessage('metaError')); return; }
    const type = metaData[1].toLowerCase() === 'userscript' ? 'js' : 'css';
    pref.template[type] = text.trimStart();
    browser.storage.local.set({template: pref.template});   // update saved pref
  }

  process() {
    this.navUL.textContent = '';                            // clear data

    App.getIds().sort(Intl.Collator().compare).forEach(item => this.addScript(pref[item]));
    this.navUL.appendChild(this.docfrag);

    if (this.box.id) {                                      // refresh previously loaded content
      this.box.textContent = '';
      document.getElementById(this.box.id).click();
    }
    options.getNav();                                       // run after scripts are loaded
  }

  addScript(item) {
    const li = this.liTemplate.cloneNode(true);
    li.classList.add(item.js ? 'js' : 'css');
    item.enabled || li.classList.add('disabled');
    item.error && li.classList.add('error');
    li.textContent = item.name;
    li.id = `_${item.name}`;
    this.docfrag.appendChild(li);
    li.addEventListener('click', e => this.showScript(e));
  }

  showScript(e) {
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
      });
      return;
    }

    // --- reset others
    document.querySelectorAll('aside li.on').forEach(item => item !== li && item.classList.remove('on'));

    // --- if showing another page
    document.getElementById('nav4').checked = true;

    this.cm && this.cm.save();                              // save CodeMirror to textarea
    if(this.unsavedChanges()) {
      li.classList.remove('on');
      document.getElementById(box.id).classList.add('on');
      return;
    }
    this.cm && this.cm.toTextArea();                        // reset CodeMirror

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
      sp.textContent =  i18nName;
      this.legend.appendChild(sp);
    }

    this.enable.checked = pref[id].enabled;
    this.autoUpdate.checked = pref[id].autoUpdate;
    box.value = pref[id].js || pref[id].css;
    pref[id].error && App.notify(pref[id].error, id);
    pref[id].antifeatures[0] && this.legend.classList.add('antifeature');
    this.userMeta.value = pref[id].userMeta || '';

    // --- CodeMirror
    this.setCodeMirror();
  }

  noSpace(str) {
    return str.replace(/\s+/g, '');
  }

  unsavedChanges() {
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

  toggleEnable() {
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

  toggleAutoUpdate() {
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

  deleteScript() {
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

  async saveScript() {
    const {box} = this;
    this.cm && this.cm.save();                              // save CodeMirror to textarea

    // Trim Trailing Spaces
    this.userMeta.value = this.userMeta.value.trim().replace(/[ ]+(?=\r?\n)/g, '');
    box.value = box.value.trim().replace(/[ ]+(?=\r?\n)/g, '');
    this.cm.setValue(box.value);

    // --- chcek metadata
    const data = Meta.get(box.value);
    if (!data) { throw 'Meta Data Error'; }
    else if (data.error) {
      App.notify(browser.i18n.getMessage('metaError'));
      return;
    }

    // --- check if patterns are valid match mattern
    let matchError = 0;
    for (const item of [...data.matches, ...data.excludeMatches]) { // use for loop to break early
      const error = Pattern.hasError(item);
      if (error) {
        matchError++;
        App.notify(item + '\n' + error);
      }
      if (matchError > 3) { return; }                       // max 3 notifications
    }
    if (matchError) { return; }


    // --- check name
    if (!data.name) {
      App.notify(browser.i18n.getMessage('noNameError'));
      return;
    }

    // --- check matches
    if (!data.matches[0] && !data.includeGlobs[0] && !data.style[0]) {
      data.enabled = false;                                 // allow no matches but disable
    }

    const id = `_${data.name}`;                             // set id as _name

    if (!box.id) {                                          // new script
      this.addScript(data);
      const index = [...this.navUL.children].findIndex(item => Intl.Collator().compare(item.id, id) > 0);
      index !== -1 ? this.navUL.insertBefore(this.docfrag, this.navUL.children[index]) : this.navUL.appendChild(this.docfrag);
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
      if (!data.updateURL && App.allowedHost(pref[id].updateURL)) {
        data.updateURL = pref[id].updateURL;
        data.autoUpdate = true;
      }

      // --- update menu list
      const li = document.querySelector('aside li.on');
      li.classList.remove('error');                         // reset error
      li.textContent = data.name;
      li.id = id;
    }

    // --- update box & legend
    box.id = id;
    this.legend.textContent = data.name;

    pref[id] = data;                                        // save to pref
    browser.storage.local.set({[id]: pref[id]});            // update saved pref

    // --- progress bar
    options.progressBar();
  }

  // --- Remote Update
  updateScript() {                                          // manual update, also for disabled and disabled autoUpdate
    const {box} = this;
    if (!box.id) { return; }

    const id = box.id;

    if (!pref[id].updateURL || !pref[id].version) {
      App.notify(browser.i18n.getMessage('updateUrlError'));
      return;
    }

    RU.getUpdate(pref[id], true);                           // to class RemoteUpdate in common.js
  }

  processResponse(text, name, updateURL) {                  // from class RemoteUpdate in common.js
    const data = Meta.get(text);
    if (!data) { throw `${name}: Update Meta Data error`; }

    const id = `_${data.name}`;                             // set id as _name
    const oldId = `_${name}`;

    // --- check version
    if (!RU.higherVersion(data.version, pref[id].version)) {
      App.notify(browser.i18n.getMessage('noNewUpdate'), name);
      return;
    }

    // ---  log message to display in Options -> Log
    App.log(data.name, `Updated version ${pref[id].version} to ${data.version}`);

    // --- check name change
    if (data.name !== name) {                               // name has changed
      if (pref[id]) { throw `${name}: Update new name already exists`; } // name already exists
      else {
        pref[id] = pref[oldId];                               // copy to new id
        delete pref[oldId];                                   // delete old id
        browser.storage.local.remove(oldId);                  // remove old data
      }
    }

    App.notify(browser.i18n.getMessage('scriptUpdated', data.version), name);
    pref[id] = data;                                        // save to pref
    browser.storage.local.set({[id]: pref[id]});            // update saved pref

    this.process();                                         // update page display
    this.box.value = '';                                    // clear box avoid unsavedChanges warning
    const on = document.getElementById(id);
    on && on.click();                                       // reload the new script
  }

  // ----------------- Import Script -----------------------
  processFileSelect(e) {
    // --- check for Stylus import
    if (e.target.files[0].type === 'application/json') {
      this.processFileSelectStylus(e);
      return;
    }

    this.fileLength = e.target.files.length;
    this.obj = {};

    [...e.target.files].forEach(file => {

      switch (true) {
        case !file: App.notify(browser.i18n.getMessage('error')); return;
        case !['text/css', 'application/x-javascript'].includes(file.type): // check file MIME type CSS/JS
          App.notify(browser.i18n.getMessage('fileTypeError'));
          return;
      }

      const reader  = new FileReader();
      reader.onloadend = () => script.readDataScript(reader.result);
      reader.onerror = () => App.notify(browser.i18n.getMessage('fileReadError'));
      reader.readAsText(file);
    });
  }

  readDataScript(text) {
    // --- chcek meta data
    const data = Meta.get(text);
    if (!data) { throw 'Meta Data Error'; }
    else if (data.error) {
      App.notify(browser.i18n.getMessage('metaError'));
      return;
    }

    let id = `_${data.name}`;                             // set id as _name

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

    pref[id] = data;                                        // save to pref
    this.obj[id] = pref[id];

    // --- update storage after all files are processed
    this.fileLength--;                                      // one less file to process
    if(this.fileLength) { return; }                         // not 0 yet

    this.process();                                         // update page display
    browser.storage.local.set(this.obj);                    // update saved pref
  }
  // ----------------- /Import Script ----------------------

  // ----------------- Import Stylus -----------------------
  processFileSelectStylus(e) {
    const file = e.target.files[0];
    const reader  = new FileReader();
    reader.onloadend = () => script.prepareStylus(reader.result);
    reader.onerror = () => App.notify(browser.i18n.getMessage('fileReadError'));
    reader.readAsText(file);
  }

  prepareStylus(data) {
    const importData = App.JSONparse(data);
    if (!importData) {
      App.notify(browser.i18n.getMessage('fileParseError'));           // display the error
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
        sec.urls && sec.urls.forEach(i => r.push(`url('${i}')`));
        sec.urlPrefixes && sec.urlPrefixes.forEach(i => r.push(`url-prefix('${i}')`));
        sec.domains && sec.domains.forEach(i => r.push(`domain('${i}')`));
        sec.regexps && sec.regexps.forEach(i => r.push(`regexp('${i}')`));

        r[0] && (text += '\n\n@-moz-document ' + r.join(', ') +' {\n  ' + sec.code + '\n}');
      });

      const data = Meta.get(text);
      data.enabled = item.enabled;
      if (pref[`_${data.name}`]) { data.name += ' (Stylus)'; }
      const id = `_${data.name}`;                           // set id as _name
      pref[id] = data;                                      // save to pref
      obj[id] = pref[id];
    });

    this.process();                                         // update page display
    browser.storage.local.set(obj);                         // update saved pref
  }
  // ----------------- /Import Stylus ----------------------

  // ----------------- Export ------------------------------
  exportScript() {
    if (!this.box.id) { return; }

    const id = this.box.id;
    const ext = pref[id].js ? '.js' : '.css';
    const data = pref[id].js || pref[id].css;
    this.export(data, ext, pref[id].name);
  }

  exportScriptAll() {
    if (this.android) { return; }                           // disable on Andriod

    const multi = document.querySelectorAll('aside li.on');
    const target = multi.length > 1 ? [...multi].map(item => item.id) : App.getIds();
    target.forEach(id => {

      const ext = pref[id].js ? '.js' : '.css';
      const data = pref[id].js || pref[id].css;
      this.export(data, ext, pref[id].name, 'FireMonkey_' + new Date().toISOString().substring(0, 10) + '/', false);
    });
  }

  export(data, ext, name, folder = '', saveAs = true) {
    navigator.userAgent.includes('Windows') && (data = data.replace(/\r?\n/g, '\r\n'));
    const blob = new Blob([data], {type : 'text/plain;charset=utf-8'});
    const filename = folder + name.replace(/[<>:"/\\|?*]/g, '') + '.user' + ext; // removing disallowed characters

    App.saveFile(data, filename, saveAs);
  }
}
const script = new Script();

// ----------------- Import/Export Preferences -------------
App.importExport(() => {
  options.process();                                        // set options after the pref update
  script.process();                                         // update page display
});
// ----------------- /Import/Export Preferences ------------

// ----------------- Match Pattern Tester ------------------
class Pattern {

  static validate(node) {
    node.classList.remove('invalid');
    node.value = node.value.trim();
    if (!node.value) { return true; }                       // emtpy

    // use for loop to be able to break early
    for (const item of node.value.split(/\s+/)) {
      const error = this.hasError(item);
      if (error) {
        node.classList.add('invalid');
        App.notify(`${browser.i18n.getMessage(node.id)}\n${item}\n${error}`);
        return false;                                       // end execution
      }
    }
    return true;
  }

  static hasError(p) {
    if (Meta.validPattern(p)) { return false; }

    if (!p.includes('://')) { return 'Invalid Pattern'; }
    p = p.toLowerCase();
    const [scheme, host, path] = p.split(/:\/{2,3}|\/+/);
    const file = scheme === 'file';

    // --- common pattern errors
    switch (true) {
      case !['http', 'https', 'file', '*'].includes(scheme):
        return scheme.includes('*') ? '"*" in scheme must be the only character' : 'Unsupported scheme';

      case file && !p.startsWith('file:///'):
        return 'file:/// must have 3 slashes';

       case !host:
        return 'Missing Host';

      case host.substring(1).includes('*'):
        return '"*" in host must be at the start';

      case host[0] === '*' && host[1] && host[1] !== '.':
        return '"*" in host must be the only character or be followed by "."';

      case !file && host.includes(':'):
        return 'Host must not include a port number';

      case !file && typeof path === 'undefined':
        return 'Missing Path';

      default:
        return 'Invalid Pattern';
    }
  }
}
// ----------------- /Match Pattern Tester -----------------

// ----------------- Log -----------------------------------
class ShowLog {

  constructor() {
    const logTemplate = document.querySelector('.log template');
    this.template = logTemplate.content.firstElementChild;
    this.tbody = logTemplate.parentNode;

    this.log = App.JSONparse(localStorage.getItem('log')) || [];
    this.log[0] && this.process(this.log);
    const logSize = document.querySelector('#logSize');
    logSize.value = localStorage.getItem('logSize') || 100;
    logSize.addEventListener('change', function(){ localStorage.setItem('logSize', this.value); });
  }

  process(list) {
    list.forEach(([time, ref, message, type]) => {

      const tr = this.template.cloneNode(true);
      type && tr.classList.add(type);
      const td = tr.children;
      td[0].textContent = time;
      td[1].title = ref;
      td[1].textContent = ref;
      td[2].textContent = message;
      this.tbody.insertBefore(tr, this.tbody.firstElementChild); // in reverse order, new on top
    });
  }

  update(newLog) {
    newLog = App.JSONparse(newLog) || [];
    if (!newLog[0]) { return; }

    const old = this.log.map(item => item.toString());      // need to conver to array of strings for Array.includes()
    const newItems = newLog.filter(item => !old.includes(item.toString()));

    if (newItems[0]) {
      this.log = newLog;
      this.process(newItems);
    }
  }
}
const showLog = new ShowLog();
// ---------------- /Log ----------------------------------
