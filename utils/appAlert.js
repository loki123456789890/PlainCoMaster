// Imperative bridge so any screen can trigger the on-brand alert modal the
// same way it would call the OS's Alert.alert(title, message, buttons) —
// without threading visibility state through every call site. AppAlertHost
// (mounted once at the app root) registers itself as the handler; this file
// just forwards calls to whichever handler is currently registered.
let currentHandler = null;

export function registerAlertHandler(handler) {
  currentHandler = handler;
  return () => {
    if (currentHandler === handler) {
      currentHandler = null;
    }
  };
}

export function showAppAlert(title, message, buttons) {
  if (!currentHandler) {
    console.warn('showAppAlert called before AppAlertHost mounted:', title);
    return;
  }
  currentHandler(title, message, buttons);
}
