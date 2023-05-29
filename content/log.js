import {App} from './app.js';

// ---------- Log (Side Effect) ----------------------------
class ShowLog {

  static {
    const logTemplate = document.querySelector('.log template');
    this.template = logTemplate.content.firstElementChild;
    this.tbody = logTemplate.parentElement;

    this.aTemp = document.createElement('a');
    this.aTemp.target = '_blank';
    this.aTemp.textContent = '🗓 History';

    const logSize = document.querySelector('#logSize');
    logSize.value = localStorage.getItem('logSize') || 100;
    logSize.addEventListener('change', () => localStorage.setItem('logSize', logSize.value));

    this.log = App.JSONparse(localStorage.getItem('log')) || [];
    this.log[0] && this.process(this.log);

    // --- log update
    window.addEventListener('storage', e => e?.key === 'log' && this.update(e.newValue));
  }

  static process(list = this.log) {
    list.forEach(([time, ref, message, type, updateURL]) => {
      const tr = this.template.cloneNode(true);
      type && tr.classList.add(type);
      const td = tr.children;
      td[0].textContent = time;
      td[1].title = ref;
      td[1].textContent = ref;
      td[2].textContent = message;

      // --- History diff link
      if (updateURL && message.startsWith('Updated version')) {
        switch (true) {
          case updateURL.startsWith('https://greasyfork.org/scripts/'):
          case updateURL.startsWith('https://sleazyfork.org/scripts/'):
            const a = this.aTemp.cloneNode(true);
            a.href = updateURL.replace(/(\/\d+)-.+/, '$1/versions');
            td[2].appendChild(a);
            break;
        }
      }

      this.tbody.insertBefore(tr, this.tbody.firstElementChild); // in reverse order, new on top
    });
  }

  static update(newLog) {
    newLog = App.JSONparse(newLog) || [];
    if (!newLog[0]) { return; }

    const old = this.log.map(i => i.toString());            // need to convert to array of strings for Array.includes()
    const newItems = newLog.filter(i => !old.includes(i.toString()));

    if (newItems[0]) {
      this.log = newLog;
      this.process(newItems);
    }
  }
}