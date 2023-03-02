export {pref, App, Meta};

// ----------------- Default Preference --------------------
let pref = {
  autoUpdateInterval: 0,
  autoUpdateLast: 0,
  cmOptions: '',
  counter: true,
  customOptionsCSS: '',
  customPopupCSS: '',
  globalScriptExcludeMatches: '',
  sync: false,
  template: {css: '', js: ''}
};
// ----------------- /Default Preference -------------------

// ----------------- App -----------------------------------
class App {

  static android = navigator.userAgent.includes('Android');

  // ----------------- User Preference -----------------------
  static getPref() {
    // update pref with the saved version
    return browser.storage.local.get().then(result => {
      Object.keys(result).forEach(item => pref[item] = result[item]);
    });
  }

  static importExport(callback) {
    this.callback = callback;
    document.getElementById('file').addEventListener('change', this.import);
    document.getElementById('export').addEventListener('click', this.export);
  }

  static import(e) {
    const file = e.target.files[0];
    switch (true) {
      case !file: App.notify(browser.i18n.getMessage('error')); return;
      case !['text/plain', 'application/json'].includes(file.type): // check file MIME type
        App.notify(browser.i18n.getMessage('fileTypeError'));
        return;
    }

    const reader  = new FileReader();
    reader.onloadend = () => App.readData(reader.result);
    reader.onerror = () => App.notify(browser.i18n.getMessage('fileReadError'));
    reader.readAsText(file);
  }

  static async readData(data) {
    try { data = JSON.parse(data); }
    catch(e) {
      App.notify(browser.i18n.getMessage('fileParseError')); // display the error
      return;
    }

    // --- importing pre-2.25 data
    if (data.hasOwnProperty('content')) {
      localStorage.removeItem('migrate');                   // prepare to migrate
      pref = data;
      await Migrate.run();                                  // migrate
      this.callback();
      return;
    }

    // import scripts
    Object.keys(data).forEach(item => item.startsWith('_') && (pref[item] = data[item]));

    // update pref with the saved version
    Object.keys(pref).forEach(item => data.hasOwnProperty(item) && (pref[item] = data[item]));

    this.callback();                                        // successful import
  }

  static export() {
    const data = JSON.stringify(pref, null, 2);
    const filename = `${browser.i18n.getMessage('extensionName')}_${new Date().toISOString().substring(0, 10)}.json`;
    App.saveFile({data, filename});
  }

  static saveFile({data, filename, saveAs = true, type = 'text/plain'}) {
    if (!browser.downloads) {
      const a = document.createElement('a');
      a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(data);
      a.setAttribute('download', filename);
      a.dispatchEvent(new MouseEvent('click'));
      return;
    }

    const blob = new Blob([data], {type});
    browser.downloads.download({
      url: URL.createObjectURL(blob),
      filename,
      saveAs,
      conflictAction: 'uniquify'
    });
  }

  // ----------------- Helper functions ----------------------
  static notify(message, title = browser.i18n.getMessage('extensionName'), id = '') {
    browser.notifications.create(id, {
      type: 'basic',
      iconUrl: '/image/icon.svg',
      title,
      message
    });
  }

  static log(ref, message, type = '') {
    let log = App.JSONparse(localStorage.getItem('log')) || [];
    log.push([new Date().toString().substring(0, 24), ref, message, type]);
    log = log.slice(-(localStorage.getItem('logSize')*1 || 100)); // slice to the last n entries. default 100
    localStorage.setItem('log', JSON.stringify(log));
  }

  static JSONparse(str) {
    try { return JSON.parse(str); }
    catch (e) { return null; }
  }

  static getIds() {
    return Object.keys(pref).filter(item => item.startsWith('_'));
  }
}
// ----------------- /App ----------------------------------

// ----------------- Parse Metadata Block ------------------
class Meta {                                                // bg options

  static regEx = /==(UserScript|UserCSS|UserStyle)==([\s\S]+)==\/\1==/i;

  static get(str) {
    // --- get all
    const metaData = str.match(this.regEx);
    if (!metaData) { return null; }

    const type = metaData[1].toLowerCase();
    const js = type === 'userscript';
    const userStyle = type === 'userstyle';

    // --- Metadata Block
    const data = {
      // --- extension related data
      name: '',
      author: '',
      description: '',
      updateURL: '',
      version: '',

      enabled: true,
      autoUpdate: false,
      userMeta: '',
      antifeatures: [],
      injectInto: '',
      require: [],
      requireRemote: [],
      resource: {},
      error: '',                                            // reset error on save
      storage: {},
      grant: [],
      style: [],
      includes: [],
      excludes: [],
      container: [],
      userVar: {},
      preprocessor: '',
      i18n: { name: {}, description: {} },

      // --- API related data
      allFrames: false,
      js: js ? str : '',
      css: !js ? str.replace(/[\u200b-\u200d\ufeff]/g, '') : '', // avoid CSS parse error on invisible characters
      matches: [],
      excludeMatches: [],
      includeGlobs: [],
      excludeGlobs: [],
      matchAboutBlank: false,
      runAt: !js ? 'document_start' : 'document_idle'  // "document_start" "document_end" "document_idle" (default)
    };

    const lineRegex = /^[\s\/]*@([\w:-]+)(?:\s+(.+))?/;

    // convert @var select multiline to single line
    let mData = metaData[2].replace(/(@var\s+select\s+[^\n]+)(\{[^}]+\})/g, this.prepareSelect);

    // convert @advanced dropdown to select
    mData = mData.replace(/(@advanced\s+dropdown\s+[^\n]+)(\{[^}]+\})/g, this.prepareDropdown);

    // convert @advanced image to select
    mData = mData.replace(/(@advanced\s+image\s+[^\n]+)(\{[^}]+\})/g, this.prepareImage);

    mData.split(/[\r\n]+/).forEach(item => {          // lines
      let [,prop, value = ''] = item.trim().match(lineRegex) || [];
      if (!prop) { return; }                                // continue to next
      switch (prop) {
        // --- disallowed properties
        case 'js':
        case 'css':
        case 'userMeta':
        case 'requireRemote':
        case 'i18n':
          value = '';                                       // no more processing
          break;

        case 'noframes':
          data.allFrames = false;                           // convert @noframes to allFrames: false
          value = '';                                       // no more processing
          break;

        case 'include': prop = 'includes'; break;
        case 'exclude': prop = 'excludes'; break;
        case 'match': prop = 'matches'; break;
        case 'exclude-match': prop = 'excludeMatches'; break;
        case 'includeGlob': prop = 'includeGlobs'; break;
        case 'excludeGlob': prop = 'excludeGlobs'; break;
        case 'antifeature': prop = 'antifeatures'; break;

        case 'container':
          /default|private|container-\d+/i.test(value) && (value = value.toLowerCase());
          break;

        case 'updateURL':
          value.endsWith('.meta.js') && (value = '');       // disregarding .meta.js
          break;

        case 'downloadURL':                                 // convert downloadURL/installURL to updateURL
        case 'installURL':
          prop = 'updateURL';
          break;

        case 'run-at':                                      // convert run-at/runAt to runAt
        case 'runAt':
          prop = 'runAt';
          value = value.replace('-', '_');
          ['document_start', 'document_end'].includes(value) || (value = 'document_idle');
          break;

        case 'inject-into':                                 // only for js
          prop = 'injectInto';
          value = js && value === 'page' ? value : '';
          break;

        case 'resource':
          const [resName, resURL] = value.split(/\s+/);
          if(resName && resURL) { data.resource[resName] = resURL; }
          value = '';                                       // no more processing
          break;

        // --- var
        case 'preprocessor':                                // only for CSS
          if (js || !['uso', 'less', 'stylus'].includes(value)) {
            value = '';
          }
          break;

        case 'var':
        case 'advanced':
          const [, type, name, label, valueString] = value.match(/^(\S+)\s+(\S+)+\s+('[^']+'|"[^"]+"|\S+)\s+(.+)$/) || [];
          value = '';                                       // no more processing
          if (!type || !valueString.trim()) { break; }

          const [user, val] = this.getValue(type, valueString);
          if (typeof user === 'undefined') { break; }

          data.userVar[name] = {
            type,
            label: label.replace(/^('|")(.+)(\1)$/, '$2'),
            value: val,
            user,
          }
          break;

        // --- add @require
        case 'require':
          const url = value.toLowerCase().replace(/^(http:)?\/\//, 'https://'); // change starting http:// & Protocol-relative URL //
          const [protocol, host] = url.split(/[:/]+/);
          const cdnHosts = ['ajax.aspnetcdn.com', 'ajax.googleapis.com', 'apps.bdimg.com', 'cdn.bootcdn.net',
                            'cdn.bootcss.com', 'cdn.jsdelivr.net', 'cdn.staticfile.org', 'cdnjs.cloudflare.com',
                            'code.jquery.com', 'lib.baomitu.com', 'libs.baidu.com', 'pagecdn.io', 'unpkg.com'];
          const cdn = host && (cdnHosts.includes(host) || host.endsWith('-cdn-tos.bytecdntp.com'));
          switch (true) {
            case js && url.includes('/gm4-polyfill.'):      // not applicable
            case url.startsWith('lib/'):                    // disallowed value
              value = '';
              break;

            case js && url === 'jquery-3':
            case js && cdn && url.includes('/jquery-3.'):
            case js && cdn && url.includes('/jquery/3.'):
            case js && cdn && url.includes('/jquery@3'):
            case js && cdn && url.includes('/jquery/latest/'): // dead https://ajax.googleapis.com/ajax/libs/jquery/latest/jquery.min.js
              value = 'lib/jquery-3.jsm';
              break;

            case js && url === 'jquery-2':
            case js && cdn && url.includes('/jquery-2.'):
            case js && cdn && url.includes('/jquery/2.'):
            case js && cdn && url.includes('/jquery@2'):
              value = 'lib/jquery-2.jsm';
              break;

            case js && url === 'jquery-1':
            case js && cdn && url.includes('/jquery-1.'):
            case js && cdn && url.includes('/jquery/1.'):
            case js && cdn && url.includes('/jquery@1'):
            case js && url.startsWith('https://ajax.googleapis.com/ajax/libs/jquery/1'): // 1.11.1 https://ajax.googleapis.com/ajax/libs/jquery/1/jquery.min.js
            case js && url.startsWith('https://code.jquery.com/jquery-latest.'):
            case js && url.startsWith('https://code.jquery.com/jquery.'):
              value = 'lib/jquery-1.jsm';
              break;

            case js && url === 'jquery-ui-1':
            case js && cdn && url.includes('/jqueryui/1.'):
            case js && cdn && url.includes('/jquery.ui/1.'):
            case js && url.startsWith('https://cdn.jsdelivr.net/npm/jquery-ui-dist@1.'):
            case js && url.startsWith('https://code.jquery.com/ui/1.'):
              value = 'lib/jquery-ui-1.jsm';
              break;

            case js && url === 'bootstrap-4':
              value = 'lib/bootstrap-4.jsm';
              break;

            case js && url === 'bootstrap-5':
              value = 'lib/bootstrap-5.jsm';
              break;

            case js && cdn && url.includes('/bootstrap.min.js'):
            case js && cdn && url.endsWith('/bootstrap.js'):
              value = url.includes('@5.') ? 'lib/bootstrap-5.jsm' : 'lib/bootstrap-4.jsm';
              break;

            case js && url === 'moment-2':
            case js && cdn && url.includes('/moment.min.js'):
            case js && cdn && url.endsWith('/moment.js'):
              value = 'lib/moment-2.jsm';
              break;

            case js && url === 'underscore-1':
            case js && cdn && url.includes('/underscore.js'):
            case js && cdn && url.includes('/underscore-min.js'):
              value = 'lib/underscore-1.jsm';
              break;

            case url.startsWith('https://'):                // unsupported URL for Bundled Libraries
              prop = 'requireRemote';
              break;
          }
          break;

          default:                                          // i18n
            const m = prop.match(/^(name|description):([A-Za-z-]+)$/);
            m && (data.i18n[m[1]][m[2]] = value);
      }

      if (data.hasOwnProperty(prop) && value !== '') {
        switch (typeof data[prop]) {
          case 'boolean': data[prop] = value === 'true'; break;
          case 'object': data[prop].push(value); break;
          case 'string': data[prop] = value; break;
        }
      }
    });

    // --- check auto-update criteria, must have updateURL & version
    if (data.autoUpdate && (!data.updateURL || !data.version)) { data.autoUpdate = false; }

    // --- process UserStyle
    if (userStyle) {
      // split all sections
      str.split(/@-moz-document\s+/).slice(1).forEach(moz => {
        const st = moz.indexOf('{');
        const end = moz.lastIndexOf('}');
        if (st === -1 || end === -1) { return; }

        const rule = moz.substring(0, st).trim();
        let css = moz.substring(st+1, end).trim();

        // process preprocessor
        data.preprocessor && (css = this.preprocessor(css, data.preprocessor, data.userVar));

        const obj = {
          matches: [],
          css: css.trim()
        };

        const r = rule.split(/\s*[\s()'",]+\s*/);             // split into pairs
        for (let i = 0; i < r.length; i+=2) {
          if(!r[i+1]) { break; }
          const func = r[i];
          const value = r[i+1];

          switch (func) {
            case 'domain': obj.matches.push(`*://*.${value}/*`); break;
            case 'url': obj.matches.push(value); break;
            case 'url-prefix':
              obj.matches.push(value + (value.split(/:?\/+/).length > 2 ? '*' : '/*')); // fix no path
              break;

            case 'regexp': // convert basic regexp, ignore the rest
              switch (value) {
                case '.*':                                    // catch-all
                case 'https:.*':
                  obj.matches.push('*://*/*');
                  break;
              }
              break;
          }
        }

        obj.matches[0] && data.style.push(obj);
      });
    }

    // ------------- update from previous version ----------
    const id = `_${data.name}`;
    if (pref[id]) {
      ['enabled', 'autoUpdate', 'userMeta', 'storage'].forEach(item => data[item] = pref[id][item]);
      !data.updateURL && (data.updateURL = pref[id].updateURL);

      // --- userVar
      Object.keys(data.userVar).forEach(item =>
        pref[id].userVar?.[item]?.hasOwnProperty('usr') && (data.userVar[item].usr = pref[id].userVar[item].usr));
    }

    // this.enable etc are defined in options.js but not from background.js
    if (this.enable) {
      data.enabled = this.enable.checked;
      data.autoUpdate = this.autoUpdate.checked;
      data.userMeta = this.userMeta.value;

      // --- userVar
      !this.userVar.dataset.default && document.querySelectorAll('.userVar input, .userVar select').forEach(item => {
        const id = item.dataset.id;
        if (!data.userVar[id] || !item.value.trim()) { return; } // skip

        // number | string
        let val = item.type === 'checkbox' ? item.checked*1 : Number.isNaN(item.value*1) ? item.value : item.value*1;

        // color may have opacity
        item.dataset.opacity && console.log(val += item.dataset.opacity);
        data.userVar[id].user = val;
      });
    }

    // ------------- User Metadata -------------------------
    const matches = [];
    const excludeMatches = [];
    data.userMeta?.split(/[\r\n]+/).forEach(item => { // lines
      let [,prop, value = ''] = item.trim().match(lineRegex) || [];
      if (!prop) { return; }                                // continue to next

      switch (prop) {
        case 'disable-match':
          data.matches = value ? data.matches.filter(item => item !== value) : [];
          break

        case 'disable-exclude-match':
          data.excludeMatches = value ? data.excludeMatches.filter(item => item !== value) : [];
          break

        case 'disable-include':
          data.includes = value ? data.includes.filter(item => item !== value) : [];
          data.includeGlobs = value ? data.includeGlobs.filter(item => item !== value) : [];
          break

        case 'disable-exclude':
          data.excludes = value ? data.excludes.filter(item => item !== value) : [];
          data.excludeGlobs = value ? data.excludeGlobs.filter(item => item !== value) : [];
          break

        case 'disable-container':
          const vlc = value.toLowerCase();
          data.container = value ? data.container.filter(item => item !== vlc) : [];
          break;

        case 'match':
          value && matches.push(value);
          break;

        case 'exclude-match':
          value && excludeMatches.push(value);
          break;

        case 'container':
          /default|private|container-\d+/i.test(value) && data.container.push(value.toLowerCase());
          break;

        case 'matchAboutBlank':
          data.matchAboutBlank = value === 'true';
          break;

        case 'allFrames':
          data.allFrames = value === 'true';
          break;

        case 'inject-into':
          js && value === 'page' && (data.injectInto = 'page');
          break;

        case 'run-at':
          value = value.replace('-', '_');
          ['document_start', 'document_end', 'document_idle'].includes(value) && (data.runAt = value);
          break;
      }
    });

    data.matches.push(...matches);
    data.excludeMatches.push(...excludeMatches);
    // ------------- /User Metadata ------------------------

    // --- auto-convert include/exclude rules
    [data.includes, data.matches, data.includeGlobs] = this.convert(data.includes, data.matches, data.includeGlobs, js);
    [data.excludes, data.excludeMatches, data.excludeGlobs] = this.convert(data.excludes, data.excludeMatches, data.excludeGlobs, js);

    // move matches to includeGlobs due to API matching order
    if (data.includeGlobs[0]) {
      // filter catch all globs
      data.includeGlobs.push(...data.matches.filter(item => !['<all_urls>', '*://*/*', 'file:///*'].includes(item)));
      data.matches = [];
    }

    // --- check for overlap rules
    data.matches = this.checkOverlap(data.matches);
    data.excludeMatches = this.checkOverlap(data.excludeMatches);

    // --- remove duplicates
    Object.keys(data).forEach(item => Array.isArray(data[item]) && data[item].length > 1 && (data[item] = [...new Set(data[item])]));

    return data;
  }

  static getValue(type, str) {
    let jp, def;
    switch (type) {
      case 'number':
      case 'range':
        jp = App.JSONparse(str) || App.JSONparse(str.replace(/'/g, '"')); // check if single quote object
        if (!jp) { return []; }

        // sort unit to the end
        jp.sort((a, b) => typeof a === 'string' && typeof b !== 'string');
        return [jp[0], jp];

      case 'select':
      case 'dropdown':
        case 'image':
        jp = App.JSONparse(str);
        if (!jp) { return []; }

        if (Array.isArray(jp)) {
          def = jp.find(item => item.endsWith('*')) || jp[0];
          return [def, jp];
        }

        const ky = Object.keys(jp);
        def = ky.find(item => item.endsWith('*'));
        return [def ? jp[def] : jp[ky[0]], jp];
        break;

      case 'checkbox':
        return [['1', 'true'].includes(str), str];

      default:
        return [str, str];
    }
  }

  static preprocessor(str, pp, userVar = {}) {
    const re = {
      less: (r) => new RegExp('@' + r + '\\b', 'g'),
      stylus: (r) => new RegExp('\\b' + r + '\\b', 'g'),
      uso: (r) => new RegExp('/\\*\\[\\[' + r + '\\]\\]\\*/', 'g'),
    };

    Object.keys(userVar).forEach(item => str = str.replace(re[pp](item), `var(--${item})`));
    return str;
  }

  static prepareSelect(m, p1, p2) {
    let jp = App.JSONparse(p2) || App.JSONparse(p2.replace(/'/g, '"')); // check if single quote object
    return jp ? p1 + JSON.stringify(jp) : '';               // remove if not valid JSON
  }

  static prepareDropdown(m, p1, p2) {
    const obj ={};
    const opt = p2.slice(1, -1).trim().split(/\s+EOT;/);
    opt.forEach(item => {
      if (!item.trim()) { return; }
      const [, id, label, valueString] = item.match(/(\S+)\s+"([^<]+)"\s+<<<EOT\s*([\S\s]+)/);
      label && (obj[label] = valueString);
    });
    return Object.keys(obj)[0] ? p1 + JSON.stringify(obj) : '';
  }

  static prepareImage(m, p1, p2) {
    const obj ={};
    const opt = p2.slice(1, -1).trim().split(/[\r\n]+/);
    opt.forEach(item => {
      item = item.trim();
      if (!item) { return; }
      const [, id, label, valueString] = item.match(/(\S+)\s+"(.+)"\s+"(.+)"/);
      label && (obj[label] = valueString);
    });
    return Object.keys(obj)[0] ? p1 + JSON.stringify(obj) : '';
  }

  static convert(inc, mtch, glob, js) {
    const newInc = [];
    inc.forEach(item => {
      // keep regex in includes/excludes, rest in includeGlobs/excludeGlobs, only for userScript
      if (item.startsWith('/') &&  item.endsWith('/')) {
        js && newInc.push(item);
      }
      else if (item.toLowerCase().includes('.tld/')) {      // revert back .tld
        item = item.replace(/\.tld\//i, '.*/');
        glob.push(item);
      }
      else {
        const converted = this.convertPattern(item);
        converted ? mtch.push(converted) : glob.push(item);
      }
    });
    return [newInc, mtch, glob];
  }

  // --- attempt to convert to matches API
  static convertPattern(p) {
    // test if valid match pattern
    if (this.validPattern(p)) { return p; }

    switch (true) {
      // Regular Expression
      case p.startsWith('/') && p.endsWith('/'): return;

      // fix complete pattern
      case p === '*':  return '<all_urls>';
      case p === 'http://*': return 'http://*/*';
      case p === 'https://*': return 'https://*/*';
      case p === 'http*://*': return '*://*/*';

      // fix scheme
      case p.startsWith('http*'): p = p.substring(4); break;  // *://.....
      case p.startsWith('*//'): p = '*:' + p.substring(1); break; // bad protocol wildcard
      case p.startsWith('//'): p = '*:' + p; break;           // Protocol-relative URL
      case !p.includes('://'): p = '*://' + p; break;         // no protocol
    }

    // test again
    if (this.validPattern(p)) { return p; }

    let [scheme, host, ...path] = p.split(/:\/{2,3}|\/+/);

    // http/https schemes
    if (!['http', 'https', 'file', '*'].includes(scheme.toLowerCase())) { scheme = '*'; } // bad scheme
    if (host.includes(':')) { host = host.replace(/:.+/, ''); } // host with port
    if (host.startsWith('*') && host[1] && host[1] !== '.') { host = '*.' + host.substring(1); } // starting wildcard *google.com
    p = scheme +  '://' + [host, ...path].join('/');        // rebuild pattern

    if (!path[0] && !p.endsWith('/')) { p += '/'; }         // fix trailing slash

    // test again
    if (this.validPattern(p)) { return p; }
  }

  static validPattern(p) {
    return p === '<all_urls>' ||
          /^(https?|\*):\/\/(\*|\*\.[^*:/]+|[^*:/]+)\/.*$/i.test(p) ||
          /^file:\/\/\/.+$/i.test(p);
  }

  static checkOverlap(arr) {
    if (arr.includes('<all_urls>')) {
      return ['<all_urls>'];
    }

    if (arr.includes('*://*/*')) {
      arr = arr.filter(item => !item.startsWith('http://') && !item.startsWith('https://') && !item.startsWith('*://'));
      arr.push('*://*/*');
    }

    if (arr.includes('file:///*')) {
      arr = arr.filter(item => !item.startsWith('file:///'));
      arr.push('file:///*');
    }

    if (arr.includes('http://*/*')) {
      arr = arr.filter(item => !item.startsWith('http://'));
      arr.push('http://*/*');
    }

    if (arr.includes('https://*/*')) {
      arr = arr.filter(item => !item.startsWith('https://'));
      arr.push('https://*/*');
    }

    if (arr.includes('http://*/*') && arr.includes('https://*/*')) {
      arr = arr.filter(item => !['http://*/*', 'https://*/*'].includes(item));
      arr.push('*://*/*');
    }

    return arr;
  }

  // fixing metadata block since there would be an error with /* ... *://*/* ... */
  static prepare(str) {
    return str.replace(this.regEx, (m) =>
      !m.includes('*/') ? m :
        m.split(/[\r\n]+/).map(item => /^\s*@[\w:-]+\s+.+/.test(item) ? item.replace(/\*\//g, '* /') : item).join('\n')
    );
  }
}
// ----------------- /Parse Metadata Block -----------------

// ----------------- Remote Update -------------------------
class RemoteUpdate1 {                                        // bg options

  static getUpdate(item, manual) {                          // bg 1 opt 1
    switch (true) {
      // --- get meta.js
      case item.updateURL.startsWith('https://greasyfork.org/scripts/'):
      case item.updateURL.startsWith('https://sleazyfork.org/scripts/'):
      case item.js && item.updateURL.startsWith('https://openuserjs.org/install/'):
        this.getMeta(item, manual);
        break;

      case /^https:\/\/userstyles\.org\/styles\/\d+\/.+\.css/.test(item.updateURL):
        this.getStlylishVersion(item, manual);
        break;

      // --- direct update
      default:
        this.getScript(item);
    }
  }

  static getMeta(item, manual) {                                   // here
    const url = item.updateURL.replace(/\.user\.(js|css)/i, '.meta.$1');
    fetch(url)
    .then(response => response.text())
    .then(text => this.needUpdate(text, item) ? this.getScript(item) :
                      manual && App.notify(browser.i18n.getMessage('noNewUpdate'), item.name))
    .catch(error => App.log(item.name, `getMeta ${url} ➜ ${error.message}`, 'error'));
  }

  static getStlylishVersion(item, manual) {
    const url = item.updateURL.replace(/(\d+\/.+)css/i, 'userjs/$1user.js');
    fetch(url)
    .then(response => response.text())
    .then(text => {
      const m = text.match(/@version\s+(\S+)/);
      const version = m ? m[1].substring(2,10) : '';
      version > item.version ? this.getStylish(item, version) : manual && App.notify(browser.i18n.getMessage('noNewUpdate'), item.name);
    })
    .catch(error => App.log(item.name, `getMeta ${url} ➜ ${error.message}`, 'error'));
  }


  static getStylish(item, version) {
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

  static needUpdate(text, item) {                                  // here
    const version = text.match(/@version\s+(\S+)/);         // check version
    return version && this.higherVersion(version[1], item.version);
  }

  static getScript(item) {                                         // here & bg
    fetch(item.updateURL)
    .then(response => response.text())
    .then(text => this.callback(text, item.name, item.updateURL))
    .catch(error => App.log(item.name, `getScript ${item.updateURL} ➜ ${error.message}`, 'error'));
  }

  static higherVersion(a, b) {                                     // here & bg & opt
    return a.localeCompare(b, undefined, {numeric: true, sensitivity: 'base'}) > 0;
  }
}
// ----------------- /Remote Update ------------------------
