/**
* Wrap an event emmiting object event handler in such a way,
* that when the event is detected, the promise get resolved.
*/
function eventPromise (emitter, eventName) {
  return new Promise((resolve, reject) => {
    emitter.on(eventName, (...args) => {
      return resolve(args)
    })
  })
}

module.exports = eventPromise
