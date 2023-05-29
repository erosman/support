import {App} from './app.js';

// ---------- Parse Metadata Block -------------------------
export class Meta {                                         // bg, options

  static regEx = /==(UserScript|UserCSS|UserStyle)==([\s\S]+?)==\/\1==/i;
  static lineRegex = /^[\s\/]*@([\w:-]+)(?:\s+(.+))?/;

  static get(str, pref) {
    // --- get all
    const metaData = str.match(this.regEx);
    if (!metaData) { return null; }

    const type = metaData[1].toLowerCase();
    const js = type === 'userscript';
    const userStyle = type === 'userstyle';

    // --- Metadata Block
    const data = {
      // --- Metadata single string properties
      name: '',
      author: '',
      description: '',
      version: '',
      updateURL: '',
      metaURL: '',
      preprocessor: '',
      injectInto: '',
      runAt: !js ? 'document_start' : 'document_idle',      // "document_start" (default for css) | "document_end" | "document_idle" (default for js)

      // --- Metadata single boolean properties
      allFrames: false,
      matchAboutBlank: false,

      // --- Metadata multi properties
      antifeatures: [],
      container: [],
      excludes: [],
      includes: [],
      require: [],
      resource: {},
      matches: [],
      excludeMatches: [],
      includeGlobs: [],
      excludeGlobs: [],
      grant: [],
      i18n: {name: {}, description: {}},

      // --- Additional editable properties
      storage: {},
      userMeta: '',
      userVar: {},

      // --- Non-Metadata properties
      autoUpdate: false,
      enabled: true,
      error: '',                                            // reset error on save
      requireRemote: [],
      style: [],

      // --- API related data
      js: js ? str : '',
      css: !js ? str.replace(/[\u200b-\u200d\ufeff]/g, '') : '', // avoid CSS parse error on invisible characters
    };

    // convert @var select multiline to single line
    let mData = metaData[2].replace(/(@var\s+select\s+[^\n]+)(\{[^}]+\})/g, this.#prepareSelect);

    // convert @advanced dropdown to select
    mData = mData.replace(/(@advanced\s+dropdown\s+[^\n]+)(\{[^}]+\})/g, this.#prepareDropdown);

    // convert @advanced image to select
    mData = mData.replace(/(@advanced\s+image\s+[^\n]+)(\{[^}]+\})/g, this.#prepareImage);

    // --- disallowed properties
    const disallowed =  ['autoUpdate', 'css', 'enabled', 'error', 'i18n', 'js',
      'requireRemote', 'storage', 'style', 'userMeta', 'userMeta', 'userVar'];

    mData.split(/[\r\n]+/).forEach(item => {                // lines
      let [,prop, value = ''] = item.trim().match(this.lineRegex) || [];
      if (!prop) { return; }                                // continue to next
      if (disallowed.includes(prop)) { return; }

      switch (prop) {
        case 'noframes':
          data.allFrames = false;                           // convert @noframes to allFrames: false
          return;                                           // no more processing

        case 'include':
          if (value === 'about:blank') {
            data.matchAboutBlank = true;
            return;
          }
          prop = 'includes';
          break;

        // change property name, single value to array
        case 'exclude': prop = 'excludes'; break;
        case 'match': prop = 'matches'; break;
        case 'exclude-match': prop = 'excludeMatches'; break;
        case 'includeGlob': prop = 'includeGlobs'; break;
        case 'excludeGlob': prop = 'excludeGlobs'; break;
        case 'antifeature': prop = 'antifeatures'; break;


        case 'container':
          if (!/default|private|container-\d+/i.test(value)) { return; }
          value = value.toLowerCase();
          break;

        case 'updateURL':
          if (value?.endsWith('.meta.js')) {
            data.metaURL = value;                           // save as metaURL
            return;
          }
          break;

        // convert downloadURL/installURL to updateURL
        case 'downloadURL':
        case 'installURL':
          prop = 'updateURL';
          break;

        case 'run-at':
        case 'runAt':
          prop = 'runAt';
          value = value.replace('-', '_');
          ['document_start', 'document_end'].includes(value) || (value = 'document_idle');
          break;

        case 'inject-into':                                 // only for js
          if(!js || value !== 'page') { return; }
          prop = 'injectInto';
          break;

        case 'resource':
          const [resName, resURL] = value.split(/\s+/);
          if(resName && resURL) { data.resource[resName] = resURL; }
          return;

        // --- var
        case 'preprocessor':                                // only for CSS
          if (js || !['uso', 'less', 'stylus'].includes(value)) { return; }
          break;

        case 'var':
        case 'advanced':
          const [, type, name, label, valueString] = value.match(/^(\S+)\s+(\S+)+\s+('[^']+'|"[^"]+"|\S+)\s+(.+)$/) || [];
          if (!type || !valueString.trim()) { return; }

          const [user, val] = this.#getValue(type, valueString);
          if (typeof user === 'undefined') { return; }

          data.userVar[name] = {
            type,
            label: label.replace(/^('|")(.+)(\1)$/, '$2'),
            value: val,
            user,
          }
          return;

        // --- add @require
        case 'require':
          value.startsWith('//') && (value = 'https:' + value); // change Protocol-relative URL '//example.com/' to https://
          const url = value.toLowerCase();
          switch (true) {
            case url.startsWith('lib/'):                    // disallowed value
              return;

            case url.startsWith('http://'):
            case url.startsWith('https://'):
              prop = 'requireRemote';
              break;
          }
          break;

          // --- i18n
          default:
            const m = prop.match(/^(name|description):([A-Za-z-]+)$/);
            if (m) {
              data.i18n[m[1]][m[2]] = value;
              return;
            }
      }

      // set prop & value
      if (data.hasOwnProperty(prop) && value !== '') {
        switch (typeof data[prop]) {
          case 'string':  data[prop] = value; break;
          case 'boolean': data[prop] = value === 'true'; break;
          case 'object':  data[prop].push(value); break;
        }
      }
    });

    // --- check auto-update criteria, must have updateURL & version
    if (!data.updateURL || !data.version) {
      data.autoUpdate = false;
    }

    // --- process UserStyle
    userStyle && this.#processStyle(data, str);

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
      data.autoUpdate = !!data.updateURL && !!data.version && this.autoUpdate.checked;
      data.userMeta = this.userMeta.value;

      // --- userVar
      !this.userVar.dataset.default && document.querySelectorAll('.userVar input, .userVar select').forEach(item => {
        const id = item.dataset.id;
        if (!data.userVar[id] || !item.value.trim()) { return; } // skip

        // number | string
        let val = item.type === 'checkbox' ? item.checked*1 : Number.isNaN(item.value*1) ? item.value : item.value*1;

        // color may have opacity
        item.dataset.opacity && (val += item.dataset.opacity);
        data.userVar[id].user = val;
      });
    }

    // --- User Metadata
    data.userMeta && this.#processUserMeta(data, js);

    // --- auto-convert include/exclude rules
    [data.includes, data.matches, data.includeGlobs] =
      this.#convert(data.includes, data.matches, data.includeGlobs, js);
    [data.excludes, data.excludeMatches, data.excludeGlobs] =
      this.#convert(data.excludes, data.excludeMatches, data.excludeGlobs, js);

    // move matches to includeGlobs due to API matching order
    if (data.includeGlobs[0]) {
      // filter catch all globs
      data.includeGlobs.push(...data.matches.filter(item => !['<all_urls>', '*://*/*', 'file:///*'].includes(item)));
      data.matches = [];
    }

    // --- check for overlap rules
    data.matches = this.#checkOverlap(data.matches);
    data.excludeMatches = this.#checkOverlap(data.excludeMatches);

    // --- remove duplicates
    Object.keys(data).forEach(i => Array.isArray(data[i]) && data[i].length > 1 && (data[i] = [...new Set(data[i])]));

    return data;
  }

  static #filter(array, value) {
    return value ? array.filter(i => i !== value) : [];
  }

  // --- user metadata
  static #processUserMeta(data, js) {
    const matches = [];
    const excludeMatches = [];
    data.userMeta.split(/[\r\n]+/).forEach(item => {        // lines
      let [,prop, value = ''] = item.trim().match(this.lineRegex) || [];
      if (!prop) { return; }                                // continue to next

      switch (prop) {
        case 'disable-match':
          data.matches = this.#filter(data.matches, value);
          break;

        case 'disable-exclude-match':
          data.excludeMatches = this.#filter(data.excludeMatches, value);
          break;

        case 'disable-include':
          data.includes = this.#filter(data.includes, value);
          data.includeGlobs = this.#filter(data.includeGlobs, value);
          break;

        case 'disable-exclude':
          data.excludes = this.#filter(data.excludes, value);
          data.excludeGlobs = this.#filter(data.excludeGlobs, value);
          break;

        case 'disable-container':
          data.container = this.#filter(data.container, value.toLowerCase());
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

        case 'updateURL':
          value && (data.updateURL = value);
          break;

        case 'metaURL':
          value && (data.metaURL = value);
          break;
      }
    });

    data.matches.push(...matches);
    data.excludeMatches.push(...excludeMatches);
  }

  // --- @var. @advanced
  static #getValue(type, str) {
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

      case 'checkbox':
        return [['1', 'true'].includes(str), str];

      default:
        return [str, str];
    }
  }

  // --- userStyle
  static #processStyle(data, str) {
    // split all sections
    str.split(/@-moz-document\s+/).slice(1).forEach(moz => {
      const st = moz.indexOf('{');
      const end = moz.lastIndexOf('}');
      if (st === -1 || end === -1) { return; }

      const rule = moz.substring(0, st).trim();
      let css = moz.substring(st+1, end).trim();

      // process preprocessor
      data.preprocessor && (css = this.#preprocessor(css, data.preprocessor, data.userVar));

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

          // convert basic regexp, ignore the rest
          case 'regexp':
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

  // --- @preprocessor
  static #preprocessor(str, pp, userVar = {}) {
    const re = {
      less:   (r) => new RegExp('@' + r + '\\b', 'g'),
      stylus: (r) => new RegExp('\\b' + r + '\\b', 'g'),
      uso:    (r) => new RegExp('/\\*\\[\\[' + r + '\\]\\]\\*/', 'g'),
    };

    Object.keys(userVar).forEach(item => str = str.replace(re[pp](item), `var(--${item})`));
    return str;
  }

  static #prepareSelect(m, p1, p2) {
    let jp = App.JSONparse(p2) || App.JSONparse(p2.replace(/'/g, '"')); // check if single quote object
    return jp ? p1 + JSON.stringify(jp) : '';               // remove if not valid JSON
  }

  static #prepareDropdown(m, p1, p2) {
    const obj ={};
    const opt = p2.slice(1, -1).trim().split(/\s+EOT;/);
    opt.forEach(item => {
      if (!item.trim()) { return; }
      const [, id, label, valueString] = item.match(/(\S+)\s+"([^<]+)"\s+<<<EOT\s*([\S\s]+)/);
      label && (obj[label] = valueString);
    });
    return Object.keys(obj)[0] ? p1 + JSON.stringify(obj) : '';
  }

  static #prepareImage(m, p1, p2) {
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

  static #convert(inc, mch, glob, js) {
    const newInc = [];
    inc.forEach(item => {
      // keep regex in includes/excludes, rest in includeGlobs/excludeGlobs, only for userScript
      if (item.startsWith('/') && item.endsWith('/')) {
        js && newInc.push(item);
      }
      else if (item.toLowerCase().includes('.tld/')) {      // revert back .tld
        item = item.replace(/\.tld\//i, '.*/');
        glob.push(item);
      }
      else {
        const converted = this.#convertPattern(item);
        converted ? mch.push(converted) : glob.push(item);
      }
    });
    return [newInc, mch, glob];
  }

  // --- attempt to convert to match pattern
  static #convertPattern(p) {
    // test match pattern validity
    if (this.validPattern(p)) { return p; }

    switch (true) {
      case p.startsWith('/') && p.endsWith('/'):            // cant convert Regular Expression
        return;

      // convert whole pattern
      case p === '*': return '<all_urls>';
      case p === 'http://*': return 'http://*/*';
      case p === 'https://*': return 'https://*/*';

      case p === 'http*://*':
      case p === 'http*':
        return '*://*/*';

      // fix scheme
      case p.startsWith('http*'): p = p.substring(4); break; // *://.....
      case p.startsWith('*//'): p = '*:' + p.substring(1); break; // bad protocol wildcard
      case p.startsWith('//'): p = '*:' + p; break;         // Protocol-relative URL
      case !p.includes('://'): p = '*://' + p; break;       // no protocol
    }

    // test match pattern validity
    if (this.validPattern(p)) { return p; }

    let [scheme, host, ...path] = p.split(/:\/{2,3}|\/+/);

    // fix no host & path e.g. http*
    if (!host) {
      host = '*';
      path = ['*'];
    }

    // http/https schemes
    if (!['http', 'https', 'file', '*'].includes(scheme.toLowerCase())) { scheme = '*'; } // bad scheme
    if (host.includes(':')) { host = host.replace(/:.+/, ''); } // host with port
    if (host.startsWith('*') && host[1] && host[1] !== '.') { host = '*.' + host.substring(1); } // starting wildcard *google.com
    p = scheme + '://' + [host, ...path].join('/');         // rebuild pattern

    if (!path[0] && !p.endsWith('/')) { p += '/'; }         // fix trailing slash

    // test match pattern validity
    if (this.validPattern(p)) { return p; }
  }

  // --- test match pattern validity
  static validPattern(p) {
    return p === '<all_urls>' ||
          /^(https?|\*):\/\/(\*|\*\.[^*:/]+|[^*:/]+)\/.*$/i.test(p) ||
          /^file:\/\/\/.+$/i.test(p);
  }

  static #checkOverlap(arr) {
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

  // fixing metadata block since there would be an error with /* ...@match    *://*/* ... */
  static prepare(str) {
    return str.replace(this.regEx, (m) =>
      !m.includes('*/') ? m :
        m.split(/\r?\n/).map(item => /^\s*@[\w:-]+\s+.+/.test(item) ? item.replace(/\*\//g, '* /') : item).join('\n')
    );
  }
}