// Page-side half of the shared Tauri v1 IPC mock.
//
// This file is NOT a module and is never imported. Playwright injects it with
// `page.addInitScript({ path })` (see ./tauri-ipc.js), so it must be a plain
// script that runs in the browser before the app bundle.
//
// Why it exists: Tauri v1's IPC envelope is easy to get subtly wrong, and every
// hand-rolled copy was wrong in a different way. The protocol is:
//
//   invoke(cmd, args)  ->  window.__TAURI_IPC__({ cmd, callback, error, ...args })
//
// (tauri.js does exactly that spread), so command arguments arrive as SIBLING
// keys of the request, not under `args`. The reply is NOT returned: the Rust
// side calls back into `window['_' + request.callback](payload)`, and failures
// go to `window['_' + request.error](error)`. A mock that returns a value, that
// looks for `req.payload`, or that answers `saveDialog` at the top level never
// reaches the caller. This file owns that plumbing once.
//
// Specs register plain `cmd -> (args, request) => result` routes, which is the
// same shape as `mockIPC` from `@tauri-apps/api/mocks` — but usable from an
// injected page script, where no ESM import is available.
//
// Usage from a spec:
//
//   await page.addInitScript((doc) => {
//     let live = doc
//     window.__tauriMock
//       .route('get_document', () => live)
//       .route('sync_document', (args) => { live = args.data; return null })
//   }, initialDoc)
//
// Returning `window.__tauriMock.fail(message)` rejects the call instead of
// resolving it.
;(function () {
  'use strict'

  // Request keys that are protocol plumbing. Everything else on the request is
  // the command's own argument (Tauri v1 spreads `invoke` args at top level).
  var PROTOCOL_KEYS = ['cmd', 'callback', 'error', '__tauriModule', 'message', 'args']

  var api = {
    /** cmd -> handler(args, request) */
    routes: Object.create(null),
    /** every request this page saw: { cmd, module, args } */
    invoked: [],
    _doc: null,
    _docFails: false,
    _dialogPaths: [],
    _menuHandler: null,

    /**
     * Defaults shared by every spec: the seeded document, whether
     * `get_document` rejects, and the queue of paths the native save dialog
     * returns. Routes always win over these.
     */
    configure: function (options) {
      var opts = options || {}
      if ('doc' in opts) api._doc = opts.doc
      if ('docFails' in opts) api._docFails = Boolean(opts.docFails)
      if (Array.isArray(opts.dialogPaths)) api._dialogPaths = opts.dialogPaths.slice()
      return api
    },

    route: function (cmd, handler) {
      api.routes[cmd] = handler
      return api
    },

    /** Marker: return this from a route to reject the invocation. */
    fail: function (message) {
      return { __tauriMockError: message }
    },

    /** True once the app has registered an Event-module listener. */
    hasMenuListener: function () {
      return typeof api._menuHandler === 'function'
    },

    /**
     * Deliver one window event payload to the app's listener, exactly as the
     * Rust side does after a native menu item is activated. Returns false when
     * the app has not subscribed yet (call hasMenuListener first).
     */
    emitMenu: function (payload) {
      if (!api.hasMenuListener()) return false
      api._menuHandler({ event: (api._menuEventName || 'menu'), id: 1, payload: payload })
      return true
    },
  }

  window.__tauriMock = api

  /** The command's own arguments, however this Tauri build laid them out. */
  function argsOf(request) {
    if (request.args && typeof request.args === 'object' && !Array.isArray(request.args)) {
      return request.args
    }
    var args = {}
    for (var key in request) {
      if (!Object.prototype.hasOwnProperty.call(request, key)) continue
      if (PROTOCOL_KEYS.indexOf(key) !== -1) continue
      args[key] = request[key]
    }
    return args
  }

  /** The native save dialog, which arrives as a `tauri`/Dialog module call. */
  function handleTauriModule(request, ok, fail) {
    var module = request.__tauriModule
    var message = request.message

    if (module === 'Dialog' && message && message.cmd === 'saveDialog') {
      var path = api._dialogPaths.length ? api._dialogPaths.shift() : null
      return ok(path)
    }

    if (module === 'Event' && message && message.cmd === 'listen') {
      if (message.event) api._menuEventName = message.event
      // Tauri transforms the frontend callback into a page-level function id;
      // the event name and that id are all the mock needs to fire later.
      if (message.handler !== undefined) {
        api._menuHandler = function (event) {
          window['_' + message.handler](event)
        }
      }
      return ok(1)
    }

    // Any other module call (window, app, path, …) resolves like a no-op.
    return ok(null)
  }

  window.__TAURI_IPC__ = function (request) {
    var ok = function (result) {
      setTimeout(function () {
        window['_' + request.callback](result)
      }, 0)
    }
    var fail = function (error) {
      setTimeout(function () {
        window['_' + request.error](error)
      }, 0)
    }

    var args = argsOf(request)
    api.invoked.push({ cmd: request.cmd, module: request.__tauriModule, args: args })

    try {
      if (request.cmd === 'tauri') {
        return handleTauriModule(request, ok, fail)
      }

      var route = api.routes[request.cmd]
      if (typeof route === 'function') {
        var result = route(args, request)
        if (result && typeof result === 'object' && '__tauriMockError' in result) {
          return fail({ message: String(result.__tauriMockError) })
        }
        return ok(result)
      }

      // Defaults every spec wants, so a spec only declares what it cares about.
      if (request.cmd === 'get_document') {
        return api._docFails ? fail({ message: 'no tauri' }) : ok(api._doc)
      }
      if (request.cmd === 'list_roles') {
        return ok([])
      }
      return ok(null)
    } catch (error) {
      return fail({ message: String(error) })
    }
  }
})()
