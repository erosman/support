document.body.classList.toggle('dark', localStorage.getItem('dark') === 'true');
document.querySelector('input[type="range"]')?.addEventListener('input', e =>
  e.target.nextElementSibling.textContent = e.target.value);
