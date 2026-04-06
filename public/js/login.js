  // Safely read the ?error param and show a canned message — never reflect it
  const params = new URLSearchParams(window.location.search);
  const error  = params.get('error');
  const container = document.getElementById('errorContainer');
  if (error === 'locked') {
    const div = document.createElement('div');
    div.className = 'locked-msg';
    div.textContent = 'Too many login attempts. Please wait 15 minutes and try again.';
    container.appendChild(div);
  } else if (error) {
    const div = document.createElement('div');
    div.className = 'error-msg';
    div.textContent = 'Incorrect password. Please try again.';
    container.appendChild(div);
  }
