// locationEvents.js — Pub/sub bridge between RegisterLocationScreen and MapScreen
// RegisterLocationScreen emits 'saving' (optimistic navigate-back) then 'saved' or 'error'.
// MapScreen subscribes and shows the status bubble + triggers a saved-locations reload.

let _listeners = [];

export const locationEvents = {
  // Returns an unsubscribe function; call it in useEffect cleanup
  on:   (cb) => { _listeners.push(cb); return () => { _listeners = _listeners.filter(l => l !== cb); }; },
  emit: (event) => _listeners.forEach(l => l(event)),
};
