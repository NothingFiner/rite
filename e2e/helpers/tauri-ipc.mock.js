// Page-side half of the shared Tauri IPC mock — **Tauri v2 envelope**.
//
// A plain script on purpose: Playwright's `addInitScript` cannot import ESM, so
// `mockIPC` from `@tauri-apps/api/mocks` is not usable from an injected page
// script. This file is the vendored replacement, and it is the ONLY place that
// knows the wire shape.
//
// Tauri v2 (unlike v1) is a promise API:
//
//   invoke(cmd, args)  ->  window.__TAURI_INTERNALS__.invoke(cmd, args, options)
//
// `listen()` is not special-cased any more — it is `invoke('plugin:event|listen',
// { event, target, handler })` where `handler` is an id minted by
// `__TAURI_INTERNALS__.transformCallback`. Dialogs are `plugin:dialog|save`,
// `plugin:dialog|open` and `plugin:dialog|message` (note: `ask()` is a `message`
// with `buttons: 'YesNo'` and resolves to the pressed *label*).
//
// A spec must never touch `window.__TAURI_INTERNALS__` itself, and must never
// reintroduce the v1 global this file replaced: use
// `installTauriIpc()` from `e2e/helpers/tauri-ipc.js`, register behaviour with
// `window.__tauriMock.route(cmd, handler)`, and dispatch menu events with
// `emitMenu(page, id)`. `e2e/conventions.spec.js` enforces that.
//
// Usage from a spec (inside `page.addInitScript`):
//
//   window.__tauriMock
//     .route('save_document', (args) => { written = args; return null })
//     .route('get_document', () => doc)
//
//   return window.__tauriMock.fail('ChangeSectionHidden: section not found')
//
// returns a rejected promise from the app's point of view.

;(function () {
  'use strict'

  var api = {
    routes: Object.create(null),
    invoked: [],
    callbacks: Object.create(null),
    _nextCallbackId: 1,
    _doc: null,
    _docFails: false,
    _dialogPaths: [],
    _openPaths: [],
    _messageAnswer: 'Yes',
    _menuHandlers: [],

    /// Seed defaults. `doc` / `docFails` drive `get_document`; `dialogPaths`
    /// seeds the save dialog (and `openPaths` the open dialog); `messageAnswer`
    /// is the label `dialog|message` returns, which is what `ask()` compares
    /// against (so `'Yes'` makes `ask()` true).
    configure: function (options) {
      var opts = options || {}
      if ('doc' in opts) api._doc = opts.doc
      if ('docFails' in opts) api._docFails = Boolean(opts.docFails)
      if (Array.isArray(opts.dialogPaths)) api._dialogPaths = opts.dialogPaths.slice()
      if (Array.isArray(opts.openPaths)) api._openPaths = opts.openPaths.slice()
      if (typeof opts.messageAnswer === 'string') api._messageAnswer = opts.messageAnswer
      return api
    },

    /// Register behaviour for a command. The handler receives `(args, request)`
    /// and may return a value or `api.fail(message)`.
    route: function (cmd, handler) {
      api.routes[cmd] = handler
      return api
    },

    /// Sentinel: returning this from a route rejects the app's promise.
    fail: function (message) {
      return { __tauriMockError: message }
    },

    hasMenuListener: function () {
      return api._menuHandlers.length > 0
    },

    /// Deliver a `menu` event to the app's registered listener. Returns false
    /// when the app has not registered one yet.
    emitMenu: function (payload) {
      if (!api.hasMenuListener()) return false
      for (var i = 0; i < api._menuHandlers.length; i += 1) {
        api._menuHandlers[i]({ event: 'menu', id: 1, payload: payload })
      }
      return true
    },
  }

  window.__tauriMock = api

  function transformCallback(callback, once) {
    var id = api._nextCallbackId
    api._nextCallbackId += 1
    api.callbacks[id] = function (data) {
      if (once) delete api.callbacks[id]
      if (typeof callback === 'function') callback(data)
    }
    return id
  }

  // `plugin:dialog|save` / `|open` take `{ options }`; `|message` takes
  // `{ message, title, kind, buttons }` and resolves to the pressed label.
  function handleDialog(cmd, args, ok, fail) {
    if (cmd === 'save') {
      return ok(api._dialogPaths.length ? api._dialogPaths.shift() : null)
    }
    if (cmd === 'open') {
      return ok(api._openPaths.length ? api._openPaths.shift() : null)
    }
    if (cmd === 'message') {
      return ok(api._messageAnswer)
    }
    return fail('unsupported dialog command: ' + String(cmd))
  }

  // `plugin:event|listen` takes `{ event, target, handler }`, where `handler` is
  // the integer id minted by `transformCallback`.
  function handleEvent(cmd, args, ok, fail) {
    if (cmd === 'listen') {
      var handlerId = args && args.handler
      var name = args && args.event
      if (typeof handlerId === 'number' && api.callbacks[handlerId]) {
        var deliver = api.callbacks[handlerId]
        api._menuHandlers.push(function (event) {
          if (!name || event.event === name) deliver(event)
        })
      }
      return ok(1)
    }
    if (cmd === 'unlisten') return ok(null)
    return fail('unsupported event command: ' + String(cmd))
  }

  function invoke(cmd, args, options) {
    return new Promise(function (resolve, reject) {
      var request = { cmd: cmd, args: args || {}, options: options }
      api.invoked.push({ cmd: cmd, args: request.args })

      var route = api.routes[cmd]
      if (typeof route === 'function') {
        var result
        try {
          result = route(request.args, request)
        } catch (error) {
          reject({ message: String(error) })
          return
        }
        if (result && typeof result === 'object' && '__tauriMockError' in result) {
          reject({ message: String(result.__tauriMockError) })
          return
        }
        resolve(result)
        return
      }

      // The two commands the app always issues on startup.
      if (cmd === 'get_document') {
        if (api._docFails) reject({ message: 'no tauri' })
        else resolve(api._doc)
        return
      }
      if (cmd === 'list_roles') {
        resolve([])
        return
      }

      // v2 plugin commands arrive as `plugin:<name>|<command>`.
      var plugin = /^plugin:([a-z-]+)\|(.+)$/.exec(cmd)
      if (plugin) {
        var pluginName = plugin[1]
        var inner = plugin[2]
        if (pluginName === 'dialog') {
          try {
            handleDialog(inner, request.args, resolve, reject)
          } catch (error) {
            reject({ message: String(error) })
          }
          return
        }
        if (pluginName === 'event') {
          try {
            handleEvent(inner, request.args, resolve, reject)
          } catch (error) {
            reject({ message: String(error) })
          }
          return
        }
      }

      // Unmodelled commands are a no-op, not an error: the tests that care
      // register a route.
      resolve(null)
    })
  }

  window.__TAURI_INTERNALS__ = {
    invoke: invoke,
    transformCallback: transformCallback,
    callbacks: api.callbacks,
    metadata: {
      currentWindow: { label: 'main' },
      currentWebview: { windowLabel: 'main', label: 'main' },
    },
    convertFileSrc: function (path) {
      return 'asset://localhost/' + encodeURIComponent(path)
    },
  }
})()
