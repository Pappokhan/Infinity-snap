chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('snap.html');
  try {
    const existing = await chrome.tabs.query({ url });
    if (existing.length) {
      await chrome.tabs.update(existing[0].id, { active: true });
      await chrome.windows.update(existing[0].windowId, { focused: true });
      return;
    }
  } catch (e) {
  }
  chrome.tabs.create({ url });
});
