'use strict';

(() => {
const desktop = window.desktop;
const minimizeButton = document.getElementById('minimize');
const maximizeButton = document.getElementById('maximize');
const closeButton = document.getElementById('close');
const retryButton = document.getElementById('retry');
const loadingScreen = document.getElementById('loading-screen');
const statusMessage = document.getElementById('status-message');
const statusDetail = document.getElementById('status-detail');
const statusAnnouncement = document.getElementById('status-announcement');
const progressTrack = document.getElementById('progress-track');
const progressFill = document.getElementById('progress-fill');
const applyUpdate = document.getElementById('apply-update');
const updateDetail = document.getElementById('update-detail');
const updateAnnouncement = document.getElementById('update-announcement');
const updateProgressFill = document.getElementById('update-progress-fill');
let currentUpdateState = { available: false, status: 'idle' };
applyUpdate.addEventListener('click', () => {
  if (applyUpdate.disabled || applyUpdate.hidden) return;
  // Paint the retry immediately, including when no newer release has been
  // confirmed. Native code replaces this with the result and, on an explicit
  // retry failure, shows the full reason in a native dialog.
  renderUpdateState({ ...currentUpdateState, status: 'checking', error: '' });
  try { desktop.applyUpdate(); }
  catch (error) { renderUpdateState({ ...currentUpdateState, status: 'check-error', error: error?.message || 'The update check could not start.' }); }
});
function renderUpdateState(value) {
  currentUpdateState = value || {};
  const state = value?.status || 'available';
  const busy = state === 'checking' || state === 'downloading' || state === 'installing';
  const visible = !!value?.available || busy || state === 'error' || state === 'check-error';
  const version = typeof value?.version === 'string' ? value.version : '';
  const progress = Math.round(Math.max(0, Math.min(100, Number(value?.progress) || 0)));
  let label = value?.nativeAvailable
    ? `Update Chat App${version ? ` to ${version}` : ''}${value.webAvailable ? ' and apply the web update' : ''}. The app will restart.`
    : 'Apply the web update and refresh Chat App';
  let detail = '';
  if (state === 'checking') { label = 'Checking for Chat App updates'; detail = 'Checking…'; }
  if (state === 'downloading') { label = `Downloading Chat App update: ${progress}%`; detail = `${progress}%`; }
  if (state === 'installing') { label = 'Installing Chat App update. The app will restart.'; detail = 'Restarting…'; }
  if (state === 'ready') { label = 'Restart Chat App to install the update'; }
  if (state === 'current' && !value?.available) { label = 'Chat App is up to date.'; }
  if (state === 'check-error') {
    const error = typeof value?.error === 'string' ? value.error : 'The update server could not be checked.';
    label = `Could not check for native updates. ${error} Click to retry${value?.webAvailable ? ' and apply the available web update' : ''}.`;
    detail = 'Check unavailable';
  }
  if (state === 'error') {
    const error = typeof value?.error === 'string' ? value.error : 'The update could not be completed.';
    label = `${error} Click to retry the update.`; detail = 'Update failed';
  }
  applyUpdate.hidden = !visible;
  applyUpdate.disabled = busy;
  applyUpdate.dataset.state = state;
  applyUpdate.dataset.available = String(value?.available === true);
  applyUpdate.title = label;
  applyUpdate.setAttribute('aria-label', label);
  applyUpdate.setAttribute('aria-busy', String(busy));
  updateProgressFill.style.width = `${progress}%`;
  updateDetail.hidden = !visible || !detail;
  updateDetail.textContent = detail;
  updateDetail.title = label;
  updateAnnouncement.textContent = visible || state === 'current' ? label : '';
}
desktop.onUpdate(renderUpdateState);

minimizeButton.addEventListener('click', () => desktop.minimize());
maximizeButton.addEventListener('click', () => desktop.maximize());
closeButton.addEventListener('click', () => desktop.close());
retryButton.addEventListener('click', () => {
  updateStatus({ message: 'Opening Chat App', detail: 'Getting the latest version ready.' });
  desktop.retry();
});

function updateStatus(status) {
  if (!status || typeof status !== 'object') return;
  const error = status.error === true;
  const message = typeof status.message === 'string' && status.message.trim()
    ? status.message
    : error ? 'Unable to open Chat App' : 'Opening Chat App';
  const detail = typeof status.detail === 'string' ? status.detail : '';
  statusMessage.textContent = message;
  statusDetail.textContent = detail;
  statusDetail.hidden = !detail;
  loadingScreen.classList.toggle('has-error', error);
  retryButton.hidden = !error;
  const hasProgress = !error && typeof status.progress === 'number' && Number.isFinite(status.progress);
  progressTrack.hidden = !hasProgress;
  if (hasProgress) {
    const progress = Math.round(Math.max(0, Math.min(100, status.progress)));
    progressFill.style.width = `${progress}%`;
    progressTrack.setAttribute('aria-valuenow', String(progress));
  }
  statusAnnouncement.textContent = detail ? `${message}. ${detail}` : message;
}

desktop.onStatus(updateStatus);
desktop.onMaximized((isMaximized) => {
  const label = isMaximized ? 'Restore down' : 'Maximize';
  maximizeButton.title = label;
  maximizeButton.setAttribute('aria-label', label);
});
})();
